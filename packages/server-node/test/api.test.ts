import { describe, expect, it } from 'vitest'

import { Auth } from '../src/auth.js'
import { EngineGate } from '../src/gate.js'
import { gameStatus, route } from '../src/api.js'
import type { Api } from '../src/api.js'
import type { RuleResult } from '@arcs/engine'
import { SqliteStore } from '../src/sqlite-store.js'
import { cookieOf, discordFake, ONE_HUMAN, RED_FIRST_LEAD, signIn, THREE_PLAYER } from './fixtures.js'

const BASE = 'https://arcs.test'
const post = (path: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
const get = (path: string, headers: Record<string, string> = {}): Request => new Request(`${BASE}${path}`, { headers })

function api(auth?: Auth): Api {
  const store = new SqliteStore(':memory:')
  return { store, gate: new EngineGate(store, { pace: 0 }), ...(auth === undefined ? {} : { auth }) }
}

interface Created {
  gameId: string
  seats: { faction: string; seatToken: string }[]
}

describe('route', () => {
  it('answers /healthz and leaves non-API paths alone', async () => {
    const a = api()
    expect((await route(get('/healthz'), a))?.status).toBe(200)
    expect(await route(get('/'), a)).toBeUndefined()
    expect(await route(get('/assets/x.png'), a)).toBeUndefined()
  })

  it('creates a game with bots, hands out human seats only, stores bots in options', async () => {
    const a = api()
    const res = await route(
      post('/games', {
        options: ONE_HUMAN,
        factions: ONE_HUMAN.factions,
        bots: ['yellow', 'blue'],
        webhookUrl: 'https://discord.com/api/webhooks/1/abc',
      }),
      a,
    )
    expect(res?.status).toBe(201)
    const created = (await res!.json()) as Created
    expect(created.seats.map((s) => s.faction)).toEqual(['red'])
    const tail = await (await route(get(`/games/${created.gameId}`), a))!.json()
    expect(tail.options).toEqual(ONE_HUMAN)
    expect(tail.seats).toEqual([
      { faction: 'red', isBot: false, pings: true },
      { faction: 'yellow', isBot: true },
      { faction: 'blue', isBot: true },
    ])
    expect(JSON.stringify(tail)).not.toContain('discord.com')
    expect(a.store.meta(created.gameId)?.webhookUrl).toBe('https://discord.com/api/webhooks/1/abc')
  })

  it('rejects options that fail to start a game, and bot factions outside the roster', async () => {
    const a = api()
    const badOptions = await route(
      post('/games', { options: { players: 2, seed: 1 }, factions: ['red'] }, { 'x-forwarded-for': '10.0.0.1' }),
      a,
    )
    expect(badOptions?.status).toBe(400)
    expect((await badOptions!.json()).error).toBe('bad-options')
    expect(a.store.gameIds()).toEqual([])

    const badBots = await route(
      post(
        '/games',
        { options: THREE_PLAYER, factions: THREE_PLAYER.factions, bots: ['purple'] },
        { 'x-forwarded-for': '10.0.0.2' },
      ),
      a,
    )
    expect(badBots?.status).toBe(400)
    expect((await badBots!.json()).error).toBe('bad-options')
  })

  it('rate-limits game creation per IP', async () => {
    const a = api()
    const create = (ip: string) =>
      route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }, { 'x-forwarded-for': ip }), a)
    for (let i = 0; i < 10; i++) {
      expect((await create('10.1.1.1'))!.status).toBe(201)
    }
    const eleventh = await create('10.1.1.1')
    expect(eleventh?.status).toBe(429)
    expect((await eleventh!.json()).error).toBe('rate-limited')
    // A different IP is unaffected.
    expect((await create('10.1.1.2'))!.status).toBe(201)
  })

  it('rejects a non-Discord webhookUrl and accepts a missing one', async () => {
    const a = api()
    const rejected = await route(
      post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions, webhookUrl: 'https://evil.test/steal' }),
      a,
    )
    expect(rejected?.status).toBe(400)
    const accepted = await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a)
    expect(accepted?.status).toBe(201)
    const created = (await accepted!.json()) as Created
    expect(a.store.meta(created.gameId)?.webhookUrl).toBeUndefined()
  })

  it('rejects an out-of-turn action with 403 wrong-turn and accepts the right one', async () => {
    const a = api()
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a))!.json()) as Created
    const yellow = created.seats[1]!
    const bad = await route(
      post(`/games/${created.gameId}/actions`, { seatToken: yellow.seatToken, expectedLength: 0, action: RED_FIRST_LEAD.replace('"red"', '"yellow"') }),
      a,
    )
    expect(bad?.status).toBe(403)
    expect(await bad!.json()).toEqual({ error: 'wrong-turn' })
    const red = created.seats[0]!
    const ok = await route(post(`/games/${created.gameId}/actions`, { seatToken: red.seatToken, expectedLength: 0, action: RED_FIRST_LEAD }), a)
    expect(ok?.status).toBe(200)
    expect(await ok!.json()).toEqual({ ok: true, length: 1 })
    const conflict = await route(post(`/games/${created.gameId}/actions`, { seatToken: red.seatToken, expectedLength: 0, action: RED_FIRST_LEAD }), a)
    expect(conflict?.status).toBe(409)
  })

  it('claims a name, validates it, and reports it on read', async () => {
    const a = api()
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a))!.json()) as Created
    const red = created.seats[0]!
    expect((await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, name: '   ' }), a))?.status).toBe(400)
    expect((await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, name: 'x'.repeat(25) }), a))?.status).toBe(400)
    expect((await route(post(`/games/${created.gameId}/seat`, { seatToken: 'nope', name: 'B' }), a))?.status).toBe(403)
    const ok = await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, name: '  Brian ' }), a)
    expect(ok?.status).toBe(200)
    expect((await ok!.json()).seats[0]).toEqual({ faction: 'red', name: 'Brian', isBot: false, pings: true })
    const tail = await (await route(get(`/games/${created.gameId}`, { 'x-seat-token': red.seatToken }), a))!.json()
    expect(tail.yourFaction).toBe('red')
    expect(tail.seats[0].name).toBe('Brian')
  })

  it('toggles the pings flag, round-tripping through seats, and validates it', async () => {
    const a = api()
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a))!.json()) as Created
    const red = created.seats[0]!
    expect((await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken }), a))?.status).toBe(400)
    expect((await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, pings: 'nope' }), a))?.status).toBe(400)
    expect((await route(post(`/games/${created.gameId}/seat`, { seatToken: 'bogus', pings: false }), a))?.status).toBe(403)

    const off = await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, pings: false }), a)
    expect(off?.status).toBe(200)
    expect((await off!.json()).seats[0].pings).toBe(false)

    const on = await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, pings: true }), a)
    expect(on?.status).toBe(200)
    expect((await on!.json()).seats[0].pings).toBe(true)

    // name-only body still works.
    const named = await route(post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, name: 'Brian' }), a)
    expect(named?.status).toBe(200)
    expect((await named!.json()).seats[0]).toEqual({ faction: 'red', name: 'Brian', isBot: false, pings: true })
  })

  it('normalises a discord mention to the bare id, stores it, and never returns the id', async () => {
    const a = api()
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a))!.json()) as Created
    const red = created.seats[0]!
    const ok = await route(
      post(`/games/${created.gameId}/seat`, {
        seatToken: red.seatToken,
        name: 'Brian',
        discordId: '<@!123456789012345678>',
      }),
      a,
    )
    expect(ok?.status).toBe(200)
    const seatsBody = await ok!.json()
    expect(seatsBody.seats[0]).toEqual({ faction: 'red', name: 'Brian', isBot: false, discordLinked: true, pings: true })
    expect(JSON.stringify(seatsBody)).not.toContain('123456789012345678')
    const stored = a.store.seats(created.gameId)[0]
    expect(stored?.discordId).toBe('123456789012345678')

    const garbage = await route(
      post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, name: 'Brian', discordId: 'not-an-id' }),
      a,
    )
    expect(garbage?.status).toBe(400)
    expect((await garbage!.json()).error).toBe('bad-discord-id')

    const cleared = await route(
      post(`/games/${created.gameId}/seat`, { seatToken: red.seatToken, name: 'Brian', discordId: '' }),
      a,
    )
    expect(cleared?.status).toBe(200)
    const clearedBody = await cleared!.json()
    expect(clearedBody.seats[0]).toEqual({ faction: 'red', name: 'Brian', isBot: false, pings: true })
    expect(a.store.seats(created.gameId)[0]?.discordId).toBeUndefined()
  })

  it('tells a plain GET on /live to upgrade', async () => {
    const a = api()
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a))!.json()) as Created
    expect((await route(get(`/games/${created.gameId}/live`), a))?.status).toBe(426)
  })
})

