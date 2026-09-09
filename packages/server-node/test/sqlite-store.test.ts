import { describe, expect, it } from 'vitest'

import { describeStoreContract } from '../../server/test/contract.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { THREE_PLAYER, tempDbPath } from './fixtures.js'

describeStoreContract('SqliteStore (memory)', () => new SqliteStore(':memory:'))
describeStoreContract('SqliteStore (file)', () => new SqliteStore(tempDbPath()))

describe('SqliteStore extras', () => {
  it('marks bot seats and keeps a webhook url out of read()', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, {
      bots: ['blue'],
      webhookUrl: 'https://discord.test/hook',
    })
    const seats = store.seats(game.gameId)
    expect(seats.map((s) => [s.faction, s.isBot])).toEqual([
      ['red', false],
      ['yellow', false],
      ['blue', true],
    ])
    const tail = await store.read(game.gameId, 0)
    expect(JSON.stringify(tail)).not.toContain('discord.test')
    expect(store.meta(game.gameId)).toEqual({
      webhookUrl: 'https://discord.test/hook',
      lastNotifiedLength: -1,
      lastNotifiedAt: 0,
    })
  })

  it('sets a seat name idempotently and refuses a bad token', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const red = game.seats[0]!
    expect(store.setName(game.gameId, red.seatToken, 'Brian')?.[0]?.name).toBe('Brian')
    expect(store.setName(game.gameId, red.seatToken, 'Brian')?.[0]?.name).toBe('Brian')
    expect(store.setName(game.gameId, 'nope', 'X')).toBeUndefined()
    expect(store.seats(game.gameId)[1]?.name).toBeUndefined()
  })

  it('survives a reopen: journal, seats and meta persist', async () => {
    const path = tempDbPath()
    const a = new SqliteStore(path)
    const game = await a.create(THREE_PLAYER, THREE_PLAYER.factions, { bots: ['yellow'] })
    const red = game.seats[0]!
    await a.append(game.gameId, red.seatToken, 0, 'turn/lead(card="X",faction="red")')
    a.markNotified(game.gameId, 1, 1234)
    a.close()

    const b = new SqliteStore(path)
    expect(b.gameIds()).toEqual([game.gameId])
    expect(b.journal(game.gameId)).toEqual(['turn/lead(card="X",faction="red")'])
    expect(b.seats(game.gameId)[1]?.isBot).toBe(true)
    expect(b.meta(game.gameId)).toEqual({ lastNotifiedLength: 1, lastNotifiedAt: 1234 })
    expect(b.options(game.gameId)).toEqual(THREE_PLAYER)
    b.close()
  })

  it('makes append a real compare-and-set under concurrent callers', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const red = game.seats[0]!
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.append(game.gameId, red.seatToken, 0, 'a(faction="red")')),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(store.journal(game.gameId)).toHaveLength(1)
  })
})
