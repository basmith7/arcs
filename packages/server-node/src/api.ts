/**
 * The HTTP API, written against web-standard Request/Response like upstream's `handle` so it is
 * testable with `new Request(...)` and independent of node:http. Upstream's three endpoints keep
 * their wire shapes (docs/17 section 4b); this adds bots on create, `seats` on read, a name claim,
 * `403 wrong-turn`, and `/healthz`.
 */
import { startGame } from '@arcs/engine'
import type { FactionId, NewGameOptions, RuleResult } from '@arcs/engine'

import type { Auth } from './auth.js'
import type { DiscordBot } from './discord.js'
import { askedFactions, type EngineGate } from './gate.js'
import { seatAccess } from './seat-access.js'
import type { SqliteStore } from './sqlite-store.js'

export interface Api {
  readonly store: SqliteStore
  readonly gate: EngineGate
  readonly onSeatsChanged?: (gameId: string) => void
  /** When set, the server resolves claimed names to guild members instead of requiring a pasted id. */
  readonly bot?: DiscordBot
  /** When unset, Discord login is disabled: `/me` reports it and `/auth/*` 404s. */
  readonly auth?: Auth
}

export interface PublicSeat {
  readonly faction: string
  readonly name?: string
  readonly isBot: boolean
  /** True when the seat has a linked Discord user. The id itself is never returned. */
  readonly discordLinked?: boolean
  /** The linked user's Discord username, for display — never the id. */
  readonly discordName?: string
  /** Present for human seats: whether they get a Discord turn ping. */
  readonly pings?: boolean
  /** Display name of the account that has claimed this seat, when one has. */
  readonly owner?: string
}

// Accepts a bare snowflake or a `<@id>`/`<@!id>` mention and normalises to the bare digits.
// `undefined` means "not a recognisable Discord id at all".
const DISCORD_ID = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/

function normaliseDiscordId(raw: string): string | undefined {
  const m = DISCORD_ID.exec(raw.trim())
  if (m === null) return undefined
  return m[1] ?? m[2]
}

export const NAME_MAX = 24

// The server POSTs to this URL from inside the LAN, so accepting arbitrary URLs here would be an
// SSRF hole. Only real Discord webhook endpoints are allowed.
const DISCORD_WEBHOOK = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-seat-token',
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })

const bad = (status: number, error: string): Response => json({ error }, status)

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

// --- create rate limit ------------------------------------------------------
// A crude in-memory token bucket: 10 game creations per IP per 10-minute window. Buckets are
// pruned lazily (checked and reset on the next hit from that IP) rather than swept on a timer.
const CREATE_LIMIT = 10
const CREATE_WINDOW_MS = 10 * 60 * 1000
const createBuckets = new Map<string, { count: number; windowStart: number }>()

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded !== null && forwarded.trim().length > 0) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-arcs-remote-addr') ?? 'unknown'
}

function rateLimited(request: Request): boolean {
  const ip = clientIp(request)
  const now = Date.now()
  const bucket = createBuckets.get(ip)
  if (bucket === undefined || now - bucket.windowStart >= CREATE_WINDOW_MS) {
    createBuckets.set(ip, { count: 1, windowStart: now })
    return false
  }
  bucket.count += 1
  return bucket.count > CREATE_LIMIT
}

/** Whether `faction` is on the clock, and the result once the game is over. Pulled out so `won`
 * is testable against a stub `RuleResult` without playing out a whole game. */
export function gameStatus(result: RuleResult, faction: string): { yourTurn: boolean; over: boolean; won?: boolean } {
  const over = result.state.isOver
  return over
    ? { yourTurn: false, over, won: result.state.winners[0] === faction }
    : { yourTurn: askedFactions(result).includes(faction), over }
}

export function publicSeats(store: SqliteStore, gameId: string): PublicSeat[] {
  return store.seats(gameId).map((s) => ({
    faction: s.faction,
    ...(s.name === undefined ? {} : { name: s.name }),
    isBot: s.isBot,
    ...(s.discordId === undefined ? {} : { discordLinked: true }),
    ...(s.discordName === undefined ? {} : { discordName: s.discordName }),
    ...(s.isBot ? {} : { pings: s.pings }),
    ...(s.ownerName === undefined ? {} : { owner: s.ownerName }),
  }))
}

const MAX_BODY_BYTES = 65536

export class TooLargeError extends Error {}

async function body<T>(request: Request): Promise<T | undefined> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new TooLargeError()
  try {
    return (await request.json()) as T
  } catch (e) {
    if (e instanceof TooLargeError) throw e
    return undefined
  }
}