describe('POST /games/:id/undo', () => {
  it("takes back the seat's own last action, and explains a refusal", async () => {
    const a = api()
    const created = (await (
      await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a)
    )!.json()) as Created
    const token = (f: string) => created.seats.find((s) => s.faction === f)!.seatToken
    const id = created.gameId
    await route(post(`/games/${id}/actions`, { seatToken: token('red'), expectedLength: 0, action: RED_FIRST_LEAD }), a)

    const refused = await route(post(`/games/${id}/undo`, { seatToken: token('yellow'), expectedLength: 1 }), a)
    expect(refused?.status).toBe(403)
    expect(await refused!.json()).toEqual({ error: 'not-yours' })

    const stale = await route(post(`/games/${id}/undo`, { seatToken: token('red'), expectedLength: 5 }), a)
    expect(stale?.status).toBe(409)

    const ok = await route(post(`/games/${id}/undo`, { seatToken: token('red'), expectedLength: 1 }), a)
    expect(ok?.status).toBe(200)
    expect(await ok!.json()).toEqual({ ok: true, length: 0 })
    expect(a.store.journal(id)).toEqual([])
  })
})

describe('seat locks', () => {
  // Each setup() creates a game; give each its own IP so the module-level create rate limit
  // (10 per unknown-IP bucket, shared by every test in this file) doesn't trip across this many tests.
  let ip = 0
  const nextIp = () => ({ 'x-forwarded-for': `10.9.0.${++ip}` })

  async function setup() {
    const store = new SqliteStore(':memory:')
    const auth = new Auth(store, { clientId: 'i', clientSecret: 's', publicOrigin: BASE, fetch: discordFake().f })
    const other = new Auth(store, { clientId: 'i', clientSecret: 's', publicOrigin: BASE,
      fetch: discordFake({ id: '333333333333333333', username: 'eve', global_name: 'Eve' }).f })
    const a: Api = { store, gate: new EngineGate(store, { pace: 0 }), auth }
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }, nextIp()), a))!.json()) as Created
    const red = created.seats.find((s) => s.faction === 'red')!.seatToken
    const me = `arcs_session=${cookieOf((await signIn(auth))!, 'arcs_session')}`
    const eve = `arcs_session=${cookieOf((await signIn(other))!, 'arcs_session')}`
    return { a, gameId: created.gameId, red, me, eve }
  }

  it.each([
    // claimed?  who        expected status of the first red action
    [false, 'none', 200],
    [false, 'me', 200],
    [true, 'me', 200],
    [true, 'none', 403],
    [true, 'eve', 403],
  ] as const)('claimed=%s as %s → %s', async (claimed, who, status) => {
    const { a, gameId, red, me, eve } = await setup()
    if (claimed) expect((await route(post(`/games/${gameId}/claim`, { seatToken: red }, { cookie: me }), a))!.status).toBe(200)
    const cookie = who === 'me' ? { cookie: me } : who === 'eve' ? { cookie: eve } : {}
    const res = (await route(post(`/games/${gameId}/actions`, { seatToken: red, expectedLength: 0, action: RED_FIRST_LEAD }, cookie), a))!
    expect(res.status).toBe(status)
    if (status === 403) expect(await res.json()).toEqual({ error: 'seat-locked', owner: 'Brian' })
  })

  it('a locked link reads as a watcher with lockedSeat; undo and seat are refused', async () => {
    const { a, gameId, red, me } = await setup()
    await route(post(`/games/${gameId}/claim`, { seatToken: red }, { cookie: me }), a)
    const tail = await (await route(get(`/games/${gameId}`, { 'x-seat-token': red }), a))!.json()
    expect(tail.yourFaction).toBeUndefined()
    expect(tail.lockedSeat).toEqual({ faction: 'red', owner: 'Brian' })
    expect(tail.seats[0]).toMatchObject({ faction: 'red', name: 'Brian', owner: 'Brian', discordLinked: true })
    expect((await route(post(`/games/${gameId}/undo`, { seatToken: red, expectedLength: 0 }), a))!.status).toBe(403)
    expect((await route(post(`/games/${gameId}/seat`, { seatToken: red, name: 'Mallory' }), a))!.status).toBe(403)
  })

  it('claim is refused signed out, on a bot seat and on someone else’s seat; release unlocks', async () => {
    const { a, gameId, red, me, eve } = await setup()
    expect((await route(post(`/games/${gameId}/claim`, { seatToken: red }), a))!.status).toBe(401)
    await route(post(`/games/${gameId}/claim`, { seatToken: red, name: 'Bri' }, { cookie: me }), a)
    expect((await route(post(`/games/${gameId}/claim`, { seatToken: red }, { cookie: eve }), a))!.status).toBe(403)
    expect((await route(post(`/games/${gameId}/release`, { seatToken: red }, { cookie: eve }), a))!.status).toBe(403)
    expect((await route(post(`/games/${gameId}/release`, { seatToken: red }, { cookie: me }), a))!.status).toBe(200)
    const res = await route(post(`/games/${gameId}/actions`, { seatToken: red, expectedLength: 0, action: RED_FIRST_LEAD }), a)
    expect(res!.status).toBe(200)
  })

  it('a bot seat cannot be claimed', async () => {
    const { a, me } = await setup()
    const created = (await (await route(post('/games', { options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }, nextIp()), a))!.json()) as Created
    const botToken = a.store.seats(created.gameId).find((s) => s.isBot)!.seatToken
    const res = (await route(post(`/games/${created.gameId}/claim`, { seatToken: botToken }, { cookie: me }), a))!
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'bot-seat' })
  })

  it('lists my games with whose turn and the result', async () => {
    const { a, gameId, red, me } = await setup() // reuse the seat-locks setup; red leads first
    await route(post(`/games/${gameId}/claim`, { seatToken: red }, { cookie: me }), a)
    const res = (await route(get('/me/games', { cookie: me }), a))!
    const { games } = await res.json()
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ gameId, faction: 'red', seatToken: red, yourTurn: true, over: false, length: 0 })
    expect(games[0].won).toBeUndefined()
    expect((await route(get('/me/games'), a))!.status).toBe(401)
  })

  it('gameStatus reports won from the tie-broken winner', () => {
    const over = { state: { isOver: true, winners: ['red'] } } as unknown as RuleResult
    expect(gameStatus(over, 'red')).toEqual({ yourTurn: false, over: true, won: true })
    expect(gameStatus(over, 'blue')).toEqual({ yourTurn: false, over: true, won: false })
  })

  it('with auth disabled, a seat with account_id set still behaves as unlocked', async () => {
    const a = api()
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }, nextIp()), a))!.json()) as Created
    const red = created.seats.find((s) => s.faction === 'red')!.seatToken
    const account = a.store.upsertAccount({ discordId: '1', discordName: 'bri', displayName: 'Brian' })
    a.store.claim(created.gameId, red, account.id, 'Brian')

    const res = await route(post(`/games/${created.gameId}/actions`, { seatToken: red, expectedLength: 0, action: RED_FIRST_LEAD }), a)
    expect(res!.status).toBe(200)

    const tail = await (await route(get(`/games/${created.gameId}`, { 'x-seat-token': red }), a))!.json()
    expect(tail.yourFaction).toBe('red')
    expect(tail.lockedSeat).toBeUndefined()
  })
})
