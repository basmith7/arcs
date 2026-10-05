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
  readonly accountId?: string
  readonly ownerName?: string
}

export interface Account {
  readonly id: string
  readonly discordId: string
  readonly discordName: string
  readonly displayName: string
}

export interface AccountSeat {
  readonly gameId: string
  readonly seatToken: string
  readonly faction: string
  readonly createdAt: number
  readonly updatedAt: number
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
  last_notified_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
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
  account_id TEXT,
  PRIMARY KEY (game_id, ord)
);
CREATE TABLE IF NOT EXISTS journal (
  game_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  action TEXT NOT NULL,
  PRIMARY KEY (game_id, idx)
);
CREATE TABLE IF NOT EXISTS account (
  id            TEXT PRIMARY KEY,
  discord_id    TEXT NOT NULL UNIQUE,
  discord_name  TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  token_hash    TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES account(id),
  expires_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS catchup (
  game_id TEXT NOT NULL,
  faction TEXT NOT NULL,
  journal_len INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, faction, journal_len)
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
  account_id: string | null
  owner_name: string | null
}

interface AccountDb {
  id: string
  discord_id: string
  discord_name: string
  display_name: string
}

// Shared by `seats()` and `seatByToken`: a claimed seat (account_id set) reads its Discord id and
// name through the account, not the seat's own (possibly stale) columns; `owner_name` surfaces the
// account's display name so a watcher can see who holds a seat.
const SEAT_SELECT = `
SELECT s.faction, s.token, s.name, s.is_bot, s.pings, s.account_id,
  CASE WHEN s.account_id IS NULL THEN s.discord_id ELSE a.discord_id END AS discord_id,
  CASE WHEN s.account_id IS NULL THEN s.discord_name ELSE a.discord_name END AS discord_name,
  a.display_name AS owner_name
FROM seat s LEFT JOIN account a ON a.id = s.account_id
`

// With login off, a seat claimed earlier reads as the plain link seat it was before: its own Discord
// columns, no account, no owner — so Unlink, the pasted-id form and pings all act on the seat.
const SEAT_SELECT_NO_ACCOUNTS = `
SELECT s.faction, s.token, s.name, s.is_bot, s.pings, NULL AS account_id,
  s.discord_id, s.discord_name, NULL AS owner_name
FROM seat s
`

// Vite 5 (which vitest runs on) does not know `node:sqlite` as a builtin and would try to resolve a
// bare `sqlite` package, so the module is reached through `createRequire` — the same trick as
// packages/server/test/cloudflare.test.ts. Types still come from @types/node. Works unchanged
// under tsx and inside the esbuild bundle.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
type Db = InstanceType<typeof DatabaseSync>

export class SqliteStore implements GameStore {
  private readonly db: Db
  private readonly watchers = new Map<GameId, Set<OnAppend>>()

  private readonly seatSelect: string

  /** `accounts` is whether Discord login is on; off, seat reads ignore claims (SEAT_SELECT_NO_ACCOUNTS). */
  constructor(path: string, { accounts = true }: { accounts?: boolean } = {}) {
    this.seatSelect = accounts ? SEAT_SELECT : SEAT_SELECT_NO_ACCOUNTS
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.migrate()
  }