export async function route(request: Request, api: Api): Promise<Response | undefined> {
  try {
    return await routeInner(request, api)
  } catch (e) {
    if (e instanceof TooLargeError) return bad(413, 'too-large')
    throw e
  }
}

async function routeInner(request: Request, api: Api): Promise<Response | undefined> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const { store, gate, bot } = api
  const account = api.auth?.accountOf(request)

  // Shared by /actions, /undo and /seat: a 403 when the seat is claimed by someone else.
  // When auth is disabled no seat is ever locked, so every seat behaves as it did before claims
  // existed.
  const lockedFor = (gameId: string, token: string): Response | undefined => {
    if (api.auth === undefined) return undefined
    const s = store.seatByToken(gameId, token)
    return s !== undefined && seatAccess(s, account?.id) === 'locked'
      ? json({ error: 'seat-locked', owner: s.ownerName ?? '' }, 403)
      : undefined
  }

  if (path === '/healthz') return new Response('ok', { status: 200, headers: CORS })
  if (path === '/me/games' && request.method === 'GET') {
    if (api.auth === undefined) return bad(404, 'not found')
    if (account === undefined) return bad(401, 'signed out')
    const rows = store
      .accountSeats(account.id)
      .map((row) => {
        const result = gate.resultOf(row.gameId)
        if (result === undefined) return undefined
        return {
          ...row,
          length: store.journalLength(row.gameId),
          chapter: result.state.chapter,
          ...gameStatus(result, row.faction),
          seats: publicSeats(store, row.gameId),
        }
      })
      .filter((g): g is NonNullable<typeof g> => g !== undefined)
    // One row per game: an account holding several seats in one (hotseat) gets the seat whose turn
    // it is, else its first. A Map keeps first-insertion order, so the sort survives.
    const byGame = new Map<string, (typeof rows)[number]>()
    for (const g of rows) {
      const held = byGame.get(g.gameId)
      if (held === undefined || (!held.yourTurn && g.yourTurn)) byGame.set(g.gameId, g)
    }
    const games = [...byGame.values()]
    return new Response(JSON.stringify({ games }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
    })
  }
  if (path === '/me' && request.method === 'GET' && api.auth === undefined) return json({ account: null, enabled: false })
  if (path === '/me' || path.startsWith('/auth/')) return api.auth === undefined ? bad(404, 'not found') : api.auth.route(request)
  if (path !== '/games' && !path.startsWith('/games/')) return undefined

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // --- POST /games ---------------------------------------------------------
  if (path === '/games' && request.method === 'POST') {
    if (rateLimited(request)) return bad(429, 'rate-limited')
    const b = await body<{ options?: unknown; factions?: unknown; bots?: unknown; webhookUrl?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (!isStringArray(b.factions) || b.factions.length === 0) {
      return bad(400, 'factions must be a non-empty array of strings')
    }
    if (b.options === undefined) return bad(400, 'options is required')
    if (b.bots !== undefined && !isStringArray(b.bots)) return bad(400, 'bad-options')
    const bots = isStringArray(b.bots) ? b.bots : []
    if (bots.some((f) => !(b.factions as string[]).includes(f))) return bad(400, 'bad-options')
    let webhookUrl: string | undefined
    if (b.webhookUrl !== undefined) {
      if (typeof b.webhookUrl !== 'string' || !DISCORD_WEBHOOK.test(b.webhookUrl.trim())) {
        return bad(400, 'webhookUrl must be a Discord webhook URL')
      }
      webhookUrl = b.webhookUrl.trim()
    }
    // Bots travel in options so every client's replay knows which seats are bots.
    const rawOptions = b.options as NewGameOptions
    const options: NewGameOptions =
      bots.length > 0 ? { ...rawOptions, bots: bots as readonly FactionId[] } : rawOptions
    try {
      startGame(options)
    } catch (e) {
      return json({ error: 'bad-options', detail: String((e as Error).message) }, 400)
    }
    const created = await store.create(options, b.factions, {
      bots,
      ...(webhookUrl === undefined ? {} : { webhookUrl }),
    })
    const humans = created.seats.filter((s) => !bots.includes(s.faction))
    return json({ gameId: created.gameId, seats: humans }, 201)
  }

  const game = /^\/games\/([^/]+)$/.exec(path)
  const actions = /^\/games\/([^/]+)\/actions$/.exec(path)
  const seat = /^\/games\/([^/]+)\/seat$/.exec(path)
  const undo = /^\/games\/([^/]+)\/undo$/.exec(path)
  const claim = /^\/games\/([^/]+)\/claim$/.exec(path)
  const live = /^\/games\/([^/]+)\/live$/.exec(path)
  const sit = /^\/games\/([^/]+)\/sit$/.exec(path)
  const release = /^\/games\/([^/]+)\/release$/.exec(path)

  if (live !== null) return bad(426, 'expected a websocket upgrade')

  // --- GET /games/:id?since=N ---------------------------------------------
  if (game !== null && request.method === 'GET') {
    const gameId = decodeURIComponent(game[1]!)
    const sinceRaw = url.searchParams.get('since')
    const since = sinceRaw === null ? 0 : Number(sinceRaw)
    if (!Number.isInteger(since) || since < 0) return bad(400, 'since must be a non-negative integer')
    const presented = request.headers.get('x-seat-token') ?? undefined
    const presentedSeat = presented === undefined ? undefined : store.seatByToken(gameId, presented)
    const locked =
      api.auth !== undefined && presentedSeat !== undefined && seatAccess(presentedSeat, account?.id) === 'locked'
    const tail = await store.read(gameId, since, locked ? undefined : presented)
    if (tail === undefined) return bad(404, 'no such game')
    return json({
      ...tail,
      seats: publicSeats(store, gameId),
      ...(locked
        ? { lockedSeat: { faction: presentedSeat!.faction, owner: presentedSeat!.ownerName ?? '' } }
        : {}),
    })
  }

  // --- POST /games/:id/actions --------------------------------------------
  if (actions !== null && request.method === 'POST') {
    const gameId = decodeURIComponent(actions[1]!)
    const b = await body<{ seatToken?: unknown; expectedLength?: unknown; action?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (typeof b.seatToken !== 'string') return bad(400, 'seatToken is required')
    if (typeof b.action !== 'string') return bad(400, 'action is required')
    if (!Number.isInteger(b.expectedLength) || (b.expectedLength as number) < 0) {
      return bad(400, 'expectedLength must be a non-negative integer')
    }
    const locked = lockedFor(gameId, b.seatToken)
    if (locked) return locked
    const result = await gate.append(gameId, b.seatToken, b.expectedLength as number, b.action)
    if (result.ok) return json(result)
    switch (result.reason) {
      case 'no-such-game':
        return bad(404, 'no such game')
      case 'bad-seat':
        return bad(403, 'seat token does not belong to this game')
      case 'wrong-faction':
        return bad(403, 'that action belongs to another faction')
      case 'wrong-turn':
        return bad(403, 'wrong-turn')
      case 'game-over':
        return bad(403, 'game-over')
      case 'conflict':
        return json({ error: 'conflict', length: result.length }, 409)
    }
  }

  // --- POST /games/:id/undo -----------------------------------------------
  // Take back your own last action (`EngineGate.takeBack`). A refusal says why, in words the
  // client can show: the action revealed something, or it is not yours to take back.
  if (undo !== null && request.method === 'POST') {
    const gameId = decodeURIComponent(undo[1]!)
    const b = await body<{ seatToken?: unknown; expectedLength?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (typeof b.seatToken !== 'string') return bad(400, 'seatToken is required')
    if (!Number.isInteger(b.expectedLength) || (b.expectedLength as number) < 0) {
      return bad(400, 'expectedLength must be a non-negative integer')
    }
    const locked = lockedFor(gameId, b.seatToken)
    if (locked) return locked
    const result = await gate.takeBack(gameId, b.seatToken, b.expectedLength as number)
    if (result.ok) return json(result)
    switch (result.reason) {
      case 'no-such-game':
        return bad(404, 'no such game')
      case 'bad-seat':
        return bad(403, 'seat token does not belong to this game')
      case 'conflict':
        return json({ error: 'conflict', length: result.length }, 409)
      case 'revealed':
        return json({ error: 'revealed', why: result.why }, 403)
      case 'nothing':
      case 'not-yours':
        return bad(403, result.reason)
    }
  }

  // --- POST /games/:id/claim ----------------------------------------------
  // "Who are you?" for a visitor holding the bare game link: answer with the picked human seat's
  // token. This deliberately trusts the pick — anyone with the game link may take any human seat —
  // because the bare link is what the Discord pings post, and a friend on a new device landing as
  // a spectator was the failure that cost more than the trust does. Bot seats are never handed out.
  if (claim !== null && request.method === 'POST') {
    const gameId = decodeURIComponent(claim[1]!)
    const b = await body<{ faction?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (typeof b.faction !== 'string') return bad(400, 'faction is required')
    if (store.options(gameId) === undefined) return bad(404, 'no such game')
    const picked = store.seats(gameId).find((s) => s.faction === b.faction)
    if (picked === undefined) return bad(404, 'no such seat')
    if (picked.isBot) return bad(403, 'that seat is a bot')
    return json({ seatToken: picked.seatToken })
  }

  // --- POST /games/:id/seat -----------------------------------------------
  if (seat !== null && request.method === 'POST') {
    const gameId = decodeURIComponent(seat[1]!)
    const b = await body<{ seatToken?: unknown; name?: unknown; discordId?: unknown; pings?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (typeof b.seatToken !== 'string') return bad(400, 'seatToken is required')
    if (b.pings !== undefined && typeof b.pings !== 'boolean') return bad(400, 'bad-pings')
    if (b.name === undefined && b.pings === undefined) return bad(400, 'bad-body')
    const locked = lockedFor(gameId, b.seatToken)
    if (locked) return locked
    if (store.options(gameId) === undefined) return bad(404, 'no such game')

    if (b.name !== undefined) {
      const name = typeof b.name === 'string' ? b.name.trim() : ''
      if (name.length === 0 || name.length > NAME_MAX) return bad(400, `name must be 1-${NAME_MAX} characters`)

      if (
        b.discordId !== undefined &&
        b.discordId !== null &&
        typeof b.discordId !== 'string'
      ) {
        return bad(400, 'bad-discord-id')
      }

      // `discord` follows `SqliteStore.setName`'s three-way contract: undefined leaves the link
      // alone, null clears it, an object sets it.
      let discord: { id: string; name?: string } | null | undefined
      const rawId = typeof b.discordId === 'string' ? b.discordId.trim() : b.discordId
      if (rawId === null || rawId === '') {
        discord = null
      } else if (typeof rawId === 'string') {
        const id = normaliseDiscordId(rawId)
        if (id === undefined) return bad(400, 'bad-discord-id')
        const member = bot === undefined ? undefined : await bot.member(id)
        discord = { id, ...(member === undefined ? {} : { name: member.username }) }
      } else if (bot !== undefined) {
        // No explicit id given: try to resolve the claimed name to a guild member. A miss (zero or
        // several matches) leaves whatever was already linked untouched — a rename must not silently
        // unlink an existing player.
        const member = await bot.resolveMember(name)
        discord = member === undefined ? undefined : { id: member.id, name: member.username }
      } else {
        discord = undefined
      }

      const seats = store.setName(gameId, b.seatToken, name, discord)
      if (seats === undefined) return bad(403, 'seat token does not belong to this game')
    }

    if (typeof b.pings === 'boolean') {
      const seats = store.setPings(gameId, b.seatToken, b.pings)
      if (seats === undefined) return bad(403, 'seat token does not belong to this game')
    }

    api.onSeatsChanged?.(gameId)
    return json({ seats: publicSeats(store, gameId) })
  }

  // --- POST /games/:id/sit -------------------------------------------------
  // "Sit here": lock the seat a token names to the signed-in account. Not `/claim`, which is
  // "Who are you?" handing a tokenless visitor a seat's token.
  if (sit !== null && request.method === 'POST') {
    const gameId = decodeURIComponent(sit[1]!)
    const b = await body<{ seatToken?: unknown; name?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (typeof b.seatToken !== 'string') return bad(400, 'seatToken is required')
    if (account === undefined) return bad(401, 'signed-out')
    const seat = store.seatByToken(gameId, b.seatToken)
    if (seat === undefined) return bad(403, 'seat token does not belong to this game')
    if (seat.isBot) return bad(403, 'bot-seat')
    const locked = lockedFor(gameId, b.seatToken)
    if (locked) return locked

    let name: string
    if (b.name !== undefined) {
      name = typeof b.name === 'string' ? b.name.trim() : ''
      if (name.length === 0 || name.length > NAME_MAX) return bad(400, `name must be 1-${NAME_MAX} characters`)
    } else {
      name = seat.name ?? account.displayName.slice(0, NAME_MAX)
    }

    store.claim(gameId, b.seatToken, account.id, name)
    api.onSeatsChanged?.(gameId)
    return json({ seats: publicSeats(store, gameId) })
  }

  // --- POST /games/:id/release ----------------------------------------------
  if (release !== null && request.method === 'POST') {
    const gameId = decodeURIComponent(release[1]!)
    const b = await body<{ seatToken?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (typeof b.seatToken !== 'string') return bad(400, 'seatToken is required')
    if (account === undefined) return bad(401, 'signed-out')
    const seat = store.seatByToken(gameId, b.seatToken)
    if (seat === undefined) return bad(403, 'seat token does not belong to this game')
    if (seat.accountId === undefined) return bad(403, 'not-claimed')
    const locked = lockedFor(gameId, b.seatToken)
    if (locked) return locked

    store.release(gameId, b.seatToken)
    api.onSeatsChanged?.(gameId)
    return json({ seats: publicSeats(store, gameId) })
  }

  return bad(404, 'not found')
}
