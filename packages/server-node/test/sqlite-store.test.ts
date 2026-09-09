import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { describeStoreContract } from '../../server/test/contract.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { THREE_PLAYER, tempDbPath } from './fixtures.js'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

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

  it('migrates an old-schema db (no discord columns) on open', async () => {
    const path = tempDbPath()
    const raw = new DatabaseSync(path)
    raw.exec(`
      CREATE TABLE game (
        id TEXT PRIMARY KEY,
        options TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        webhook_url TEXT,
        last_notified_length INTEGER NOT NULL DEFAULT -1,
        last_notified_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE seat (
        game_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        faction TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        name TEXT,
        is_bot INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, ord)
      );
      CREATE TABLE journal (
        game_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        action TEXT NOT NULL,
        PRIMARY KEY (game_id, idx)
      );
    `)
    raw.prepare('INSERT INTO game (id, options, created_at) VALUES (?, ?, ?)').run('g1', JSON.stringify(THREE_PLAYER), 1)
    raw.prepare('INSERT INTO seat (game_id, ord, faction, token) VALUES (?, ?, ?, ?)').run('g1', 0, 'red', 'tok1')
    raw.close()

    const store = new SqliteStore(path)
    const seats = store.setName('g1', 'tok1', 'Brian', { id: '123456789012345678', name: 'brian' })
    expect(seats?.[0]).toEqual({
      faction: 'red',
      seatToken: 'tok1',
      name: 'Brian',
      isBot: false,
      discordId: '123456789012345678',
      discordName: 'brian',
      pings: true,
    })
    store.close()
  })

  it('defaults every seat to pings on, flips and persists it', async () => {
    const path = tempDbPath()
    const a = new SqliteStore(path)
    const game = await a.create(THREE_PLAYER, THREE_PLAYER.factions)
    const red = game.seats[0]!
    expect(a.seats(game.gameId).every((s) => s.pings)).toBe(true)
    const seats = a.setPings(game.gameId, red.seatToken, false)
    expect(seats?.find((s) => s.seatToken === red.seatToken)?.pings).toBe(false)
    expect(a.setPings(game.gameId, 'nope', false)).toBeUndefined()
    a.close()

    const b = new SqliteStore(path)
    expect(b.seats(game.gameId).find((s) => s.seatToken === red.seatToken)?.pings).toBe(false)
    b.close()
  })

  it('migrates an old-schema db (no pings column) on open, reading true', async () => {
    const path = tempDbPath()
    const raw = new DatabaseSync(path)
    raw.exec(`
      CREATE TABLE game (
        id TEXT PRIMARY KEY,
        options TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        webhook_url TEXT,
        last_notified_length INTEGER NOT NULL DEFAULT -1,
        last_notified_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE seat (
        game_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        faction TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        name TEXT,
        is_bot INTEGER NOT NULL DEFAULT 0,
        discord_id TEXT,
        discord_name TEXT,
        PRIMARY KEY (game_id, ord)
      );
      CREATE TABLE journal (
        game_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        action TEXT NOT NULL,
        PRIMARY KEY (game_id, idx)
      );
    `)
    raw.prepare('INSERT INTO game (id, options, created_at) VALUES (?, ?, ?)').run('g1', JSON.stringify(THREE_PLAYER), 1)
    raw.prepare('INSERT INTO seat (game_id, ord, faction, token) VALUES (?, ?, ?, ?)').run('g1', 0, 'red', 'tok1')
    raw.close()

    const store = new SqliteStore(path)
    expect(store.seats('g1')[0]?.pings).toBe(true)
    store.close()
  })

  it('counts journal length', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    expect(store.journalLength(game.gameId)).toBe(0)
    await store.append(game.gameId, game.seats[0]!.seatToken, 0, 'a')
    expect(store.journalLength(game.gameId)).toBe(1)
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

  it('sets, keeps, and clears a seat\'s discord link independently of the name', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const red = game.seats[0]!
    const set = store.setName(game.gameId, red.seatToken, 'Brian', { id: '123456789012345678', name: 'brian' })
    expect(set?.[0]).toMatchObject({ discordId: '123456789012345678', discordName: 'brian' })
    // undefined leaves the link untouched even as the name changes.
    const kept = store.setName(game.gameId, red.seatToken, 'Bri')
    expect(kept?.[0]).toMatchObject({ discordId: '123456789012345678', discordName: 'brian' })
    // null clears both columns.
    const cleared = store.setName(game.gameId, red.seatToken, 'Bri', null)
    expect(cleared?.[0]?.discordId).toBeUndefined()
    expect(cleared?.[0]?.discordName).toBeUndefined()
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
