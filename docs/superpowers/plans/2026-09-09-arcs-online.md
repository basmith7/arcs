# Arcs Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the forked open-arcs client behind a Node + SQLite server that runs the engine (turn checks, server-side bots, Discord turn pings), deployed on Tower at `https://arcs.basmith.net`.

**Architecture:** A new workspace `packages/server-node` owns everything server-side: `SqliteStore` (upstream's `GameStore` contract on `node:sqlite`), `EngineGate` (wraps the store, replays the journal, rejects out-of-turn actions, steps bot seats, emits pushes), `Notifier` (Discord webhook), a web-standard `api.ts` router and a `node:http` + `ws` host that also serves `apps/web/dist`. The client gains four small additive changes: bots are sent on create, a webhook field, a name prompt on first seat open, and names on the seat badge. Deployment is a multi-stage Docker image pushed to ghcr.io by GitHub Actions on `v*` tags and rolled out by golfbet's Watchtower on Tower.

**Tech Stack:** Node 22 (`node:sqlite`, `node:http`), TypeScript 5, `ws`, `esbuild` (bundle the server), vitest, Vite + React 18 client (unchanged toolchain), Docker, GitHub Actions, Pangolin/Newt.

**Spec:** `docs/superpowers/specs/2026-09-09-arcs-online-design.md`

**Model guidance (Brian's rule: cheapest model for the job):** each task carries a `Model:` line. Use it when dispatching subagents. Escalate one tier only if the task fails twice.

## Global Constraints

- Node `>=22` (root `package.json` engines). `node:sqlite` prints an `ExperimentalWarning` on Node 22; run the server with `--no-warnings=ExperimentalWarning`.
- Keep `packages/engine`, `packages/server` and `apps/web` changes minimal and additive so `git merge upstream/main` stays cheap. Never edit upstream test files.
- All existing tests (1029) and `npm run typecheck` must stay green after every task.
- `tsconfig.base.json` has `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Spread optional keys (`...(x === undefined ? {} : { x })`), never assign `undefined`. Import types with `import type`. Use `.js` extensions on relative imports.
- Dev ports: `3070` Node server (API + built client), `3071` Vite dev server. Production container listens on `3070`.
- Seat name: 1–24 characters after trim.
- Push message shape on the live socket is exactly `{ "from": number, "entries": string[] }` plus an optional `seats` array; `session.ts` must keep parsing it.
- Webhook URL is never returned by any endpoint.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never tag a release, push to Tower, or touch Pangolin outside Tasks 11–12.

---

## File structure

```
packages/server-node/
  package.json               workspace @arcs/server-node: deps ws; dev: @types/node, @types/ws, esbuild, tsx
  tsconfig.json              ES2022 + DOM libs, types ["node"], noEmit (typecheck only; esbuild emits)
  src/sqlite-store.ts        SqliteStore implements GameStore (+ seats/names/bots/meta extras)
  src/gate.ts                EngineGate: replay cache, turn check, bot stepping, push fan-out, resume
  src/notify.ts              Notifier: Discord webhook decisions + POST
  src/api.ts                 route(Request) -> Response for /games*, /healthz (web-standard, testable)
  src/server.ts              createServer(): node:http shim + ws upgrade + static files
  src/main.ts                reads env, opens db, wires gate/notifier/server, resumes bots, listens
  test/sqlite-store.test.ts  upstream contract + extras
  test/gate.test.ts          turn check, bot stepping, resume
  test/notify.test.ts        webhook decisions with a fake poster
  test/api.test.ts           routes via new Request()
  test/server.test.ts        real listener on port 0: fetch + ws round trip + static
  test/fixtures.ts           shared: temp db path, a 3-player options object, first legal action
apps/web/src/multiplayer/client.ts   create(extra), read() seats, claimName()
apps/web/src/multiplayer/session.ts  seats on adopt/poll/push; publish errors -> resync
apps/web/src/store.ts                seats + mySeatName + claimName
apps/web/src/components/NewGame.tsx  send bots, webhook field
apps/web/src/components/ShareGame.tsx hide bot rows
apps/web/src/components/NamePrompt.tsx new modal
apps/web/src/components/SeatBadge.tsx names
apps/web/src/App.tsx                 mount NamePrompt, name in turn badge
Dockerfile, .dockerignore, docker-compose.prod.yml, .github/workflows/deploy.yml
~/Projects/PORTS.md, ~/Projects/.devports (port registry)
~/Documents/Vault 13/Infrastructure.md, ~/Documents/Vault 13/Projects/Pangolin VPS Migration.md
```

---

### Task 1: Workspace scaffold and port registry

**Model:** haiku

**Files:**
- Create: `packages/server-node/package.json`, `packages/server-node/tsconfig.json`, `packages/server-node/src/main.ts` (stub), `packages/server-node/test/smoke.test.ts`
- Modify: `tsconfig.json` (root references), `package.json` (root scripts), `~/Projects/PORTS.md`, `~/Projects/.devports`

**Interfaces:**
- Produces: workspace `@arcs/server-node` with scripts `typecheck`, `dev`, `build`, `start`.

- [ ] **Step 1: Install dependencies and confirm the baseline is green**

```bash
cd ~/Projects/arcs && npm ci && npm test 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3
```
Expected: `Tests  1029 passed`, typecheck exits 0.

- [ ] **Step 2: Create the package**

`packages/server-node/package.json`:
```json
{
  "name": "@arcs/server-node",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "comment": "The self-hosted server. Unlike @arcs/server it DOES import the engine: it replays the journal to check turns, play bot seats and know whose turn it is. See docs/superpowers/specs/2026-09-09-arcs-online-design.md section 4.",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "dev": "tsx watch --no-warnings=ExperimentalWarning src/main.ts",
    "build": "esbuild src/main.ts --bundle --platform=node --format=esm --target=node22 --external:ws --outfile=dist/main.js",
    "start": "node --no-warnings=ExperimentalWarning dist/main.js"
  },
  "dependencies": {
    "@arcs/engine": "*",
    "@arcs/server": "*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "esbuild": "^0.24.0",
    "tsx": "^4.19.0"
  }
}
```

`packages/server-node/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "test"]
}
```
(`DOM` is for `Request`/`Response`/`fetch`, same as `packages/server`. `noEmit` because esbuild does the emit; this package is not a composite reference.)

`packages/server-node/src/main.ts` (stub, replaced in Task 6):
```ts
console.log('arcs server-node: not wired yet')
```

`packages/server-node/test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

describe('server-node workspace', () => {
  it('can open an in-memory node:sqlite database', () => {
    const db = new DatabaseSync(':memory:')
    expect(db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 })
    db.close()
  })
})
```

- [ ] **Step 3: Wire root scripts**

In root `package.json` `scripts`, add:
```json
"typecheck:node": "tsc -p packages/server-node --noEmit",
"dev:server": "npm run dev --workspace @arcs/server-node",
"build:server": "npm run build --workspace @arcs/server-node",
"build:all": "npm run build:site && npm run build:server"
```
and change `"typecheck"` to:
```json
"typecheck": "tsc --build --force && tsc -p apps/web --noEmit && tsc -p packages/server-node --noEmit"
```

- [ ] **Step 4: Install and verify**

```bash
cd ~/Projects/arcs && npm install && npx vitest run packages/server-node && npm run typecheck 2>&1 | tail -3
```
Expected: 1 test passes; typecheck exits 0 (the stub has no errors).

- [ ] **Step 5: Register the ports**

Append to the table in `~/Projects/PORTS.md` after the `3060–3069` row (match the existing `| Block | Project | Ports |` format):
```
| 3070–3079 | arcs | 3070 server (API + built client), 3071 vite |
```
Append to `~/Projects/.devports`:
```
arcs	3070	server	npm	arcs
arcs	3071	vite	npm	arcs
```
(tab-separated, like the other rows.)

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/arcs && git add -A && git commit -m "server-node: workspace scaffold

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(PORTS.md / .devports live outside the repo; no commit needed there.)

---

### Task 2: SqliteStore

**Model:** sonnet

**Files:**
- Create: `packages/server-node/src/sqlite-store.ts`, `packages/server-node/test/sqlite-store.test.ts`, `packages/server-node/test/fixtures.ts`
- Delete: `packages/server-node/test/smoke.test.ts`

**Interfaces:**
- Consumes: `GameStore`, `AppendResult`, `CreatedGame`, `GameTail`, `actorOf`, `randomId` from `@arcs/server`.
- Produces:
```ts
export interface SeatRow { faction: string; seatToken: string; name?: string; isBot: boolean }
export interface CreateExtra { bots?: readonly string[]; webhookUrl?: string }
export interface GameMeta { webhookUrl?: string; lastNotifiedLength: number; lastNotifiedAt: number }
export class SqliteStore implements GameStore {
  constructor(path: string)               // ':memory:' allowed
  create(options, factions, extra?: CreateExtra): Promise<CreatedGame>   // seats include bots (tokens minted for all)
  read(gameId, since, seatToken?): Promise<GameTail | undefined>
  append(gameId, seatToken, expectedLength, action): Promise<AppendResult>
  subscribe(gameId, onAppend): Unsubscribe
  seats(gameId): SeatRow[]                // [] for unknown game
  setName(gameId, seatToken, name): SeatRow[] | undefined   // undefined = bad seat
  journal(gameId): string[]
  options(gameId): unknown | undefined
  meta(gameId): GameMeta | undefined
  markNotified(gameId, length: number, at: number): void
  gameIds(): string[]
  close(): void
}
```

- [ ] **Step 1: Write fixtures**

`packages/server-node/test/fixtures.ts`:
```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NewGameOptions } from '@arcs/engine'

