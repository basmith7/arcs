/**
 * The HTTP API, written against web-standard Request/Response like upstream's `handle` so it is
 * testable with `new Request(...)` and independent of node:http. Upstream's three endpoints keep
 * their wire shapes (docs/17 section 4b); this adds bots on create, `seats` on read, a name claim,
 * `403 wrong-turn`, and `/healthz`.
 */
import type { FactionId, NewGameOptions } from '@arcs/engine'

import type { EngineGate } from './gate.js'
import type { SqliteStore } from './sqlite-store.js'

export interface Api {
  readonly store: SqliteStore
  readonly gate: EngineGate
}

export interface PublicSeat {
  readonly faction: string
  readonly name?: string
  readonly isBot: boolean
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

export function publicSeats(store: SqliteStore, gameId: string): PublicSeat[] {
  return store.seats(gameId).map((s) => ({
    faction: s.faction,
    ...(s.name === undefined ? {} : { name: s.name }),
    isBot: s.isBot,
  }))
}

async function body<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T
  } catch {
    return undefined
  }
}

export async function route(request: Request, api: Api): Promise<Response | undefined> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const { store, gate } = api

  if (path === '/healthz') return new Response('ok', { status: 200, headers: CORS })
  if (path !== '/games' && !path.startsWith('/games/')) return undefined

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // --- POST /games ---------------------------------------------------------
  if (path === '/games' && request.method === 'POST') {
    const b = await body<{ options?: unknown; factions?: unknown; bots?: unknown; webhookUrl?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (!isStringArray(b.factions) || b.factions.length === 0) {
      return bad(400, 'factions must be a non-empty array of strings')
    }
    if (b.options === undefined) return bad(400, 'options is required')
    const bots = isStringArray(b.bots) ? b.bots.filter((f) => (b.factions as string[]).includes(f)) : []
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
  const live = /^\/games\/([^/]+)\/live$/.exec(path)

  if (live !== null) return bad(426, 'expected a websocket upgrade')

  // --- GET /games/:id?since=N ---------------------------------------------
  if (game !== null && request.method === 'GET') {
    const gameId = decodeURIComponent(game[1]!)
    const sinceRaw = url.searchParams.get('since')
    const since = sinceRaw === null ? 0 : Number(sinceRaw)
    if (!Number.isInteger(since) || since < 0) return bad(400, 'since must be a non-negative integer')
    const presented = request.headers.get('x-seat-token') ?? undefined
    const tail = await store.read(gameId, since, presented)
    if (tail === undefined) return bad(404, 'no such game')
    return json({ ...tail, seats: publicSeats(store, gameId) })
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

  // --- POST /games/:id/seat -----------------------------------------------
  if (seat !== null && request.method === 'POST') {
    const gameId = decodeURIComponent(seat[1]!)
    const b = await body<{ seatToken?: unknown; name?: unknown }>(request)
    if (b === undefined) return bad(400, 'body must be JSON')
    if (typeof b.seatToken !== 'string') return bad(400, 'seatToken is required')
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (name.length === 0 || name.length > NAME_MAX) return bad(400, `name must be 1-${NAME_MAX} characters`)
    if (store.options(gameId) === undefined) return bad(404, 'no such game')
    const seats = store.setName(gameId, b.seatToken, name)
    if (seats === undefined) return bad(403, 'seat token does not belong to this game')
    return json({ seats: publicSeats(store, gameId) })
  }

  return bad(404, 'not found')
}
