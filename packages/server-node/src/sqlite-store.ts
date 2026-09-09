/**
 * The upstream `GameStore` contract on `node:sqlite`, plus what the self-hosted server needs on
 * top: which seats are bots, seat names, the notification webhook and its bookkeeping.
 *
 * Turn order is deliberately NOT checked here — `packages/server/test/contract.ts` pins that for
 * every store, and it is the gate's job (`gate.ts`). This class stays a dumb journal.
 */
import { createRequire } from 'node:module'

import { actorOf, randomId } from '@arcs/server'
import type {
  AppendResult,
  CreatedGame,
  GameId,
  GameStore,
  GameTail,
  OnAppend,
  SeatToken,
  Unsubscribe,
} from '@arcs/server'

export interface SeatRow {
  readonly faction: string
  readonly seatToken: string
  readonly name?: string
  readonly isBot: boolean
  readonly discordId?: string
  readonly discordName?: string
  readonly pings: boolean
}

/**
 * What to do with a seat's Discord link on a name claim: `undefined` leaves it untouched, `null`
 * clears both the id and the username, and an object sets the id (and the username when given,
 * else clears the stored username since it can no longer be trusted to match).
 */
export type DiscordLink = { readonly id: string; readonly name?: string } | null | undefined

export interface CreateExtra {
  readonly bots?: readonly string[]
  readonly webhookUrl?: string
}