  /**
   * Production databases predate `discord_id`/`discord_name`/`account_id` on `seat` and
   * `updated_at` on `game`. `CREATE TABLE IF NOT EXISTS` never adds columns to an existing table,
   * so an old file needs explicit `ALTER TABLE`s on open, each guarded by `PRAGMA table_info` so a
   * fresh database (which already has the columns from `SCHEMA`) is left alone.
   */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(seat)').all() as { name: string }[]
    const have = new Set(columns.map((c) => c.name))
    if (!have.has('discord_id')) this.db.exec('ALTER TABLE seat ADD COLUMN discord_id TEXT')
    if (!have.has('discord_name')) this.db.exec('ALTER TABLE seat ADD COLUMN discord_name TEXT')
    if (!have.has('pings')) this.db.exec('ALTER TABLE seat ADD COLUMN pings INTEGER NOT NULL DEFAULT 1')
    if (!have.has('account_id')) this.db.exec('ALTER TABLE seat ADD COLUMN account_id TEXT')
    const gameCols = new Set((this.db.prepare('PRAGMA table_info(game)').all() as { name: string }[]).map((c) => c.name))
    if (!gameCols.has('updated_at')) this.db.exec('ALTER TABLE game ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
    // Every open, not just the one that added the column, so a crash between the two finishes here.
    this.db.exec('UPDATE game SET updated_at = created_at WHERE updated_at = 0')
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
      const now = Date.now()
      this.db
        .prepare('INSERT INTO game (id, options, created_at, updated_at, webhook_url) VALUES (?, ?, ?, ?, ?)')
        .run(gameId, JSON.stringify(options), now, now, extra.webhookUrl ?? null)
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
      this.db.prepare('UPDATE game SET updated_at = ? WHERE id = ?').run(Date.now(), gameId)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    const next = length + 1
    for (const watcher of this.watchers.get(gameId) ?? []) watcher(next)
    return { ok: true, length: next }
  }