/** Three players, base game, fixed seed. Red leads first (verified by probe). */
export const THREE_PLAYER: NewGameOptions = {
  board: 'Board3MixUp',
  factions: ['red', 'yellow', 'blue'],
  seed: 7,
}

/** Same table with two bot seats: red is the only human. */
export const ONE_HUMAN: NewGameOptions = { ...THREE_PLAYER, bots: ['yellow', 'blue'] }

/** Red's first legal action for THREE_PLAYER seed 7 (from `startGame(...).continue.actions[0]`). */
export const RED_FIRST_LEAD = 'turn/lead(card="Aggression-4",faction="red",suit="Aggression")'

export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'arcs-')), 'arcs.db')
}
```

- [ ] **Step 2: Write the failing tests**

`packages/server-node/test/sqlite-store.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to verify failure**

```bash
cd ~/Projects/arcs && rm packages/server-node/test/smoke.test.ts && npx vitest run packages/server-node 2>&1 | tail -5
```
Expected: FAIL, cannot find `../src/sqlite-store.js`.

- [ ] **Step 4: Implement the store**

`packages/server-node/src/sqlite-store.ts`:
```ts
/**
 * The upstream `GameStore` contract on `node:sqlite`, plus what the self-hosted server needs on
 * top: which seats are bots, seat names, the notification webhook and its bookkeeping.
 *
 * Turn order is deliberately NOT checked here — `packages/server/test/contract.ts` pins that for
 * every store, and it is the gate's job (`gate.ts`). This class stays a dumb journal.
 */
import { DatabaseSync } from 'node:sqlite'

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
}

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
}

export class SqliteStore implements GameStore {
  private readonly db: DatabaseSync
  private readonly watchers = new Map<GameId, Set<OnAppend>>()

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
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
      .prepare('SELECT faction, token, name, is_bot FROM seat WHERE game_id = ? ORDER BY ord')
      .all(gameId)
      .map((r) => toSeat(r as SeatDb))
  }

  setName(gameId: GameId, seatToken: SeatToken, name: string): SeatRow[] | undefined {
    const seat = this.seatByToken(gameId, seatToken)
    if (seat === undefined) return undefined
    this.db.prepare('UPDATE seat SET name = ? WHERE token = ?').run(name, seatToken)
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
      .prepare('SELECT faction, token, name, is_bot FROM seat WHERE game_id = ? AND token = ?')
      .get(gameId, token) as SeatDb | undefined
    return row === undefined ? undefined : toSeat(row)
  }
}

function toSeat(r: SeatDb): SeatRow {
  return {
    faction: r.faction,
    seatToken: r.token,
    ...(r.name === null ? {} : { name: r.name }),
    isBot: r.is_bot === 1,
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node 2>&1 | tail -8 && npm run typecheck:node
```
Expected: two contract suites + 4 extras pass; typecheck clean. If the contract's "does NOT check whose turn it is" test fails, the store is checking something it must not.

- [ ] **Step 6: Commit**

```bash
git add packages/server-node && git commit -m "server-node: SqliteStore passes the upstream store contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: EngineGate — turn check, bot stepping, pushes, resume

**Model:** sonnet

**Files:**
- Create: `packages/server-node/src/gate.ts`, `packages/server-node/test/gate.test.ts`

**Interfaces:**
- Consumes: `SqliteStore` (Task 2); from `@arcs/engine`: `replayGame`, `applyExternal`, `decodeAction`, `encodeAction`, `defaultRegistry`, `botToAct`, `stepBot`, `botForLevel`, `NO_ASKS`, types `RuleResult`, `NewGameOptions`, `AskedThisTurn`, `FactionId`.
- Produces:
```ts
export interface Push { readonly from: number; readonly entries: readonly string[] }
export type GateAppend = AppendResult | { ok: false; reason: 'wrong-turn' | 'game-over' }
export interface Settled { gameId: string; before: RuleResult | null; after: RuleResult }
export interface GateOptions { pace?: number; onSettled?: (s: Settled) => void }
export class EngineGate {
  constructor(store: SqliteStore, opts?: GateOptions)
  resultOf(gameId): RuleResult | undefined
  askedFaction(gameId): string | undefined        // who must act, undefined if over/unknown
  append(gameId, seatToken, expectedLength, action): Promise<GateAppend>
  subscribe(gameId, listener: (push: Push) => void): () => void
  settled(gameId): Promise<void>                    // resolves when this game's bot queue is idle
  resumeAll(): Promise<void>
}
```
`onSettled` fires once per human-triggered append after any bot run finishes (or immediately if no bot acts), with `before` = result before the human action and `after` = result once bots are done. Task 4's notifier hangs off it.

- [ ] **Step 1: Write the failing tests**

`packages/server-node/test/gate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

import { encodeAction, replayGame } from '@arcs/engine'
import { EngineGate } from '../src/gate.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { ONE_HUMAN, RED_FIRST_LEAD, THREE_PLAYER, tempDbPath } from './fixtures.js'

async function table(options = THREE_PLAYER, path = ':memory:', pace = 0) {
  const store = new SqliteStore(path)
  const settled: { before: number; after: number }[] = []
  const gate = new EngineGate(store, {
    pace,
    onSettled: (s) => settled.push({ before: s.before?.state.journal.length ?? -1, after: s.after.state.journal.length }),
  })
  const game = await store.create(options, options.factions, { bots: options.bots ?? [] })
  const seat = (faction: string) => game.seats.find((s) => s.faction === faction)!.seatToken
  return { store, gate, game, seat, settled }
}

describe('EngineGate turn check', () => {
  it('accepts the acting faction and refuses everyone else', async () => {
    const { gate, game, seat } = await table()
    expect(gate.askedFaction(game.gameId)).toBe('red')
    const yellowLead = RED_FIRST_LEAD.replace('faction="red"', 'faction="yellow"')
    expect(await gate.append(game.gameId, seat('yellow'), 0, yellowLead)).toEqual({ ok: false, reason: 'wrong-turn' })
    expect(await gate.append(game.gameId, seat('red'), 0, RED_FIRST_LEAD)).toEqual({ ok: true, length: 1 })
    expect(gate.resultOf(game.gameId)?.state.journal).toEqual([RED_FIRST_LEAD])
  })

  it('still reports store failures unchanged', async () => {
    const { gate, game, seat } = await table()
    expect(await gate.append(game.gameId, 'bogus', 0, RED_FIRST_LEAD)).toEqual({ ok: false, reason: 'bad-seat' })
    expect(await gate.append(game.gameId, seat('red'), 3, RED_FIRST_LEAD)).toEqual({ ok: false, reason: 'conflict', length: 0 })
    expect(await gate.append('nope', seat('red'), 0, RED_FIRST_LEAD)).toEqual({ ok: false, reason: 'no-such-game' })
  })

  it('refuses an action the engine cannot decode without touching the journal', async () => {
    const { gate, game, seat, store } = await table()
    const r = await gate.append(game.gameId, seat('red'), 0, 'garbage(faction="red")')
    expect(r.ok).toBe(false)
    expect(store.journal(game.gameId)).toEqual([])
  })
})

