import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { describeStoreContract } from '../../server/test/contract.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { RED_FIRST_LEAD, THREE_PLAYER, tempDbPath } from './fixtures.js'

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

describe('accounts', () => {
  it('upserts by discord id, refreshing names', () => {
    const s = new SqliteStore(':memory:')
    const a = s.upsertAccount({ discordId: '111111111111111111', discordName: 'bri', displayName: 'Brian' })
    const b = s.upsertAccount({ discordId: '111111111111111111', discordName: 'bri2', displayName: 'Bri' })
    expect(b.id).toBe(a.id)
    expect(b.displayName).toBe('Bri')
  })

  it('sessions expire and are deleted on lookup', () => {
    const s = new SqliteStore(':memory:')
    const a = s.upsertAccount({ discordId: '111111111111111111', discordName: 'bri', displayName: 'Brian' })
    s.createSession(a.id, 'h1', 1000)
    expect(s.sessionAccount('h1', 999)?.account.id).toBe(a.id)
    expect(s.sessionAccount('h1', 1000)).toBeUndefined()
    expect(s.sessionAccount('h1', 0)).toBeUndefined() // gone, not just hidden
  })

  it('a claimed seat reads its Discord id through the account; release falls back to the seat', async () => {
    const s = new SqliteStore(':memory:')
    const g = await s.create(THREE_PLAYER, THREE_PLAYER.factions)
    const red = g.seats[0]!.seatToken
    s.setName(g.gameId, red, 'Old', { id: '222222222222222222', name: 'guessed' })
    const a = s.upsertAccount({ discordId: '111111111111111111', discordName: 'bri', displayName: 'Brian' })
    const seats = s.claim(g.gameId, red, a.id, 'Brian')!
    expect(seats[0]).toMatchObject({ name: 'Brian', accountId: a.id, ownerName: 'Brian', discordId: '111111111111111111', discordName: 'bri' })
    const released = s.release(g.gameId, red)!
    expect(released[0]!.accountId).toBeUndefined()
    expect(released[0]!.discordId).toBe('222222222222222222')
  })

  it('lists an account’s seats most recently played first', async () => {
    const s = new SqliteStore(':memory:')
    const a = s.upsertAccount({ discordId: '111111111111111111', discordName: 'bri', displayName: 'Brian' })
    const g1 = await s.create(THREE_PLAYER, THREE_PLAYER.factions)
    const g2 = await s.create(THREE_PLAYER, THREE_PLAYER.factions)
    s.claim(g1.gameId, g1.seats[0]!.seatToken, a.id, 'Brian')
    s.claim(g2.gameId, g2.seats[0]!.seatToken, a.id, 'Brian')
    await new Promise((r) => setTimeout(r, 5))
    await s.append(g1.gameId, g1.seats[0]!.seatToken, 0, RED_FIRST_LEAD)
    expect(s.accountSeats(a.id).map((x) => x.gameId)).toEqual([g1.gameId, g2.gameId])
  })

  it('migrates an old database', () => {
    const path = tempDbPath()
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    const old = new DatabaseSync(path)
    old.exec(`CREATE TABLE game (id TEXT PRIMARY KEY, options TEXT NOT NULL, created_at INTEGER NOT NULL,
      webhook_url TEXT, last_notified_length INTEGER NOT NULL DEFAULT -1, last_notified_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE seat (game_id TEXT NOT NULL, ord INTEGER NOT NULL, faction TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
      name TEXT, is_bot INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, ord));
      INSERT INTO game (id, options, created_at) VALUES ('g', '{}', 42);
      INSERT INTO seat (game_id, ord, faction, token) VALUES ('g', 0, 'red', 't');`)
    old.close()
    const s = new SqliteStore(path)
    const a = s.upsertAccount({ discordId: '111111111111111111', discordName: 'bri', displayName: 'Brian' })
    s.claim('g', 't', a.id, 'Brian')
    expect(s.accountSeats(a.id)).toEqual([{ gameId: 'g', seatToken: 't', faction: 'red', createdAt: 42, updatedAt: 42 }])
    // A crash between adding updated_at and backfilling it: the next open finishes the job.
    s.close()
    const half = new DatabaseSync(path)
    half.exec('UPDATE game SET updated_at = 0')
    half.close()
    expect(new SqliteStore(path).accountSeats(a.id)[0]!.updatedAt).toBe(42)
  })
})