  /**
   * Remove the last journal row, compare-and-set on the length like `append`. The take-back
   * (`EngineGate.takeBack`) is the only caller and has already judged that the row may go.
   *
   * Also lowers the notified mark to the new length, so replaying the same move pings the next
   * player again rather than being taken for a ping already sent.
   */
  truncateLast(gameId: GameId, expectedLength: number): { ok: true; length: number } | { ok: false; length: number } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const length = this.length(gameId)
      if (length !== expectedLength || length === 0) {
        this.db.exec('ROLLBACK')
        return { ok: false, length }
      }
      this.db.prepare('DELETE FROM journal WHERE game_id = ? AND idx = ?').run(gameId, length - 1)
      this.db
        .prepare('UPDATE game SET last_notified_length = MIN(last_notified_length, ?) WHERE id = ?')
        .run(length - 1, gameId)
      this.db.prepare('UPDATE game SET updated_at = ? WHERE id = ?').run(Date.now(), gameId)
      this.db.exec('COMMIT')
      return { ok: true, length: length - 1 }
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
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
      .prepare(`${this.seatSelect} WHERE s.game_id = ? ORDER BY s.ord`)
      .all(gameId)
      .map((r) => toSeat(r as unknown as SeatDb))
  }

  setPings(gameId: GameId, seatToken: SeatToken, pings: boolean): SeatRow[] | undefined {
    const seat = this.seatByToken(gameId, seatToken)
    if (seat === undefined) return undefined
    this.db.prepare('UPDATE seat SET pings = ? WHERE token = ? AND game_id = ?').run(pings ? 1 : 0, seatToken, gameId)
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

  // --- turn catch-up stories (catchup.ts) ----------------------------------

  /** Stores a seat's story for one journal length; the seat's older stories go. */
  putCatchup(gameId: GameId, faction: string, journalLen: number, text: string, now: number): void {
    this.db.prepare('DELETE FROM catchup WHERE game_id = ? AND faction = ?').run(gameId, faction)
    this.db
      .prepare('INSERT INTO catchup (game_id, faction, journal_len, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(gameId, faction, journalLen, text, now)
  }

  /** Only the story written for exactly this length: a take-back or a later move makes it stale. */
  getCatchup(gameId: GameId, faction: string, journalLen: number): string | undefined {
    const row = this.db
      .prepare('SELECT text FROM catchup WHERE game_id = ? AND faction = ? AND journal_len = ?')
      .get(gameId, faction, journalLen) as { text: string } | undefined
    return row?.text
  }

  /** All of a game's stories, or only those for turns that began after `fromLength` (a take-back). */
  deleteCatchups(gameId: GameId, fromLength?: number): void {
    if (fromLength === undefined) this.db.prepare('DELETE FROM catchup WHERE game_id = ?').run(gameId)
    else this.db.prepare('DELETE FROM catchup WHERE game_id = ? AND journal_len > ?').run(gameId, fromLength)
  }

  /** The seat a token belongs to in this game, if it does. */
  seatForToken(gameId: GameId, token: SeatToken): SeatRow | undefined {
    return this.seatByToken(gameId, token)
  }

  // --- private --------------------------------------------------------------

  private length(gameId: GameId): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM journal WHERE game_id = ?').get(gameId) as {
      n: number
    }
    return row.n
  }

  seatByToken(gameId: GameId, token: SeatToken): SeatRow | undefined {
    const row = this.db
      .prepare(`${this.seatSelect} WHERE s.game_id = ? AND s.token = ?`)
      .get(gameId, token) as unknown as SeatDb | undefined
    return row === undefined ? undefined : toSeat(row)
  }

  // --- accounts, sessions, claims --------------------------------------------

  upsertAccount(p: { discordId: string; discordName: string; displayName: string }): Account {
    this.db
      .prepare(
        `INSERT INTO account (id, discord_id, discord_name, display_name, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(discord_id) DO UPDATE SET discord_name = excluded.discord_name, display_name = excluded.display_name`,
      )
      .run(randomId(), p.discordId, p.discordName, p.displayName, Date.now())
    const row = this.db.prepare('SELECT id, discord_id, discord_name, display_name FROM account WHERE discord_id = ?').get(
      p.discordId,
    ) as unknown as AccountDb
    return toAccount(row)
  }

  createSession(accountId: string, tokenHash: string, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO session (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash, accountId, expiresAt)
  }

  sessionAccount(tokenHash: string, now: number): { account: Account; expiresAt: number } | undefined {
    const row = this.db
      .prepare(
        `SELECT a.id, a.discord_id, a.discord_name, a.display_name, s.expires_at
         FROM session s JOIN account a ON a.id = s.account_id WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as (AccountDb & { expires_at: number }) | undefined
    if (row === undefined) return undefined
    if (row.expires_at <= now) {
      this.db.prepare('DELETE FROM session WHERE token_hash = ?').run(tokenHash)
      return undefined
    }
    return { account: toAccount(row), expiresAt: row.expires_at }
  }

  extendSession(tokenHash: string, expiresAt: number): void {
    this.db.prepare('UPDATE session SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash)
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM session WHERE token_hash = ?').run(tokenHash)
  }

  sweepSessions(now: number): void {
    this.db.prepare('DELETE FROM session WHERE expires_at <= ?').run(now)
  }

  claim(gameId: GameId, seatToken: SeatToken, accountId: string, name: string): SeatRow[] | undefined {
    const seat = this.seatByToken(gameId, seatToken)
    if (seat === undefined) return undefined
    this.db
      .prepare('UPDATE seat SET account_id = ?, name = ? WHERE game_id = ? AND token = ?')
      .run(accountId, name, gameId, seatToken)
    return this.seats(gameId)
  }

  release(gameId: GameId, seatToken: SeatToken): SeatRow[] | undefined {
    const seat = this.seatByToken(gameId, seatToken)
    if (seat === undefined) return undefined
    this.db.prepare('UPDATE seat SET account_id = NULL WHERE game_id = ? AND token = ?').run(gameId, seatToken)
    return this.seats(gameId)
  }

  accountSeats(accountId: string): AccountSeat[] {
    return this.db
      .prepare(
        `SELECT s.game_id, s.token, s.faction, g.created_at, g.updated_at FROM seat s
         JOIN game g ON g.id = s.game_id WHERE s.account_id = ? ORDER BY g.updated_at DESC, g.created_at DESC`,
      )
      .all(accountId)
      .map(
        (r) => {
          const row = r as { game_id: string; token: string; faction: string; created_at: number; updated_at: number }
          return {
            gameId: row.game_id,
            seatToken: row.token,
            faction: row.faction,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        },
      )
  }
}

function toAccount(r: AccountDb): Account {
  return { id: r.id, discordId: r.discord_id, discordName: r.discord_name, displayName: r.display_name }
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
    ...(r.account_id === null ? {} : { accountId: r.account_id }),
    ...(r.owner_name === null ? {} : { ownerName: r.owner_name }),
  }
}