describe('EngineGate bots', () => {
  it('plays the bot seats after a human action until a human is asked again', async () => {
    const { gate, game, seat, store, settled } = await table(ONE_HUMAN)
    const pushes: number[] = []
    gate.subscribe(game.gameId, (p) => pushes.push(p.from))
    expect(await gate.append(game.gameId, seat('red'), 0, RED_FIRST_LEAD)).toEqual({ ok: true, length: 1 })
    await gate.settled(game.gameId)
    const journal = store.journal(game.gameId)
    expect(journal.length).toBeGreaterThan(1)
    expect(gate.askedFaction(game.gameId)).toBe('red')
    // Every entry was pushed exactly once, in order.
    expect(pushes).toEqual(journal.map((_, i) => i))
    // Bot entries carry the bot's faction, so a replay on any client agrees.
    expect(journal.slice(1).every((e) => /faction="(yellow|blue)"/.test(e))).toBe(true)
    // What the gate holds equals a fresh replay of what the store holds.
    expect(gate.resultOf(game.gameId)?.state).toEqual(replayGame(ONE_HUMAN, journal).state)
    expect(settled).toEqual([{ before: 0, after: journal.length }])
  })

  it('resumes a game whose next ask is a bot when the server starts', async () => {
    const path = tempDbPath()
    const store = new SqliteStore(path)
    const game = await store.create(ONE_HUMAN, ONE_HUMAN.factions, { bots: ['yellow', 'blue'] })
    const red = game.seats[0]!.seatToken
    // Bare store: the human moves, no gate runs the bots. This is the "crashed mid-bot-turn" state.
    await store.append(game.gameId, red, 0, RED_FIRST_LEAD)
    store.close()

    const reopened = new SqliteStore(path)
    const gate = new EngineGate(reopened, { pace: 0 })
    await gate.resumeAll()
    await gate.settled(game.gameId)
    expect(reopened.journal(game.gameId).length).toBeGreaterThan(1)
    expect(gate.askedFaction(game.gameId)).toBe('red')
    reopened.close()
  })

  it('serialises a human append that arrives while bots are running', async () => {
    const { gate, game, seat, store } = await table(ONE_HUMAN, ':memory:', 5)
    await gate.append(game.gameId, seat('red'), 0, RED_FIRST_LEAD)
    // Bots are mid-run (pace 5 ms). A stale human append must lose cleanly, not corrupt.
    const r = await gate.append(game.gameId, seat('red'), 0, RED_FIRST_LEAD)
    expect(r.ok).toBe(false)
    await gate.settled(game.gameId)
    expect(gate.resultOf(game.gameId)?.state).toEqual(replayGame(ONE_HUMAN, store.journal(game.gameId)).state)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node/test/gate.test.ts 2>&1 | tail -5
```
Expected: FAIL, cannot find `../src/gate.js`.

- [ ] **Step 3: Implement the gate**

`packages/server-node/src/gate.ts`:
```ts
/**
 * The one place this server runs the rules.
 *
 * Wraps `SqliteStore` and, for each game, keeps the last replayed `RuleResult`. That answers three
 * questions the bare store cannot: is this action from the faction being asked (turn check), is a
 * bot being asked (then play it, here, so every client sees the same journal), and who is asked
 * now (notifications, via `onSettled`).
 *
 * Bot stepping for a game runs on a per-game promise chain, so a human append and a bot run never
 * interleave. `settled(gameId)` awaits that chain — tests and the notifier use it.
 */
import {
  applyExternal,
  botForLevel,
  botToAct,
  decodeAction,
  defaultRegistry,
  encodeAction,
  NO_ASKS,
  replayGame,
  stepBot,
} from '@arcs/engine'
import type { AskedThisTurn, NewGameOptions, RuleResult } from '@arcs/engine'
import type { AppendResult } from '@arcs/server'

import type { SqliteStore } from './sqlite-store.js'

export interface Push {
  readonly from: number
  readonly entries: readonly string[]
}

export type GateAppend = AppendResult | { readonly ok: false; readonly reason: 'wrong-turn' | 'game-over' }

export interface Settled {
  readonly gameId: string
  readonly before: RuleResult | null
  readonly after: RuleResult
}

export interface GateOptions {
  /** Milliseconds between bot actions so connected clients can follow. Default 1000. */
  readonly pace?: number
  readonly onSettled?: (s: Settled) => void
}

const CACHE_LIMIT = 100

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))

export function askedOf(result: RuleResult): string | undefined {
  const c = result.continue
  if (c.kind === 'ask') return c.faction
  if (c.kind === 'multiAsk') return c.asks[0]?.faction
  return undefined
}

export class EngineGate {
  private readonly registry = defaultRegistry()
  private readonly cache = new Map<string, RuleResult>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly listeners = new Map<string, Set<(push: Push) => void>>()
  private readonly pace: number
  private readonly onSettled: ((s: Settled) => void) | undefined

  constructor(
    private readonly store: SqliteStore,
    opts: GateOptions = {},
  ) {
    this.pace = opts.pace ?? 1000
    this.onSettled = opts.onSettled
  }

  // --- reading --------------------------------------------------------------

  resultOf(gameId: string): RuleResult | undefined {
    const hit = this.cache.get(gameId)
    if (hit !== undefined) {
      // Touch for LRU: delete + set moves it to the end of insertion order.
      this.cache.delete(gameId)
      this.cache.set(gameId, hit)
      return hit
    }
    const options = this.store.options(gameId) as NewGameOptions | undefined
    if (options === undefined) return undefined
    const result = replayGame(options, this.store.journal(gameId), this.registry)
    this.remember(gameId, result)
    return result
  }

  askedFaction(gameId: string): string | undefined {
    const result = this.resultOf(gameId)
    return result === undefined ? undefined : askedOf(result)
  }

  // --- writing --------------------------------------------------------------

  async append(
    gameId: string,
    seatToken: string,
    expectedLength: number,
    action: string,
  ): Promise<GateAppend> {
    // Wait for any bot run so the turn check sees the real head of the journal.
    await this.settled(gameId)
    let outcome: GateAppend = { ok: false, reason: 'no-such-game' }
    await this.enqueue(gameId, async () => {
      outcome = await this.appendNow(gameId, seatToken, expectedLength, action)
    })
    return outcome
  }

  private async appendNow(
    gameId: string,
    seatToken: string,
    expectedLength: number,
    action: string,
  ): Promise<GateAppend> {
    const before = this.resultOf(gameId)
    if (before === undefined) return { ok: false, reason: 'no-such-game' }
    if (before.state.isOver) return { ok: false, reason: 'game-over' }

    // Only the faction being asked may act. The store's own actorOf check still runs after.
    const asked = askedOf(before)
    const seat = this.store.seats(gameId).find((s) => s.seatToken === seatToken)
    if (seat === undefined) return { ok: false, reason: 'bad-seat' }
    if (asked !== undefined && seat.faction !== asked) return { ok: false, reason: 'wrong-turn' }

    // Prove the action replays before storing it, so a bad string never poisons the journal.
    let after: RuleResult
    try {
      if (before.state.journal.length !== expectedLength) {
        return { ok: false, reason: 'conflict', length: before.state.journal.length }
      }
      after = applyExternal(before, decodeAction(action), this.registry)
    } catch {
      return { ok: false, reason: 'wrong-turn' }
    }

    const stored = await this.store.append(gameId, seatToken, expectedLength, action)
    if (!stored.ok) return stored
    this.remember(gameId, after)
    this.emit(gameId, { from: expectedLength, entries: [action] })

    const done = await this.runBots(gameId, after)
    this.onSettled?.({ gameId, before, after: done })
    return stored
  }

  /** Play bot seats until a human is asked or the game ends. Returns the final result. */
  private async runBots(gameId: string, start: RuleResult): Promise<RuleResult> {
    const options = this.store.options(gameId) as NewGameOptions | undefined
    if (options === undefined) return start
    const bots = this.store.seats(gameId).filter((s) => s.isBot)
    if (bots.length === 0) return start
    const bot = botForLevel(options.botLevel)
    let result = start
    let asked: AskedThisTurn = NO_ASKS
    let lastFaction: string | undefined
    for (;;) {
      const faction = botToAct(result, options.bots)
      if (faction === undefined || result.state.isOver) return result
      const seat = bots.find((s) => s.faction === faction)
      if (seat === undefined) return result
      if (faction !== lastFaction) asked = NO_ASKS
      lastFaction = faction
      const step = stepBot(result, bot, faction, this.registry, asked)
      asked = step.asked
      const encoded = encodeAction(step.decision.action)
      const at = result.state.journal.length
      const stored = await this.store.append(gameId, seat.seatToken, at, encoded)
      if (!stored.ok) {
        // Someone wrote under us (should not happen on the queue); resync from the store.
        this.cache.delete(gameId)
        result = this.resultOf(gameId) ?? result
        continue
      }
      result = step.result
      this.remember(gameId, result)
      this.emit(gameId, { from: at, entries: [encoded] })
      await sleep(this.pace)
    }
  }

  async resumeAll(): Promise<void> {
    for (const gameId of this.store.gameIds()) {
      const result = this.resultOf(gameId)
      if (result === undefined || result.state.isOver) continue
      const options = this.store.options(gameId) as NewGameOptions
      if (botToAct(result, options.bots) === undefined) continue
      void this.enqueue(gameId, async () => {
        const done = await this.runBots(gameId, result)
        this.onSettled?.({ gameId, before: null, after: done })
      })
    }
  }

  // --- push -----------------------------------------------------------------

  subscribe(gameId: string, listener: (push: Push) => void): () => void {
    let set = this.listeners.get(gameId)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(gameId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  private emit(gameId: string, push: Push): void {
    for (const l of this.listeners.get(gameId) ?? []) {
      try {
        l(push)
      } catch {
        // A broken listener must not stop the others or the append.
      }
    }
  }

  // --- queue and cache ------------------------------------------------------

  settled(gameId: string): Promise<void> {
    return this.queues.get(gameId) ?? Promise.resolve()
  }

  private enqueue(gameId: string, job: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(gameId) ?? Promise.resolve()
    const next = prev.then(job, job)
    this.queues.set(gameId, next)
    return next.finally(() => {
      if (this.queues.get(gameId) === next) this.queues.delete(gameId)
    })
  }

  private remember(gameId: string, result: RuleResult): void {
    this.cache.delete(gameId)
    this.cache.set(gameId, result)
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
  }
}
```

Note on `append` racing: `append` awaits `settled` then enqueues; the queued job re-reads the cached result, so a stale `expectedLength` becomes a `conflict` (or `wrong-turn`), never a double write. The third test pins that.

- [ ] **Step 4: Run tests**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node 2>&1 | tail -8 && npm run typecheck:node
```
Expected: all gate tests pass. If `decodeAction` on `garbage(...)` does not throw, the third test may see `wrong-turn` from `applyExternal` instead — either way `ok` is false and the journal is empty, which is what is asserted.

- [ ] **Step 5: Commit**

```bash
git add packages/server-node && git commit -m "server-node: EngineGate checks turns and plays bot seats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Notifier (Discord webhook)

**Model:** sonnet

**Files:**
- Create: `packages/server-node/src/notify.ts`, `packages/server-node/test/notify.test.ts`

**Interfaces:**
- Consumes: `SqliteStore.meta/markNotified/seats`, `Settled` from gate, `askedOf` from gate.
- Produces:
```ts
export type Poster = (url: string, content: string) => Promise<void>
export interface NotifierOptions { publicOrigin: string; post?: Poster; now?: () => number; windowMs?: number }
export class Notifier { constructor(store: SqliteStore, opts: NotifierOptions); onSettled(s: Settled): Promise<void> }
export function seatLink(origin: string, gameId: string, seatToken?: string): string
```

- [ ] **Step 1: Write the failing tests**

`packages/server-node/test/notify.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

import { replayGame, startGame } from '@arcs/engine'
import type { RuleResult } from '@arcs/engine'
import { Notifier, seatLink } from '../src/notify.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { RED_FIRST_LEAD, THREE_PLAYER } from './fixtures.js'

const HOOK = 'https://discord.test/hook'

async function setup(webhookUrl: string | undefined = HOOK) {
  const store = new SqliteStore(':memory:')
  const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, webhookUrl === undefined ? {} : { webhookUrl })
  store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam')
  const sent: { url: string; content: string }[] = []
  let clock = 1_000_000
  const notifier = new Notifier(store, {
    publicOrigin: 'https://arcs.test',
    post: async (url, content) => {
      sent.push({ url, content })
    },
    now: () => clock,
    windowMs: 60_000,
  })
  const start = startGame(THREE_PLAYER)
  const afterRed = replayGame(THREE_PLAYER, [RED_FIRST_LEAD])
  return { store, game, sent, notifier, start, afterRed, tick: (ms: number) => (clock += ms) }
}

describe('Notifier', () => {
  it('pings the next human by name with their seat link', async () => {
    const { game, sent, notifier, start, afterRed } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe(HOOK)
    expect(sent[0]!.content).toContain('**Sam**')
    expect(sent[0]!.content).toContain(seatLink('https://arcs.test', game.gameId, game.seats[1]!.seatToken))
  })

  it('falls back to the faction when no name is set and says nothing without a webhook', async () => {
    const a = await setup()
    // yellow is named; ping for blue would say "blue" — simulate by asking for red's turn instead.
    await a.notifier.onSettled({ gameId: a.game.gameId, before: a.afterRed, after: a.start })
    expect(a.sent[0]!.content).toContain('**red**')
    const b = await setup(undefined)
    await b.notifier.onSettled({ gameId: b.game.gameId, before: b.start, after: b.afterRed })
    expect(b.sent).toHaveLength(0)
  })

  it('sends at most one ping per window and records the journal length', async () => {
    const { store, game, sent, notifier, start, afterRed, tick } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: start })
    expect(sent).toHaveLength(1)
    expect(store.meta(game.gameId)?.lastNotifiedLength).toBe(1)
    tick(60_001)
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: start })
    expect(sent).toHaveLength(2)
  })

  it('does not re-ping the same journal position after a restart', async () => {
    const { store, game, sent, notifier, start, afterRed, tick } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    tick(120_000)
    // resumeAll reports before: null for the same position — nothing new happened.
    await notifier.onSettled({ gameId: game.gameId, before: null, after: afterRed })
    expect(sent).toHaveLength(1)
    expect(store.meta(game.gameId)?.lastNotifiedLength).toBe(1)
  })

  it('announces a chapter change and game over regardless of the window', async () => {
    const { game, sent, notifier, start, afterRed } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    const nextChapter: RuleResult = { ...afterRed, state: { ...afterRed.state, chapter: afterRed.state.chapter + 1 } }
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: nextChapter })
    expect(sent).toHaveLength(2)
    expect(sent[1]!.content).toMatch(/Chapter 2/)
    const over: RuleResult = {
      state: { ...nextChapter.state, isOver: true, winners: ['yellow'] },
      continue: { kind: 'gameOver', winners: ['yellow'], reason: 'test' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: nextChapter, after: over })
    expect(sent).toHaveLength(3)
    expect(sent[2]!.content).toContain('Sam')
    expect(sent[2]!.content).toMatch(/wins/i)
  })

  it('swallows a failing webhook', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, { webhookUrl: HOOK })
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      post: async () => {
        throw new Error('boom')
      },
    })
    await expect(
      notifier.onSettled({ gameId: game.gameId, before: startGame(THREE_PLAYER), after: replayGame(THREE_PLAYER, [RED_FIRST_LEAD]) }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node/test/notify.test.ts 2>&1 | tail -5
```
Expected: FAIL, cannot find `../src/notify.js`.

- [ ] **Step 3: Implement**

`packages/server-node/src/notify.ts`:
```ts
/**
 * Discord turn pings. Best effort: a failed POST is logged and forgotten.
 *
 * Fires from the gate's `onSettled`, i.e. once the bots have finished after a human action, so a
 * ping always names a human who can actually act. Rate-limited per game to one message per window
 * except for chapter changes and game over, which always go out.
 */
import type { RuleResult } from '@arcs/engine'

import { askedOf } from './gate.js'
import type { Settled } from './gate.js'
import type { SqliteStore } from './sqlite-store.js'

export type Poster = (url: string, content: string) => Promise<void>

export interface NotifierOptions {
  readonly publicOrigin: string
  readonly post?: Poster
  readonly now?: () => number
  readonly windowMs?: number
}

export function seatLink(origin: string, gameId: string, seatToken?: string): string {
  const seat = seatToken === undefined ? '' : `/s/${encodeURIComponent(seatToken)}`
  return `${origin.replace(/\/+$/, '')}/#/g/${encodeURIComponent(gameId)}${seat}`
}

export async function postToDiscord(url: string, content: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`discord webhook -> ${res.status}`)
}

export class Notifier {
  private readonly post: Poster
  private readonly now: () => number
  private readonly windowMs: number

  constructor(
    private readonly store: SqliteStore,
    opts: NotifierOptions,
  ) {
    this.post = opts.post ?? postToDiscord
    this.now = opts.now ?? Date.now
    this.windowMs = opts.windowMs ?? 60_000
    this.origin = opts.publicOrigin
  }

  private readonly origin: string

  async onSettled({ gameId, before, after }: Settled): Promise<void> {
    const meta = this.store.meta(gameId)
    if (meta === undefined || meta.webhookUrl === undefined) return
    const length = after.state.journal.length
    if (length <= meta.lastNotifiedLength) return

    const seats = this.store.seats(gameId)
    const nameOf = (faction: string): string => seats.find((s) => s.faction === faction)?.name ?? faction
    const lines: string[] = []

    if (after.state.isOver) {
      const winners = after.state.winners.map(nameOf).join(' and ')
      lines.push(`Game over in Arcs — **${winners}** wins! ${seatLink(this.origin, gameId)}`)
    } else {
      if (before !== null && after.state.chapter !== before.state.chapter) {
        lines.push(`Chapter ${before.state.chapter} is over in Arcs. Chapter ${after.state.chapter} begins.`)
      }
      const asked = askedOf(after)
      const seat = asked === undefined ? undefined : seats.find((s) => s.faction === asked)
      const changed = before === null ? false : askedOf(before) !== asked || before.state.journal.length !== length
      const inWindow = this.now() - meta.lastNotifiedAt < this.windowMs
      if (seat !== undefined && !seat.isBot && changed && (!inWindow || lines.length > 0)) {
        lines.push(
          `**${nameOf(seat.faction)}**, it's your turn in Arcs (chapter ${after.state.chapter}) — ${seatLink(this.origin, gameId, seat.seatToken)}`,
        )
      }
    }

    if (lines.length === 0) return
    try {
      await this.post(meta.webhookUrl, lines.join('\n'))
      this.store.markNotified(gameId, length, this.now())
    } catch (e) {
      console.warn(`[notify] webhook failed for ${gameId}:`, (e as Error).message)
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node 2>&1 | tail -8 && npm run typecheck:node
```
Expected: all notify tests pass. If the "same journal position after a restart" test sends a second ping, `length <= meta.lastNotifiedLength` is not being checked first.

- [ ] **Step 5: Commit**

```bash
git add packages/server-node && git commit -m "server-node: Discord turn notifications

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Web-standard API router

**Model:** sonnet

**Files:**
- Create: `packages/server-node/src/api.ts`, `packages/server-node/test/api.test.ts`

**Interfaces:**
- Consumes: `SqliteStore`, `EngineGate`.
- Produces:
```ts
export interface Api { store: SqliteStore; gate: EngineGate }
export function route(request: Request, api: Api): Promise<Response | undefined>  // undefined = not an API path (serve static)
export interface PublicSeat { faction: string; name?: string; isBot: boolean }
export function publicSeats(store: SqliteStore, gameId: string): PublicSeat[]
```
Routes: `OPTIONS *` (CORS preflight, as upstream), `POST /games`, `GET /games/:id?since=N`, `POST /games/:id/actions`, `POST /games/:id/seat`, `GET /healthz`. `GET /games/:id/live` is handled by the upgrade path in Task 6 and returns `426` here.

- [ ] **Step 1: Write the failing tests**

`packages/server-node/test/api.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node/test/api.test.ts 2>&1 | tail -5
```
Expected: FAIL, cannot find `../src/api.js`.

- [ ] **Step 3: Implement**

`packages/server-node/src/api.ts`:
```ts
/**
 * The HTTP API, written against web-standard Request/Response like upstream's `handle` so it is
 * testable with `new Request(...)` and independent of node:http. Upstream's three endpoints keep
 * their wire shapes (docs/17 section 4b); this adds bots on create, `seats` on read, a name claim,
 * `403 wrong-turn`, and `/healthz`.
 */
import type { NewGameOptions } from '@arcs/engine'

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
    const webhookUrl =
      typeof b.webhookUrl === 'string' && /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(b.webhookUrl.trim())
        ? b.webhookUrl.trim()
        : undefined
    // Bots travel in options so every client's replay knows which seats are bots.
    const options: NewGameOptions = {
      ...(b.options as NewGameOptions),
      ...(bots.length > 0 ? { bots } : {}),
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
```

- [ ] **Step 4: Run tests**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node 2>&1 | tail -8 && npm run typecheck:node
```
Expected: all api tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server-node && git commit -m "server-node: HTTP API router with bots, seats, names, turn refusal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: node:http host, live WebSocket, static files, main

**Model:** sonnet

**Files:**
- Create: `packages/server-node/src/server.ts`, `packages/server-node/src/main.ts` (replace stub), `packages/server-node/test/server.test.ts`

**Interfaces:**
- Consumes: `route`, `Api`, `EngineGate.subscribe`, `publicSeats`.
- Produces:
```ts
export interface ServerOptions { api: Api; staticDir?: string }
export function createArcsServer(opts: ServerOptions): http.Server   // not yet listening
```
Env for `main.ts`: `PORT` (3070), `DATABASE_PATH` (`./data/arcs.db`), `STATIC_DIR` (`<repo>/apps/web/dist`), `PUBLIC_ORIGIN` (`http://localhost:${PORT}`), `BOT_PACE_MS` (1000).

- [ ] **Step 1: Write the failing tests**

`packages/server-node/test/server.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { EngineGate } from '../src/gate.js'
import { createArcsServer } from '../src/server.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { ONE_HUMAN, RED_FIRST_LEAD } from './fixtures.js'

const closers: (() => void)[] = []
afterEach(() => {
  for (const c of closers.splice(0)) c()
})

async function listen() {
  const staticDir = mkdtempSync(join(tmpdir(), 'arcs-static-'))
  writeFileSync(join(staticDir, 'index.html'), '<html>arcs</html>')
  writeFileSync(join(staticDir, 'app.js'), 'console.log(1)')
  const store = new SqliteStore(':memory:')
  const gate = new EngineGate(store, { pace: 0 })
  const server = createArcsServer({ api: { store, gate }, staticDir })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  closers.push(() => server.close())
  return { base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}`, store }
}

describe('createArcsServer', () => {
  it('serves the API, static files and the SPA fallback', async () => {
    const { base } = await listen()
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
    expect(await (await fetch(`${base}/app.js`)).text()).toBe('console.log(1)')
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toContain('javascript')
    expect(await (await fetch(`${base}/anything/else`)).text()).toBe('<html>arcs</html>')
    expect((await fetch(`${base}/games/nope`)).status).toBe(404)
    expect((await fetch(`${base}/../etc/passwd`)).status).not.toBe(500)
  })

  it('pushes every append, including bot moves, over the live socket', async () => {
    const { base, ws } = await listen()
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string; seats: { seatToken: string }[] }

    const sock = new WebSocket(`${ws}/games/${created.gameId}/live`)
    await new Promise<void>((r, j) => {
      sock.once('open', r)
      sock.once('error', j)
    })
    closers.push(() => sock.close())
    const pushes: { from: number; entries: string[] }[] = []
    sock.on('message', (data) => pushes.push(JSON.parse(String(data))))

    const res = await fetch(`${base}/games/${created.gameId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken: created.seats[0]!.seatToken, expectedLength: 0, action: RED_FIRST_LEAD }),
    })
    expect(res.status).toBe(200)
    // Bots run after the response; wait for the journal to settle.
    const deadline = Date.now() + 5000
    for (;;) {
      const tail = (await (await fetch(`${base}/games/${created.gameId}`)).json()) as { length: number }
      if (tail.length > 1 && pushes.length >= tail.length) break
      if (Date.now() > deadline) throw new Error('bots never pushed')
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(pushes[0]).toEqual({ from: 0, entries: [RED_FIRST_LEAD] })
    expect(pushes.map((p) => p.from)).toEqual(pushes.map((_, i) => i))
  })

  it('refuses a socket for an unknown game', async () => {
    const { ws } = await listen()
    const sock = new WebSocket(`${ws}/games/nope/live`)
    const outcome = await new Promise<string>((r) => {
      sock.once('open', () => r('open'))
      sock.once('error', () => r('error'))
      sock.once('unexpected-response', () => r('error'))
    })
    expect(outcome).toBe('error')
  })

  it('broadcasts seats when a name is claimed', async () => {
    const { base, ws } = await listen()
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string; seats: { seatToken: string }[] }
    const sock = new WebSocket(`${ws}/games/${created.gameId}/live`)
    await new Promise<void>((r) => sock.once('open', r))
    closers.push(() => sock.close())
    const got = new Promise<unknown>((r) => sock.once('message', (d) => r(JSON.parse(String(d)))))
    await fetch(`${base}/games/${created.gameId}/seat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken: created.seats[0]!.seatToken, name: 'Brian' }),
    })
    expect(await got).toEqual({ from: 0, entries: [], seats: [
      { faction: 'red', name: 'Brian', isBot: false },
      { faction: 'yellow', isBot: true },
      { faction: 'blue', isBot: true },
    ] })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node/test/server.test.ts 2>&1 | tail -5
```
Expected: FAIL, cannot find `../src/server.js`.

- [ ] **Step 3: Implement the host**

`packages/server-node/src/server.ts`:
```ts
/**
 * node:http host. Converts each IncomingMessage to a web-standard Request for `route`, writes the
 * Response back, serves `apps/web/dist` for everything else, and upgrades `/games/:id/live` to a
 * WebSocket fed by the gate's pushes. The push shape matches upstream's Durable Object exactly
 * (`{from, entries}`) so the client's `session.ts` is untouched; a name claim adds `seats`.
 */
import { createReadStream, statSync } from 'node:fs'
import http from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { Readable } from 'node:stream'

import { WebSocketServer } from 'ws'

import { publicSeats, route } from './api.js'
import type { Api } from './api.js'

export interface ServerOptions {
  readonly api: Api
  readonly staticDir?: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

function toRequest(req: http.IncomingMessage): Request {
  const host = req.headers.host ?? 'localhost'
  const url = `http://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v)
    else if (Array.isArray(v)) headers.set(k, v.join(', '))
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as unknown as BodyInit, duplex: 'half' } : {}),
  } as RequestInit)
}

async function send(res: http.ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((v, k) => res.setHeader(k, v))
  const text = await response.text()
  res.end(text)
}

function serveStatic(staticDir: string, urlPath: string, res: http.ServerResponse): void {
  const root = resolve(staticDir)
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const wanted = normalize(join(root, decoded))
  const safe = wanted.startsWith(root) ? wanted : root
  let file = safe
  try {
    if (!statSync(file).isFile()) throw new Error('dir')
  } catch {
    file = join(root, 'index.html')
  }
  let size: number
  try {
    size = statSync(file).size
  } catch {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const ext = extname(file)
  res.statusCode = 200
  res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('content-length', size)
  // Hashed Vite assets are immutable; index.html must not be cached so deploys take effect.
  res.setHeader('cache-control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable')
  createReadStream(file).pipe(res)
}

export function createArcsServer({ api, staticDir }: ServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const response = await route(toRequest(req), api)
        if (response !== undefined) return await send(res, response)
        if (staticDir === undefined) {
          res.statusCode = 404
          return res.end('not found')
        }
        serveStatic(staticDir, req.url ?? '/', res)
      } catch (e) {
        console.error('[http]', (e as Error).stack ?? e)
        if (!res.headersSent) res.statusCode = 500
        res.end('internal error')
      }
    })()
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/games\/([^/?]+)\/live\/?(\?.*)?$/.exec(req.url ?? '')
    const gameId = m === null ? undefined : decodeURIComponent(m[1]!)
    if (gameId === undefined || api.store.options(gameId) === undefined) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const unsubscribe = api.gate.subscribe(gameId, (push) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(push))
      })
      ws.on('close', unsubscribe)
      ws.on('error', unsubscribe)
    })
  })

  return server
}

/** Tell every socket on a game that its seats changed (name claim). Zero entries: a no-op for the journal. */
export function broadcastSeats(api: Api, gameId: string): void {
  const length = api.gate.resultOf(gameId)?.state.journal.length ?? 0
  api.gate.broadcast(gameId, { from: length, entries: [], seats: publicSeats(api.store, gameId) })
}
```

Then two small additions:

In `gate.ts`, widen `Push` and expose `emit` publicly as `broadcast`:
```ts
export interface Push {
  readonly from: number
  readonly entries: readonly string[]
  readonly seats?: readonly { faction: string; name?: string; isBot: boolean }[]
}
// rename the private `emit` to public `broadcast(gameId, push)` and update its two call sites.
```

In `api.ts`, after a successful name claim, call the broadcast. `route` must not import `server.ts` (circular), so add an optional hook to `Api`:
```ts
export interface Api {
  readonly store: SqliteStore
  readonly gate: EngineGate
  readonly onSeatsChanged?: (gameId: string) => void
}
// ...in the /seat handler, before returning:
api.onSeatsChanged?.(gameId)
```
and in `server.ts` `createArcsServer`, wrap: `const api: Api = { ...opts.api, onSeatsChanged: (id) => broadcastSeats(opts.api, id) }` and use that `api` for both `route` and the upgrade handler.

`packages/server-node/src/main.ts`:
```ts
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EngineGate } from './gate.js'
import { Notifier } from './notify.js'
import { createArcsServer } from './server.js'
import { SqliteStore } from './sqlite-store.js'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env['PORT'] ?? 3070)
const DATABASE_PATH = process.env['DATABASE_PATH'] ?? resolve(here, '../data/arcs.db')
const STATIC_DIR = process.env['STATIC_DIR'] ?? resolve(here, '../../../apps/web/dist')
const PUBLIC_ORIGIN = process.env['PUBLIC_ORIGIN'] ?? `http://localhost:${PORT}`
const BOT_PACE_MS = Number(process.env['BOT_PACE_MS'] ?? 1000)

mkdirSync(dirname(DATABASE_PATH), { recursive: true })
const store = new SqliteStore(DATABASE_PATH)
const notifier = new Notifier(store, { publicOrigin: PUBLIC_ORIGIN })
const gate = new EngineGate(store, { pace: BOT_PACE_MS, onSettled: (s) => void notifier.onSettled(s) })
const server = createArcsServer({ api: { store, gate }, staticDir: STATIC_DIR })

server.listen(PORT, '0.0.0.0', () => {
  console.log(`arcs server on :${PORT}  db=${DATABASE_PATH}  static=${STATIC_DIR}  origin=${PUBLIC_ORIGIN}`)
  void gate.resumeAll()
})

const stop = (): void => {
  server.close(() => {
    store.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
```
Note: with esbuild's bundle at `packages/server-node/dist/main.js`, `here` is `dist/`, so the defaults resolve to `packages/server-node/data/arcs.db` and `apps/web/dist`. With `tsx src/main.ts`, `here` is `src/`, and the same relative defaults hold. The Docker image sets both env vars explicitly.

- [ ] **Step 4: Run tests and the whole suite**

```bash
cd ~/Projects/arcs && npx vitest run packages/server-node 2>&1 | tail -8 && npm run typecheck && npm test 2>&1 | tail -4
```
Expected: server tests pass; typecheck clean; full suite green (1029 upstream + new).

- [ ] **Step 5: Smoke the dev loop by hand**

```bash
cd ~/Projects/arcs && npm run build:site 2>&1 | tail -2 && (PORT=3070 npx tsx --no-warnings=ExperimentalWarning packages/server-node/src/main.ts & echo $! > /tmp/arcs.pid; sleep 2; curl -s localhost:3070/healthz; echo; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:3070/; kill $(cat /tmp/arcs.pid))
```
Expected: `ok`, then `200 text/html; charset=utf-8`.

- [ ] **Step 6: Commit**

```bash
git add packages/server-node && git commit -m "server-node: node:http host, live WebSocket, static site, entrypoint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Client — bots and webhook on create, bot rows hidden, publish errors resync

**Model:** sonnet

**Files:**
- Modify: `apps/web/src/multiplayer/client.ts`, `apps/web/src/multiplayer/session.ts:276-286`, `apps/web/src/components/NewGame.tsx:131-150,183-215`, `apps/web/src/components/ShareGame.tsx`
- Test: `apps/web/test/client-extra.test.ts`

**Interfaces:**
- Consumes: server contract from Task 5.
- Produces (in `client.ts`):
```ts
export interface PublicSeat { readonly faction: string; readonly name?: string; readonly isBot: boolean }
export interface GameTail { ...; readonly seats?: readonly PublicSeat[] }
export interface CreateExtra { readonly bots?: readonly string[]; readonly webhookUrl?: string }
create(options, factions, extra?: CreateExtra): Promise<CreatedGame>
claimName(gameId, seatToken, name): Promise<readonly PublicSeat[]>
```

- [ ] **Step 1: Write the failing test**

`apps/web/test/client-extra.test.ts` (check how existing tests in `apps/web/test` stub `fetch`; if none do, this pattern is self-contained):
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MultiplayerClient } from '../src/multiplayer/client.js'

const calls: { url: string; init?: RequestInit }[] = []
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
})

describe('MultiplayerClient extras', () => {
  it('sends bots and webhookUrl on create', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return reply({ gameId: 'g', seats: [] }, 201)
    })
    const c = new MultiplayerClient('')
    await c.create({ board: 'b' }, ['red', 'blue'], { bots: ['blue'], webhookUrl: 'https://discord.com/api/webhooks/1/x' })
    expect(calls[0]!.url).toBe('/games')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      options: { board: 'b' },
      factions: ['red', 'blue'],
      bots: ['blue'],
      webhookUrl: 'https://discord.com/api/webhooks/1/x',
    })
  })

  it('claims a name and returns the seats', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return reply({ seats: [{ faction: 'red', name: 'Brian', isBot: false }] })
    })
    const c = new MultiplayerClient('')
    const seats = await c.claimName('g', 'tok', 'Brian')
    expect(calls[0]!.url).toBe('/games/g/seat')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ seatToken: 'tok', name: 'Brian' })
    expect(seats[0]!.name).toBe('Brian')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/Projects/arcs && npx vitest run apps/web/test/client-extra.test.ts 2>&1 | tail -5
