import { describe, expect, it } from 'vitest'

import { EngineGate } from '../src/gate.js'
import { route } from '../src/api.js'
import type { Api } from '../src/api.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { ONE_HUMAN, RED_FIRST_LEAD, THREE_PLAYER } from './fixtures.js'

const BASE = 'https://arcs.test'
const post = (path: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
const get = (path: string, headers: Record<string, string> = {}): Request => new Request(`${BASE}${path}`, { headers })

function api(): Api {
  const store = new SqliteStore(':memory:')
  return { store, gate: new EngineGate(store, { pace: 0 }) }
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
      post('/games', { options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'], webhookUrl: 'https://discord.test/h' }),
      a,
    )
    expect(res?.status).toBe(201)
    const created = (await res!.json()) as Created
    expect(created.seats.map((s) => s.faction)).toEqual(['red'])
    const tail = await (await route(get(`/games/${created.gameId}`), a))!.json()
    expect(tail.options).toEqual(ONE_HUMAN)
    expect(tail.seats).toEqual([
      { faction: 'red', isBot: false },
      { faction: 'yellow', isBot: true },
      { faction: 'blue', isBot: true },
    ])
    expect(JSON.stringify(tail)).not.toContain('discord.test')
    expect(a.store.meta(created.gameId)?.webhookUrl).toBe('https://discord.test/h')
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
    expect((await ok!.json()).seats[0]).toEqual({ faction: 'red', name: 'Brian', isBot: false })
    const tail = await (await route(get(`/games/${created.gameId}`, { 'x-seat-token': red.seatToken }), a))!.json()
    expect(tail.yourFaction).toBe('red')
    expect(tail.seats[0].name).toBe('Brian')
  })

  it('tells a plain GET on /live to upgrade', async () => {
    const a = api()
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a))!.json()) as Created
    expect((await route(get(`/games/${created.gameId}/live`), a))?.status).toBe(426)
  })
})