export interface GameMeta {
  readonly webhookUrl?: string
  readonly lastNotifiedLength: number
  readonly lastNotifiedAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS game (
  id TEXT PRIMARY KEY,
  options TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  webhook_url TEXT,
  last_notified_length INTEGER NOT NULL DEFAULT -1,
  last_notified_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seat (
  game_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  faction TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  name TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  discord_id TEXT,
  discord_name TEXT,
  pings INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game_id, ord)
);
CREATE TABLE IF NOT EXISTS journal (
  game_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  action TEXT NOT NULL,
  PRIMARY KEY (game_id, idx)
);
`

interface SeatDb {
  faction: string
  token: string
  name: string | null
  is_bot: number
  discord_id: string | null
  discord_name: string | null
  pings: number
}

// Vite 5 (which vitest runs on) does not know `node:sqlite` as a builtin and would try to resolve a
// bare `sqlite` package, so the module is reached through `createRequire` — the same trick as
// packages/server/test/cloudflare.test.ts. Types still come from @types/node. Works unchanged
// under tsx and inside the esbuild bundle.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
type Db = InstanceType<typeof DatabaseSync>

export class SqliteStore implements GameStore {
  private readonly db: Db
  private readonly watchers = new Map<GameId, Set<OnAppend>>()

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.migrateSeatColumns()
  }

  /**
   * Production databases predate `discord_id`/`discord_name` on `seat`. `CREATE TABLE IF NOT
   * EXISTS` never adds columns to an existing table, so an old file needs an explicit `ALTER TABLE`
   * on open, guarded by `PRAGMA table_info` so a fresh database (which already has the columns from
   * `SCHEMA`) is left alone.
   */
  private migrateSeatColumns(): void {
    const columns = this.db.prepare('PRAGMA table_info(seat)').all() as { name: string }[]
    const have = new Set(columns.map((c) => c.name))
    if (!have.has('discord_id')) this.db.exec('ALTER TABLE seat ADD COLUMN discord_id TEXT')
    if (!have.has('discord_name')) this.db.exec('ALTER TABLE seat ADD COLUMN discord_name TEXT')
    if (!have.has('pings')) this.db.exec('ALTER TABLE seat ADD COLUMN pings INTEGER NOT NULL DEFAULT 1')
  }

  close(): void {
    this.db.close()
  }

  // --- GameStore ------------------------------------------------------------

  async create(
    options: unknown,
    factions: readonly string[],
    extra: CreateExtra = {},
  ): Promise<CreatedGame> {
    const gameId = randomId()
    const bots = new Set(extra.bots ?? [])
    const seats = factions.map((faction) => ({ faction, seatToken: randomId() }))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare('INSERT INTO game (id, options, created_at, webhook_url) VALUES (?, ?, ?, ?)')
        .run(gameId, JSON.stringify(options), Date.now(), extra.webhookUrl ?? null)
      const insert = this.db.prepare(
        'INSERT INTO seat (game_id, ord, faction, token, is_bot) VALUES (?, ?, ?, ?, ?)',
      )
      seats.forEach((s, ord) => insert.run(gameId, ord, s.faction, s.seatToken, bots.has(s.faction) ? 1 : 0))
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { gameId, seats }
  }

  async read(gameId: GameId, since: number, seatToken?: SeatToken): Promise<GameTail | undefined> {
    const options = this.options(gameId)
    if (options === undefined) return undefined
    const length = this.length(gameId)
    const from = Math.max(0, Math.min(since, length))
    const entries = this.db
      .prepare('SELECT action FROM journal WHERE game_id = ? AND idx >= ? ORDER BY idx')
      .all(gameId, from)
      .map((r) => (r as { action: string }).action)
    const seat = seatToken === undefined ? undefined : this.seatByToken(gameId, seatToken)
    return {
      options,
      entries,
      length,
      ...(seat === undefined ? {} : { yourFaction: seat.faction }),
    }
  }

  async append(
    gameId: GameId,
    seatToken: SeatToken,
    expectedLength: number,
    action: string,
  ): Promise<AppendResult> {
    if (this.options(gameId) === undefined) return { ok: false, reason: 'no-such-game' }
    const seat = this.seatByToken(gameId, seatToken)
    if (seat === undefined) return { ok: false, reason: 'bad-seat' }
    const actor = actorOf(action)
    if (actor !== undefined && actor !== seat.faction) return { ok: false, reason: 'wrong-faction' }

    // The compare-and-set. BEGIN IMMEDIATE takes the write lock before the count is read, so two
    // appends racing on the same expectedLength serialise here and exactly one wins.
    this.db.exec('BEGIN IMMEDIATE')
    let length: number
    try {
      length = this.length(gameId)
      if (expectedLength !== length) {
        this.db.exec('ROLLBACK')
        return { ok: false, reason: 'conflict', length }
      }
      this.db
        .prepare('INSERT INTO journal (game_id, idx, action) VALUES (?, ?, ?)')
        .run(gameId, length, action)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    const next = length + 1
    for (const watcher of this.watchers.get(gameId) ?? []) watcher(next)
    return { ok: true, length: next }
  }

  subscribe(gameId: GameId, onAppend: OnAppend): Unsubscribe {
    let set = this.watchers.get(gameId)
    if (set === undefined) {
      set = new Set()
      this.watchers.set(gameId, set)
    }
    set.add(onAppend)
    return () => {
      set.delete(onAppend)
    }
  }

  // --- extras ---------------------------------------------------------------

  seats(gameId: GameId): SeatRow[] {
    return this.db
      .prepare('SELECT faction, token, name, is_bot, discord_id, discord_name, pings FROM seat WHERE game_id = ? ORDER BY ord')
      .all(gameId)
      .map((r) => toSeat(r as unknown as SeatDb))
  }

  setPings(gameId: GameId, seatToken: SeatToken, pings: boolean): SeatRow[] | undefined {
    const seat = this.seatByToken(gameId, seatToken)
    if (seat === undefined) return undefined
    this.db.prepare('UPDATE seat SET pings = ? WHERE token = ?').run(pings ? 1 : 0, seatToken)
    return this.seats(gameId)
  }

  journalLength(gameId: GameId): number {
    return this.length(gameId)
  }

  setName(gameId: GameId, seatToken: SeatToken, name: string, discord?: DiscordLink): SeatRow[] | undefined {
    const seat = this.seatByToken(gameId, seatToken)
    if (seat === undefined) return undefined
    if (discord === undefined) {
      this.db.prepare('UPDATE seat SET name = ? WHERE token = ?').run(name, seatToken)
    } else if (discord === null) {
      this.db
        .prepare('UPDATE seat SET name = ?, discord_id = NULL, discord_name = NULL WHERE token = ?')
        .run(name, seatToken)
    } else {
      this.db
        .prepare('UPDATE seat SET name = ?, discord_id = ?, discord_name = ? WHERE token = ?')
        .run(name, discord.id, discord.name ?? null, seatToken)
    }
    return this.seats(gameId)
  }

  journal(gameId: GameId): string[] {
    return this.db
      .prepare('SELECT action FROM journal WHERE game_id = ? ORDER BY idx')
      .all(gameId)
      .map((r) => (r as { action: string }).action)
  }

  options(gameId: GameId): unknown | undefined {
    const row = this.db.prepare('SELECT options FROM game WHERE id = ?').get(gameId) as
      | { options: string }
      | undefined
    return row === undefined ? undefined : (JSON.parse(row.options) as unknown)
  }

  meta(gameId: GameId): GameMeta | undefined {
    const row = this.db
      .prepare('SELECT webhook_url, last_notified_length, last_notified_at FROM game WHERE id = ?')
      .get(gameId) as
      | { webhook_url: string | null; last_notified_length: number; last_notified_at: number }
      | undefined
    if (row === undefined) return undefined
    return {
      ...(row.webhook_url === null ? {} : { webhookUrl: row.webhook_url }),
      lastNotifiedLength: row.last_notified_length,
      lastNotifiedAt: row.last_notified_at,
    }
  }

  markNotified(gameId: GameId, length: number, at: number): void {
    this.db
      .prepare('UPDATE game SET last_notified_length = ?, last_notified_at = ? WHERE id = ?')
      .run(length, at, gameId)
  }

  gameIds(): string[] {
    return this.db
      .prepare('SELECT id FROM game ORDER BY created_at')
      .all()
      .map((r) => (r as { id: string }).id)
  }

  // --- private --------------------------------------------------------------

  private length(gameId: GameId): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM journal WHERE game_id = ?').get(gameId) as {
      n: number
    }
    return row.n
  }

  private seatByToken(gameId: GameId, token: SeatToken): SeatRow | undefined {
    const row = this.db
      .prepare('SELECT faction, token, name, is_bot, discord_id, discord_name, pings FROM seat WHERE game_id = ? AND token = ?')
      .get(gameId, token) as unknown as SeatDb | undefined
    return row === undefined ? undefined : toSeat(row)
  }
}

function toSeat(r: SeatDb): SeatRow {
  return {
    faction: r.faction,
    seatToken: r.token,
    ...(r.name === null ? {} : { name: r.name }),
    isBot: r.is_bot === 1,
    ...(r.discord_id === null ? {} : { discordId: r.discord_id }),
    ...(r.discord_name === null ? {} : { discordName: r.discord_name }),
    pings: r.pings !== 0,
  }
}