```
Expected: FAIL (`claimName` is not a function / body lacks `bots`).

- [ ] **Step 3: Extend the client**

In `apps/web/src/multiplayer/client.ts`:
```ts
export interface PublicSeat {
  readonly faction: string
  readonly name?: string
  readonly isBot: boolean
}

export interface GameTail {
  readonly options: unknown
  readonly entries: readonly string[]
  readonly length: number
  readonly yourFaction?: string
  /** Present on the self-hosted server; absent on upstream's Worker. */
  readonly seats?: readonly PublicSeat[]
}

export interface CreateExtra {
  readonly bots?: readonly string[]
  readonly webhookUrl?: string
}
```
Replace `create`:
```ts
  async create(options: unknown, factions: readonly string[], extra: CreateExtra = {}): Promise<CreatedGame> {
    return this.json<CreatedGame>('/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        options,
        factions,
        ...(extra.bots !== undefined && extra.bots.length > 0 ? { bots: extra.bots } : {}),
        ...(extra.webhookUrl !== undefined && extra.webhookUrl !== '' ? { webhookUrl: extra.webhookUrl } : {}),
      }),
    })
  }
```
Add after `read`:
```ts
  async claimName(gameId: string, seatToken: string, name: string): Promise<readonly PublicSeat[]> {
    const body = await this.json<{ seats: readonly PublicSeat[] }>(`/games/${encodeURIComponent(gameId)}/seat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken, name }),
    })
    return body.seats
  }
```

- [ ] **Step 4: Make publish resync on any refusal**

In `apps/web/src/multiplayer/session.ts` `publish` (around line 276), wrap the append so a `403 wrong-turn` (or any `ApiError`) replays the authoritative journal instead of surfacing as an unhandled rejection:
```ts
  async publish(action: Action, expectedLength: number): Promise<void> {
    if (this.link.seatToken === undefined) return
    try {
      const outcome = await this.client.append(
        this.link.gameId,
        this.link.seatToken,
        expectedLength,
        encodeAction(action),
      )
      if (!outcome.ok) await this.resync()
    } catch (e) {
      // A refusal (wrong turn, wrong faction, bad seat) means the optimistic local state is wrong;
      // the server's journal is the truth, so replay it. Network errors: the next poll retries.
      if (e instanceof ApiError) await this.resync()
    }
  }
```

- [ ] **Step 5: Send bots and a webhook from NewGame**

In `apps/web/src/components/NewGame.tsx`:
- Add state next to `bots`: `const [webhookUrl, setWebhookUrl] = useState('')`.
- Replace `createShared` (delete the "Bot seats are deliberately not sent" comment; the server now plays them):
```ts
  /** Create the game on the server and show its links. Bot seats are played by the server. */
  async function createShared(): Promise<void> {
    const options = chosenOptions()
    if (options === null || MULTIPLAYER_URL === null) return
    setCreating(true)
    setCreateError(null)
    try {
      const client = new MultiplayerClient(MULTIPLAYER_URL)
      setCreated(
        await client.create(options, options.factions, {
          ...(options.bots === undefined ? {} : { bots: options.bots }),
          ...(webhookUrl.trim() === '' ? {} : { webhookUrl: webhookUrl.trim() }),
        }),
      )
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }
```
- In the JSX, directly above the button that calls `createShared` (search `onClick={() => void createShared()}`), add a field. Reuse the existing `ng-field` / `ng-label` classes:
```tsx
          <div className="ng-field">
            <span className="ng-label">Discord turn pings (optional)</span>
            <input
              className="mp-link"
              placeholder="https://discord.com/api/webhooks/…"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
```
- Remove the now-unused `_dropped` destructure if it remains anywhere.

- [ ] **Step 6: Hide bot rows in ShareGame**

`game.seats` from the server already excludes bots (Task 5), so `ShareGame` needs only its "Take X and start" button to remain valid: `game.seats[0]` is the first human. Add a guard so an all-bot game (which the UI does not allow, but the type does) cannot crash:
```tsx
        {game.seats.length > 0 ? (
          <button className="primary ng-start mp-enter" onClick={() => onEnter(game.seats[0]!.seatToken)}>
            Take {game.seats[0]!.faction} and start
          </button>
        ) : null}
```

- [ ] **Step 7: Run tests and typecheck**

```bash
cd ~/Projects/arcs && npx vitest run apps/web 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3
```
Expected: web tests pass including the new one; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web && git commit -m "web: send bot seats and a Discord webhook when creating a shared game

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Client — name prompt and names on badges

**Model:** sonnet

**Files:**
- Modify: `apps/web/src/multiplayer/session.ts` (SessionHost + resync/poll/applyPush), `apps/web/src/store.ts` (seats, mySeatName, claimName), `apps/web/src/components/SeatBadge.tsx`, `apps/web/src/App.tsx:110-145`, `apps/web/src/styles.css` (append)
- Create: `apps/web/src/components/NamePrompt.tsx`
- Test: `apps/web/test/session-seats.test.ts`

**Interfaces:**
- `SessionHost` gains `seats(seats: readonly PublicSeat[]): void`.
- `Session` gains `claimName(name): Promise<void>`.
- `GameStore` (web store class) gains `seats: readonly PublicSeat[]`, `seatName(faction): string | undefined`, `mySeatName(): string | undefined | null` (`null` = not a seat), `claimName(name): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/session-seats.test.ts` — look at how `apps/web/test` already tests `Session` (grep `new Session(`) and copy its host stub; the assertions to add:
```ts
import { describe, expect, it, vi } from 'vitest'

import { Session } from '../src/multiplayer/session.js'
import type { PublicSeat } from '../src/multiplayer/client.js'

describe('Session seats', () => {
  it('hands seats to the host on resync and on a seats push', async () => {
    const seen: (readonly PublicSeat[])[] = []
    const tail = {
      options: { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 7 },
      entries: [],
      length: 0,
      yourFaction: 'red',
      seats: [{ faction: 'red', isBot: false }, { faction: 'yellow', name: 'Sam', isBot: false }, { faction: 'blue', isBot: true }],
    }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(tail), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('WebSocket', undefined)
    const session = new Session('', { gameId: 'g', seatToken: 't' }, {
      current: () => null,
      adopt: () => {},
      applyRemote: () => {},
      seats: (s) => seen.push(s),
    })
    await session.resync()
    expect(seen[0]).toEqual(tail.seats)
    // A seats-only push (name claim) updates without touching the journal.
    ;(session as unknown as { applyPush: (raw: string) => void }).applyPush(
      JSON.stringify({ from: 0, entries: [], seats: [{ faction: 'red', name: 'Brian', isBot: false }] }),
    )
    expect(seen[1]).toEqual([{ faction: 'red', name: 'Brian', isBot: false }])
    session.leave()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd ~/Projects/arcs && npx vitest run apps/web/test/session-seats.test.ts 2>&1 | tail -5
```
Expected: FAIL (`seats` not called / type error on host).

- [ ] **Step 3: Session changes**

In `apps/web/src/multiplayer/session.ts`:
- Import `PublicSeat` type from `./client.js`.
- `SessionHost` adds `seats(seats: readonly PublicSeat[]): void`.
- In `resync()`, after `this.host.adopt(...)`: `this.host.seats(tail.seats ?? [])`.
- In `poll()`, after the `for (const entry of tail.entries)` loop: `if (tail.seats !== undefined) this.host.seats(tail.seats)`.
- In `applyPush`, right after the `if (typeof from !== 'number' || !Array.isArray(entries)) return` line:
```ts
    const seats = (push as { seats?: unknown }).seats
    if (Array.isArray(seats)) this.host.seats(seats as PublicSeat[])
```
- Add a method:
```ts
  async claimName(name: string): Promise<void> {
    if (this.link.seatToken === undefined) return
    this.host.seats(await this.client.claimName(this.link.gameId, this.link.seatToken, name))
  }
```

- [ ] **Step 4: Store changes**

In `apps/web/src/store.ts`:
- Import `PublicSeat` type from `./multiplayer/client.js`.
- Add a field near `session`: `seats: readonly PublicSeat[] = []`.
- In `joinSession`, add to the host object: `seats: (seats) => { this.seats = seats; this.emit() },` and in `leaveSession` reset `this.seats = []`.
- Add methods:
```ts
  seatName(faction: string): string | undefined {
    return this.seats.find((s) => s.faction === faction)?.name
  }

  /** `null` when this client holds no seat (hotseat or spectator); otherwise the name or undefined. */
  mySeatName(): string | undefined | null {
    const view = this.seatView()
    if (view.kind !== 'seat') return null
    return this.seatName(view.faction)
  }

  async claimName(name: string): Promise<void> {
    await this.session?.claimName(name)
  }
```
(`emit()` is the store's existing notify-subscribers method; confirm its name with `grep -n "private emit\|emit()" apps/web/src/store.ts`.)

- [ ] **Step 5: NamePrompt component**

`apps/web/src/components/NamePrompt.tsx`:
```tsx
import { useState } from 'react'

interface Props {
  faction: string
  onSubmit: (name: string) => Promise<void>
}

/** Asked once, the first time a seat link is opened with no name on the server. */
export function NamePrompt({ faction, onSubmit }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 24

  async function submit(): Promise<void> {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="name-backdrop" role="dialog" aria-modal="true" aria-labelledby="name-title">
      <form
        className="name-card"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 id="name-title">You are {faction}</h2>
        <p>What should the table call you?</p>
        <input
          autoFocus
          maxLength={24}
          value={name}
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
        />
        {error === null ? null : <p className="name-error">{error}</p>}
        <button className="primary" type="submit" disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Sit down'}
        </button>
      </form>
    </div>
  )
}
```
Append to `apps/web/src/styles.css`:
```css
/* --- name prompt (joined games) ------------------------------------------ */
.name-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
}
.name-card {
  display: grid;
  gap: 12px;
  min-width: 280px;
  padding: 20px 24px;
  border-radius: 10px;
  background: var(--panel, #1e1e24);
  color: inherit;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.name-card h2 {
  margin: 0;
  font-size: 1.1rem;
}
.name-card p {
  margin: 0;
  opacity: 0.8;
}
.name-card input {
  font: inherit;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.3);
  color: inherit;
}
.name-error {
  color: #e0604e;
}
```
(Check `styles.css` for the panel background variable actually used, e.g. `grep -n "^  --" apps/web/src/styles.css | head`, and use it instead of `--panel` if it is named differently.)

- [ ] **Step 6: Mount it and show names**

In `apps/web/src/App.tsx`, near the `seatView` line (about line 110):
```tsx
  const myName = store.mySeatName()
  const needsName = seatView.kind === 'seat' && myName === undefined
```
Then inside the returned `<div className="app">`, as its first child (before `<header>`):
```tsx
      {needsName ? (
        <NamePrompt faction={seatView.faction} onSubmit={(name) => store.claimName(name)} />
      ) : null}
```
Import: `import { NamePrompt } from './components/NamePrompt.js'`.

In the turn badge, show the name when known:
```tsx
            <span className="turn-badge-who" style={{ color: colorOf(current) }}>
              {store.seatName(current) ?? current}
            </span>
```
Change `SeatBadge` to accept names. In `SeatBadge.tsx` add to `Props`: `nameOf?: (faction: FactionId) => string | undefined`, then:
- spectator wait text: `{nameOf?.(current) ?? current} to play`
- seat who: `{nameOf?.(seat) ?? seat}` inside the `.seat-who` span (keep the faction colour)
- waiting text: `waiting for {nameOf?.(current) ?? current}`
and in `App.tsx`: `<SeatBadge view={seatView} current={current} nameOf={(f) => store.seatName(f)} />`.

- [ ] **Step 7: Run tests and typecheck**

```bash
cd ~/Projects/arcs && npx vitest run apps/web 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3
```
Expected: pass, clean. If an existing test constructs a `SessionHost` literal, add a no-op `seats: () => {}` to it (that is the one acceptable edit to an upstream test: a required-field addition).

- [ ] **Step 8: Try it in a browser**

```bash
cd ~/Projects/arcs && npm run build:site 2>&1 | tail -1 && (PORT=3070 npx tsx --no-warnings=ExperimentalWarning packages/server-node/src/main.ts > /tmp/arcs-server.log 2>&1 & echo $! > /tmp/arcs.pid; sleep 2; cat /tmp/arcs-server.log)
```
Open `http://localhost:3070`, New game → 3 players, mark yellow and blue as bots, "Share", "Take red and start". Expected: name prompt appears; after entering a name the badge shows it; play red's lead; the bots' moves arrive within a few seconds. Then `kill $(cat /tmp/arcs.pid)`.

- [ ] **Step 9: Commit**

```bash
git add apps/web && git commit -m "web: name prompt on first seat open, names on turn and seat badges

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docker image, compose file, GitHub Actions

**Model:** sonnet

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `.github/workflows/deploy.yml`
- Modify: `README.md` (short "Self-hosting" section, 10 lines)

- [ ] **Step 1: Dockerfile**

```dockerfile
# Multi-stage: build the site and bundle the server, then ship only the runtime pieces.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/server-node/package.json packages/server-node/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
# build:site sets VITE_MULTIPLAYER_URL to "" = same origin (apps/web/src/multiplayer/config.ts).
RUN npm run build:site && npm run build --workspace @arcs/server-node

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3070 \
    DATABASE_PATH=/data/arcs.db \
    STATIC_DIR=/app/web
COPY --from=build /app/packages/server-node/dist/main.js ./server/main.js
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/apps/web/dist ./web
RUN mkdir -p /data && echo '{"type":"module"}' > /app/server/package.json
VOLUME ["/data"]
EXPOSE 3070
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3070/healthz || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "server/main.js"]
```

`.dockerignore`:
```
node_modules
**/node_modules
**/dist
.git
docs
saves
scripts
*.md
!README.md
```

- [ ] **Step 2: Compose file for Tower**

`docker-compose.prod.yml`:
```yaml
# Unraid deployment - pulls the pre-built image from GHCR (built by
# .github/workflows/deploy.yml on a version tag). golfbet's host-wide
# Watchtower (--label-enable) redeploys it when a new image lands.
services:
  app:
    image: ghcr.io/basmith7/arcs:latest
    container_name: arcs
    ports:
      - "3070:3070"
    environment:
      PUBLIC_ORIGIN: "https://arcs.basmith.net"
      BOT_PACE_MS: "1000"
    volumes:
      - /mnt/cache/appdata/arcs:/data
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
```

- [ ] **Step 3: Workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Build and publish arcs image

# Build only on a version tag (git tag v0.1.0 && git push --tags) or by hand.
# Watchtower on Tower polls ghcr.io and redeploys once the image lands.
on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:latest
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
```
Check whether upstream already has a `.github/workflows/` directory (GitHub Pages deploy). If it does, leave those files alone; ours is additive. If a Pages workflow triggers on push to `main`, disable it in our fork by adding `if: github.repository == 'willhaywood/open-arcs'` to its job — we do not want Pages builds.

- [ ] **Step 4: Build and run the image locally**

```bash
cd ~/Projects/arcs && docker build -t arcs:local . 2>&1 | tail -3 && docker run -d --rm --name arcs-local -p 3079:3070 -e PUBLIC_ORIGIN=http://localhost:3079 arcs:local && sleep 3 && curl -s localhost:3079/healthz && echo && curl -s -o /dev/null -w '%{http_code}\n' localhost:3079/ && docker logs arcs-local | tail -3 && docker stop arcs-local
```
Expected: `ok`, `200`, log line `arcs server on :3070 ...`. If `npm ci` fails on the lockfile, run `npm install` locally, commit `package-lock.json`, retry.

- [ ] **Step 5: README section**

Append to `README.md`:
```markdown
## Self-hosting (this fork)

`packages/server-node` is a Node 22 server that stores games in SQLite, runs the engine to refuse
out-of-turn actions and play bot seats, and posts Discord turn pings. Dev: `npm run build:site && npm run dev:server`
(port 3070). Production: `docker-compose.prod.yml`, image `ghcr.io/basmith7/arcs`, built on `v*` tags.
Design: `docs/superpowers/specs/2026-09-09-arcs-online-design.md`.
```

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.prod.yml .github README.md package-lock.json && git commit -m "deploy: Docker image, Tower compose file, GHCR workflow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end check with two browsers and a bot

**Model:** run inline (main session), uses the browser preview tools

- [ ] **Step 1: Start the server from the built site**

```bash
cd ~/Projects/arcs && npm run build:site 2>&1 | tail -1 && (PORT=3070 npx tsx --no-warnings=ExperimentalWarning packages/server-node/src/main.ts > /tmp/arcs-server.log 2>&1 & echo $! > /tmp/arcs.pid; sleep 2; tail -2 /tmp/arcs-server.log)
```

- [ ] **Step 2: Create a 3-player game (yellow bot) via the UI or curl and open red's and blue's links in two browser contexts**

```bash
curl -s localhost:3070/games -H 'content-type: application/json' -d '{"options":{"board":"Board3MixUp","factions":["red","yellow","blue"],"seed":11},"factions":["red","yellow","blue"],"bots":["yellow"]}'
```
Open `http://localhost:3070/#/g/<gameId>/s/<redToken>` and `.../s/<blueToken>`. Checklist:
- [ ] Both prompt for a name; names show on each other's turn badge after entry.
- [ ] Red plays a lead; blue's screen updates without reload (socket, not poll: devtools Network → WS shows frames).
- [ ] When yellow's turn comes the bot plays within ~1 s per action and both screens follow.
- [ ] Blue trying to act on red's turn is inert in the UI; a forged POST returns `403 {"error":"wrong-turn"}`.
- [ ] Reload red's tab: state restored, name still known, no second prompt.

- [ ] **Step 3: Stop the server; fix anything found (as extra commits), then continue**

```bash
kill $(cat /tmp/arcs.pid)
```

---

### Task 11: Release and deploy to Tower

**Model:** run inline (main session). Touches shared infrastructure; follow `~/Documents/Vault 13/Infrastructure.md` rules.

- [ ] **Step 1: Push and tag**

```bash
cd ~/Projects/arcs && git push -u origin main && git tag v0.1.0 && git push origin v0.1.0 && gh run watch --exit-status $(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
```
Expected: run succeeds. Then make the package public so Tower can pull without extra auth:
```bash
gh api -X PATCH /user/packages/container/arcs --input - <<< '{"visibility":"public"}' || echo "set visibility to public at https://github.com/users/basmith7/packages/container/arcs/settings"
```

- [ ] **Step 2: Create the compose project on Tower**

```bash
ssh tower 'mkdir -p /boot/config/plugins/compose.manager/projects/arcs /mnt/cache/appdata/arcs && echo arcs > /boot/config/plugins/compose.manager/projects/arcs/name'
scp ~/Projects/arcs/docker-compose.prod.yml tower:/boot/config/plugins/compose.manager/projects/arcs/docker-compose.yml
ssh tower 'cd /boot/config/plugins/compose.manager/projects/arcs && docker compose -p arcs pull && docker compose -p arcs up -d && sleep 4 && docker ps --format "{{.Names}} {{.Status}} {{.Ports}}" | grep arcs && curl -s http://127.0.0.1:3070/healthz'
```
Expected: `arcs Up ... 0.0.0.0:3070->3070/tcp` and `ok`. From the desktop: `curl -s http://192.168.1.149:3070/healthz` → `ok`.

- [ ] **Step 3: Confirm Watchtower sees it**

```bash
ssh tower 'docker inspect arcs --format "{{index .Config.Labels \"com.centurylinklabs.watchtower.enable\"}}"'
```
Expected: `true`.

---

### Task 12: Pangolin resource, public verification, docs

**Model:** run inline (main session).

- [ ] **Step 1: Create the HTTP resource with a Newt health check**

Same calls the SmartDraft migration used (Vault "Pangolin VPS Migration" + `fantasy football/docs/superpowers/plans/2026-09-06-tower-migration.md` Task 11), on `domain1` (`basmith.net`):
```bash
TOKEN=$(cat ~/.config/pangolin_token)
papi() { ssh pangolin-vps "curl -s -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -X $1 http://127.0.0.1:3003/v1$2 ${3:+-d '$3'}"; }
RID=$(papi PUT /org/foobar/resource '{"name":"Arcs","subdomain":"arcs","domainId":"domain1","mode":"http"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["resourceId"])')
papi PUT /resource/$RID/target '{"siteId":1,"ip":"192.168.1.149","port":3070,"method":"http","enabled":true,"hcEnabled":true,"hcPath":"/healthz","hcScheme":"http","hcMode":"http","hcHostname":"192.168.1.149","hcPort":3070,"hcInterval":5,"hcUnhealthyInterval":30,"hcTimeout":5,"hcMethod":"GET"}' > /dev/null
papi POST /resource/$RID '{"ssl":true,"sso":false}' > /dev/null
echo "resourceId $RID"
sleep 15
papi GET /resource/$RID/targets | python3 -c 'import json,sys; [print(t["ip"], t["port"], "health:", t.get("hcHealth")) for t in json.load(sys.stdin)["data"]["targets"]]'
```
Expected: `192.168.1.149 3070 health: healthy`.

- [ ] **Step 2: Verify HTTPS and the WebSocket through Traefik**

```bash
sleep 60   # let Traefik issue the Let's Encrypt cert for arcs.basmith.net
curl -s -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://arcs.basmith.net/healthz
GID=$(curl -s https://arcs.basmith.net/games -H 'content-type: application/json' -d '{"options":{"board":"Board3MixUp","factions":["red","yellow","blue"],"seed":3},"factions":["red","yellow","blue"],"bots":["yellow","blue"]}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["gameId"])')
cd ~/Projects/arcs && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('wss://arcs.basmith.net/games/$GID/live');
ws.on('open', () => { console.log('ws open'); ws.close(); process.exit(0) });
ws.on('error', (e) => { console.log('ws error', e.message); process.exit(1) });
setTimeout(() => { console.log('ws timeout'); process.exit(1) }, 8000);
"
```
Expected: `200 0` then `ws open`. If the socket fails but HTTPS works, the Pangolin resource needs WebSocket support toggled (Resources → Arcs → Advanced) — check `papi GET /resource/$RID` for a websocket-related flag and set it.

- [ ] **Step 3: Play one real turn through the public URL**

Open `https://arcs.basmith.net/#/g/$GID/s/<redToken>` (token from the create response above), enter a name, play the lead, and watch the two bots move. Then create one game with a real Discord webhook from a test channel and confirm the ping arrives with a working link.

- [ ] **Step 4: Update the docs**

- `~/Documents/Vault 13/Infrastructure.md`: add to the App deployments table:
  `| **arcs** (`~/Projects/arcs`, arcs.basmith.net) | Tower Docker, host port **3070** | git tag `vX.Y.Z` → GitHub Actions builds `ghcr.io/basmith7/arcs` → golfbet's Watchtower auto-pulls. Compose at `/boot/config/plugins/compose.manager/projects/arcs/`, data `/mnt/cache/appdata/arcs/arcs.db`. Pangolin resource <RID> → 192.168.1.149:3070 with Newt health check on `/healthz`. Fork of willhaywood/open-arcs; server-side bots + Discord pings. **Never tag a release without being asked** |`
  and `3070` to the Tower host-port list.
- `~/Documents/Vault 13/Projects/Pangolin VPS Migration.md`: add a row to the public table: `| `arcs.basmith.net` | Arcs (resource <RID>) | HTTP resource | `192.168.1.149:3070` — health check via Newt on /healthz; created 2026-09-09 by API |`.
- Commit nothing in the repo for this step (the vault is outside it).

- [ ] **Step 5: Final state**

```bash
cd ~/Projects/arcs && git status --short && git log --oneline -12
```
Expected: clean tree; the commits from Tasks 1–9 plus any fixes from Task 10.

---

## Self-review notes

- **Spec coverage:** §3 layout/ports → Task 1; §4.1 store → Task 2; §4.3 gate → Task 3; §5 notifications → Task 4; §4.2 routes → Tasks 5–6; §4.4 client → Tasks 7–8; §6 image/CI/Tower/Pangolin/docs → Tasks 9, 11, 12; §7 tests → each task, manual → Tasks 10 and 12.
- **Deviation from spec, deliberate:** `GET /games/:id/live` also broadcasts `seats` on a name claim (spec did not say how other players learn names live). Additive to the push shape; `session.ts` ignores it upstream.
- **Type consistency:** `PublicSeat` is defined twice (server `api.ts`, client `client.ts`) with the same shape, on purpose — the client does not import server code (upstream rule). `Push.seats` uses the same shape.
