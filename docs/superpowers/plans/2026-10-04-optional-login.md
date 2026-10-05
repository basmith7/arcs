# Optional Discord Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discord sign-in layered on seat links. A signed-in player's explicit tap locks a seat to their account. Pings use the account's Discord id. My Games lists the account's games on any device.

**Architecture:** The server adds `account`, `session` and `seat.account_id` to `SqliteStore`, and an `auth.ts` module for the OAuth routes and cookie session. Seat locking is one `seatAccess` function that `api.ts` calls before the gate, and that `server.ts` calls on websocket upgrade. The gate stays token-based. The web client gets an `account.ts` store, a `hashchange` reload so `#/me` and Back work, and four small UI pieces: the sign-in button, Sit here, the locked banner, and My Games.

**Tech Stack:** TypeScript, `node:sqlite`, `node:http` with web-standard `Request`/`Response`, vitest, React 18 with `useSyncExternalStore`, Vite.

**Spec:** `docs/superpowers/specs/2026-10-04-optional-login-design.md`

## Global Constraints

- Discord env unset (`DISCORD_CLIENT_ID` or `DISCORD_CLIENT_SECRET` missing): no sign-in button, `/auth/*` returns 404, and every seat behaves as unlocked. Behaviour is identical to v0.11.1.
- OAuth scope is `identify` only. The redirect URI is `${PUBLIC_ORIGIN}/auth/discord/callback`.
- The session cookie `arcs_session` is HttpOnly, SameSite=Lax, Path=/, Max-Age 90 days, and Secure when `PUBLIC_ORIGIN` starts with `https:`. The store keeps only `sha256(token)`.
- Sessions slide: a lookup more than one day after the last extension pushes expiry out to 90 days again.
- The `return` parameter is accepted only if it starts with `#/`; otherwise it is dropped and treated as `''`.
- Opening a seat link never writes. Only `POST /games/:id/claim` sets `account_id`.
- For a claimed seat, the Discord id and name come from `account`. The seat's own `discord_*` columns are used only for unclaimed seats, and a claim never writes them.
- A locked request returns `403 {"error":"seat-locked","owner":"<display name>"}`.
- Copy, verbatim from the spec:
  - "Sit here as @name"
  - "This seat is @name's. Sign in to play."
  - "Anyone with this seat's link will be able to play it. Release?"
  - "Sign-in didn't complete"
- Tests run with `npm test` at the repo root (vitest). Typecheck with `npm run typecheck`.

## Review Focus

1. **A non-owner holding a claimed seat's link**: watches only, everywhere. That means `/actions`, `/undo`, `/seat`, `GET` (no `yourFaction`) and the websocket (no presence). Test: Task 3 table, Task 4 websocket.
2. **Two cookies on one response** (the OAuth callback sets `arcs_session` and clears `arcs_oauth`): today `send()` in `server.ts` would keep only one. Test: Task 2, through `createArcsServer`.
3. **A cancelled or failed Discord consent** (`?error=access_denied`, no `code`, or a bad `state`): the player lands back on the return hash with `?signin=failed`, and no session is created. Test: Task 2.
4. **The creator's own `window.location.hash = …` in `NewGame` after the `hashchange` reload exists**: the page reloads into the game rather than joining twice or stalling. Test: covered by the Task 7 manual check, and the code change is in Task 7.
5. **An old database** (no `account`/`session` tables, no `seat.account_id`, no `game.updated_at`): it opens, migrates, and backfills `updated_at = created_at`. Test: Task 1.

---

## File Structure

**Server (`packages/server-node/src`)**
- `sqlite-store.ts` (modify): schema and migrations; account, session, claim and release methods; `seats()` joins account; `updated_at` bumps; `accountSeats()`.
- `auth.ts` (create): cookie helpers, `Auth` class (config, `accountOf(request)`, OAuth routes `/auth/discord`, `/auth/discord/callback`, `/me`, `/auth/logout`), with an injectable `fetch`.
- `seat-access.ts` (create): `seatAccess(seat, accountId)`.
- `api.ts` (modify): `Api.auth?`; routes the auth paths through `auth.route`; lock check on actions, undo and seat; `GET` returns `lockedSeat`; `publicSeats` gains `owner`; new `/claim`, `/release` and `/me/games`.
- `server.ts` (modify): multi-cookie `send`; websocket presence honours the lock.
- `main.ts` (modify): reads the env and builds `Auth`.
- `docker-compose.prod.yml` (modify): passes the two env vars through.

**Web (`apps/web/src`)**
- `multiplayer/client.ts` (modify): `lockedSeat` and `owner` types; `claim`, `release`, `me` and `myGames` calls.
- `multiplayer/session.ts` (modify): keeps `lockedSeat` from each read.
- `account.ts` (create): account store and hook (`useAccount`), `signInHref()`, `signOut()`, and the sign-in-failed flag.
- `main.tsx` (modify): `hashchange` reload; the `#/me` route; strips `?signin=failed`.
- `store.ts` (modify): `claimSeat`, `releaseSeat`, `lockedSeat()` and `mySeatOwned()`.
- `components/AccountBits.tsx` (create): `SignInButton`, `AccountSection` (for Settings), `SitHereBar`, `LockedBanner`, `SigninNotice`.
- `components/NamePrompt.tsx` (modify): optional `signedInAs` adds the Sit here button and hides the Discord field.
- `components/MyGames.tsx` (create): the `#/me` page and the Add-from-this-browser checklist.
- `components/settings-sections.tsx` (modify): Release seat in `GameSection`.
- `components/SettingsModal.tsx`, `App.tsx`, `components/NewGame.tsx` (modify): wiring.
- `multiplayer/link.ts` (modify): `rememberedSeats()` enumerates `arcs:seat:*`.

---

### Task 1: Store — accounts, sessions, claim, updated_at

**Files:**
- Modify: `packages/server-node/src/sqlite-store.ts`
- Test: `packages/server-node/test/sqlite-store.test.ts`, `packages/server-node/test/notify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Account { readonly id: string; readonly discordId: string; readonly discordName: string; readonly displayName: string }
  export interface AccountSeat { readonly gameId: string; readonly seatToken: string; readonly faction: string; readonly createdAt: number; readonly updatedAt: number }
  // SeatRow gains:
  readonly accountId?: string
  readonly ownerName?: string   // account.display_name when claimed
  // discordId/discordName on SeatRow come from account when claimed
  SqliteStore.upsertAccount(p: { discordId: string; discordName: string; displayName: string }): Account
  SqliteStore.createSession(accountId: string, tokenHash: string, expiresAt: number): void
  SqliteStore.sessionAccount(tokenHash: string, now: number): { account: Account; expiresAt: number } | undefined  // deletes and returns undefined if expired
  SqliteStore.extendSession(tokenHash: string, expiresAt: number): void
  SqliteStore.deleteSession(tokenHash: string): void
  SqliteStore.sweepSessions(now: number): void
  SqliteStore.seatByToken(gameId, token): SeatRow | undefined   // was private; make public
  SqliteStore.claim(gameId: string, seatToken: string, accountId: string, name: string): SeatRow[] | undefined
  SqliteStore.release(gameId: string, seatToken: string): SeatRow[] | undefined
  SqliteStore.accountSeats(accountId: string): AccountSeat[]   // updated_at DESC
  ```

- [ ] **Step 1: Write failing store tests** (add to `sqlite-store.test.ts`):

```ts
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
  })
})
```

Imports needed at the top of the test file if missing: `createRequire` from `node:module`, `tempDbPath`, `THREE_PLAYER` and `RED_FIRST_LEAD` from `./fixtures.js`.

- [ ] **Step 2: Add a notifier row** to the existing `notify.test.ts` mention test, using its own setup style. Claim the seat to an account whose `discordId` differs from the seat's pasted id, then assert the ping text contains `<@` + the account id + `>` and `mentions` equals `[accountDiscordId]`. No `notify.ts` change should be needed, because `turnLine` reads `seat.discordId`.

- [ ] **Step 3: Run `npm test -- packages/server-node/test/sqlite-store.test.ts packages/server-node/test/notify.test.ts`.** Expected: FAIL (methods missing).

- [ ] **Step 4: Implement.**
  - **SCHEMA:** add `updated_at INTEGER NOT NULL DEFAULT 0` to `game`, `account_id TEXT` to `seat`, and the `account` and `session` tables from the spec.
  - **Migrations:** rename `migrateSeatColumns` to `migrate()` and add, each guarded by `PRAGMA table_info`:
    ```ts
    if (!have.has('account_id')) this.db.exec('ALTER TABLE seat ADD COLUMN account_id TEXT')
    const gameCols = new Set((this.db.prepare('PRAGMA table_info(game)').all() as { name: string }[]).map((c) => c.name))
    if (!gameCols.has('updated_at')) {
      this.db.exec('ALTER TABLE game ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
      this.db.exec('UPDATE game SET updated_at = created_at')
    }
    ```
    Run `SCHEMA` (`CREATE TABLE IF NOT EXISTS account/session`) before `migrate()`, as today. `ALTER TABLE … REFERENCES` is not needed; a plain `TEXT` column is fine.
  - **`create`:** insert `updated_at` = the same `Date.now()` as `created_at`.
  - **`append` and `truncateLast`:** inside the transaction, `UPDATE game SET updated_at = ? WHERE id = ?` with `Date.now()`.
  - **The seat SELECT** (used by `seats()` and `seatByToken`; factor it into one `SEAT_SELECT` const):
    ```sql
    SELECT s.faction, s.token, s.name, s.is_bot, s.pings, s.account_id,
      CASE WHEN s.account_id IS NULL THEN s.discord_id ELSE a.discord_id END AS discord_id,
      CASE WHEN s.account_id IS NULL THEN s.discord_name ELSE a.discord_name END AS discord_name,
      a.display_name AS owner_name
    FROM seat s LEFT JOIN account a ON a.id = s.account_id
    ```
    Add `account_id` and `owner_name` to `SeatDb`, and map them to `accountId`/`ownerName` in `toSeat`.
  - **`upsertAccount`:** `INSERT INTO account (id, discord_id, discord_name, display_name, created_at) VALUES (?,?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET discord_name = excluded.discord_name, display_name = excluded.display_name`, then select by `discord_id`. Use `randomId()` for the id.
  - **`sessionAccount`:** join session to account by `token_hash`. If `expires_at <= now`, delete the row and return `undefined`.
  - **`claim`:** `UPDATE seat SET account_id = ?, name = ? WHERE game_id = ? AND token = ?`, returning `this.seats(gameId)`, or `undefined` if the token is unknown. **`release`:** `UPDATE seat SET account_id = NULL …`.
  - **`accountSeats`:** `SELECT s.game_id, s.token, s.faction, g.created_at, g.updated_at FROM seat s JOIN game g ON g.id = s.game_id WHERE s.account_id = ? ORDER BY g.updated_at DESC, g.created_at DESC`.
  - **`sweepSessions`:** `DELETE FROM session WHERE expires_at <= ?`.

- [ ] **Step 5: Run the same tests.** Expected: PASS. Then run `npm test -- packages/server-node`. Expected: all PASS; existing seat assertions (e.g. `api.test.ts` `seats` toEqual) are unchanged, because no new public fields appear yet.

- [ ] **Step 6: Commit** — `git commit -m "server: accounts, sessions and seat claims in SqliteStore"`.

---

### Task 2: Auth module — OAuth routes and cookie session

**Files:**
- Create: `packages/server-node/src/auth.ts`
- Modify: `packages/server-node/src/api.ts` (route `/auth/*` and `/me` to `auth`), `packages/server-node/src/server.ts` (`send` multi-cookie)
- Test: `packages/server-node/test/auth.test.ts`

**Interfaces:**
- Consumes: Task 1 store methods.
- Produces:
  ```ts
  export interface AuthConfig { readonly clientId: string; readonly clientSecret: string; readonly publicOrigin: string; readonly fetch?: typeof fetch; readonly now?: () => number }
  export class Auth {
    constructor(store: SqliteStore, config: AuthConfig)
    accountOf(request: Request): Account | undefined     // reads arcs_session, slides expiry
    route(request: Request): Promise<Response | undefined> // /auth/discord, /auth/discord/callback, /auth/logout, /me
  }
  export const SESSION_COOKIE = 'arcs_session'
  // Api gains:  readonly auth?: Auth
  ```
  When `api.auth` is undefined, `GET /me` returns `{ account: null, enabled: false }` and `/auth/*` returns 404 (handled in `api.ts`).

- [ ] **Step 1: Write failing tests** in `auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Auth } from '../src/auth.js'
import { SqliteStore } from '../src/sqlite-store.js'

const ORIGIN = 'https://arcs.test'
function discordFake(user = { id: '111111111111111111', username: 'bri', global_name: 'Brian' }) {
  const calls: string[] = []
  const f = (async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith('/oauth2/token')) return Response.json({ access_token: 'at', token_type: 'Bearer' })
    if (u.endsWith('/users/@me')) return Response.json(user)
    return new Response('no', { status: 404 })
  }) as typeof fetch
  return { f, calls }
}
const cookieOf = (res: Response, name: string): string | undefined =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0]!.slice(name.length + 1)

async function signIn(auth: Auth, ret = '#/g/abc') {
  const start = await auth.route(new Request(`${ORIGIN}/auth/discord?return=${encodeURIComponent(ret)}`))
  const oauth = cookieOf(start!, 'arcs_oauth')!
  const state = new URL(start!.headers.get('location')!).searchParams.get('state')!
  return auth.route(new Request(`${ORIGIN}/auth/discord/callback?code=c&state=${state}`, { headers: { cookie: `arcs_oauth=${oauth}` } }))
}

describe('Auth', () => {
  it('signs in: account, session cookie, back to the return hash', async () => {
    const store = new SqliteStore(':memory:')
    const auth = new Auth(store, { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const res = (await signIn(auth))!
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/#/g/abc`)
    const session = cookieOf(res, 'arcs_session')!
    expect(res.headers.getSetCookie().join('\n')).toMatch(/arcs_session=[^;]+; .*HttpOnly.*SameSite=Lax.*Secure/)
    const me = await auth.route(new Request(`${ORIGIN}/me`, { headers: { cookie: `arcs_session=${session}` } }))
    expect(await me!.json()).toEqual({ account: { displayName: 'Brian', discordName: 'bri' }, enabled: true })
  })

  it('a bad state or a cancelled consent creates no session and returns with signin=failed', async () => {
    const store = new SqliteStore(':memory:')
    const auth = new Auth(store, { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const start = (await auth.route(new Request(`${ORIGIN}/auth/discord?return=%23%2Fme`)))!
    const oauth = cookieOf(start, 'arcs_oauth')!
    for (const q of ['code=c&state=wrong', 'error=access_denied&state=x']) {
      const res = (await auth.route(new Request(`${ORIGIN}/auth/discord/callback?${q}`, { headers: { cookie: `arcs_oauth=${oauth}` } })))!
      expect(res.headers.get('location')).toBe(`${ORIGIN}/?signin=failed#/me`)
      expect(cookieOf(res, 'arcs_session')).toBeUndefined()
    }
  })

  it('drops a return that is not a hash route', async () => {
    const auth = new Auth(new SqliteStore(':memory:'), { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const res = (await signIn(auth, 'https://evil.example'))!
    expect(res.headers.get('location')).toBe(`${ORIGIN}/`)
  })

  it('logout deletes the session', async () => {
    const auth = new Auth(new SqliteStore(':memory:'), { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const session = cookieOf((await signIn(auth))!, 'arcs_session')!
    const cookie = { cookie: `arcs_session=${session}` }
    await auth.route(new Request(`${ORIGIN}/auth/logout`, { method: 'POST', headers: cookie }))
    expect(auth.accountOf(new Request(`${ORIGIN}/me`, { headers: cookie }))).toBeUndefined()
  })
})
```

Add one test to `server.test.ts`, following that file's existing server setup: through `createArcsServer` with an `Auth` using the fake fetch, the callback response carries **two** `set-cookie` headers (`arcs_session` and an expiring `arcs_oauth`).

- [ ] **Step 2: Run `npm test -- packages/server-node/test/auth.test.ts`.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement `auth.ts`.**
  - **Cookies:** `parseCookies(header)` splits on `;` and trims `k=v` pairs. `setCookie(name, value, maxAgeSec, secure)` returns `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`. A clear is `Max-Age=0`.
  - **Tokens:** `randomBytes(32).toString('base64url')`. Hash: `createHash('sha256').update(token).digest('hex')`.
  - **`GET /auth/discord`:** compute `state` and `ret` (the `return` value if it starts with `#/`, else `''`). Set `arcs_oauth` = `${state}.${Buffer.from(ret).toString('base64url')}` with Max-Age 600. Respond `302` to `https://discord.com/oauth2/authorize?` + `URLSearchParams({ response_type: 'code', scope: 'identify', client_id, redirect_uri: `${publicOrigin}/auth/discord/callback`, state, prompt: 'none' })`.
  - **`GET /auth/discord/callback`:** parse `arcs_oauth` into `[state, retB64]` and decode `ret`. A missing cookie, a state mismatch, `error` present, or `code` missing all give `fail(ret)`. Otherwise POST `https://discord.com/api/oauth2/token` with `application/x-www-form-urlencoded` (`client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `redirect_uri`), then GET `https://discord.com/api/users/@me` with `authorization: Bearer <access_token>`. A non-OK response or a thrown error also gives `fail(ret)`, logged via `console.warn('[auth]', reason)`. On success: `upsertAccount({ discordId: user.id, discordName: user.username, displayName: user.global_name ?? user.username })`, `createSession(account.id, hash(token), now + 90d)`, and respond `302` to `${publicOrigin}/${ret}`, appending two `set-cookie` headers (session; `arcs_oauth` cleared).
  - **`fail(ret)`:** `302` to `${publicOrigin}/?signin=failed${ret}`, plus clearing `arcs_oauth`.
  - **`accountOf`:** read `arcs_session` and look it up with `sessionAccount(hash, now)`. If `expiresAt - now < 89 days`, call `extendSession(hash, now + 90d)`.
  - **`POST /auth/logout`:** `deleteSession`, clear `arcs_session`, `204`.
  - **`GET /me`:** `{ account: a ? { displayName, discordName } : null, enabled: true }`, with `cache-control: no-store`.
  - The constructor calls `store.sweepSessions(now)`.

  Build responses with `new Headers()` and `headers.append('set-cookie', …)` per cookie.

- [ ] **Step 4: Wire into `api.ts`.** Add `readonly auth?: Auth` to `Api`. In `routeInner`, before the `/games` prefix check:
  ```ts
  if (path === '/me' && request.method === 'GET' && api.auth === undefined) return json({ account: null, enabled: false })
  if (path === '/me' || path.startsWith('/auth/')) return api.auth === undefined ? bad(404, 'not found') : api.auth.route(request)
  ```
  `/me/games` is handled in Task 5, so match `/me` exactly here.

- [ ] **Step 5: Fix multi-cookie `send` in `server.ts`:**
  ```ts
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v) })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) res.setHeader('set-cookie', cookies)
  ```

- [ ] **Step 6: Run `npm test -- packages/server-node`.** Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -m "server: Discord OAuth sign-in and cookie sessions"`.

---

### Task 3: Seat locking, claim and release in the API

**Files:**
- Create: `packages/server-node/src/seat-access.ts`
- Modify: `packages/server-node/src/api.ts`
- Test: `packages/server-node/test/api.test.ts`

**Interfaces:**
- Consumes: `Auth.accountOf`, `SqliteStore.seatByToken/claim/release`, `SeatRow.accountId/ownerName`.
- Produces:
  ```ts
  // seat-access.ts
  export type Access = 'ok' | 'locked'
  export function seatAccess(seat: { readonly accountId?: string }, accountId: string | undefined): Access
  // wire
  PublicSeat.owner?: string                                    // display name of the claiming account
  GET /games/:id  → adds lockedSeat?: { faction: string; owner: string } when the token's seat is locked to someone else (and omits yourFaction)
  POST /games/:id/claim   { seatToken, name? } → 200 { seats } | 401 signed-out | 403 seat-locked | 403 bot-seat | 400 bad name
  POST /games/:id/release { seatToken }        → 200 { seats } | 401 | 403 seat-locked | 403 not-claimed
  ```

- [ ] **Step 1: Write the failing table test** in `api.test.ts`. Give the test `api()` helper an optional `Auth` built with the fake `fetch` from Task 2. Move `discordFake`, `cookieOf` and `signIn` out of `auth.test.ts` into `fixtures.ts` and import them in both test files. Then:

```ts
describe('seat locks', () => {
  async function setup() {
    const store = new SqliteStore(':memory:')
    const auth = new Auth(store, { clientId: 'i', clientSecret: 's', publicOrigin: BASE, fetch: discordFake().f })
    const other = new Auth(store, { clientId: 'i', clientSecret: 's', publicOrigin: BASE,
      fetch: discordFake({ id: '333333333333333333', username: 'eve', global_name: 'Eve' }).f })
    const a: Api = { store, gate: new EngineGate(store, { pace: 0 }), auth }
    const created = (await (await route(post('/games', { options: THREE_PLAYER, factions: THREE_PLAYER.factions }), a))!.json()) as Created
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
    const created = (await (await route(post('/games', { options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }), a))!.json()) as Created
    const botToken = a.store.seats(created.gameId).find((s) => s.isBot)!.seatToken
    const res = (await route(post(`/games/${created.gameId}/claim`, { seatToken: botToken }, { cookie: me }), a))!
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'bot-seat' })
  })
})
```

`signIn` must use `BASE` as its origin when called from `api.test.ts`; give it an `origin` parameter (default `'https://arcs.test'`, which equals `BASE`).

- [ ] **Step 2: Run `npm test -- packages/server-node/test/api.test.ts`.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `seat-access.ts`:
    ```ts
    export function seatAccess(seat: { readonly accountId?: string }, accountId: string | undefined): Access {
      return seat.accountId === undefined || seat.accountId === accountId ? 'ok' : 'locked'
    }
    ```
  - In `routeInner`: `const account = api.auth?.accountOf(request)`. Add a helper:
    ```ts
    const lockedFor = (gameId: string, token: string): Response | undefined => {
      const s = store.seatByToken(gameId, token)
      return s !== undefined && seatAccess(s, account?.id) === 'locked'
        ? json({ error: 'seat-locked', owner: s.ownerName ?? '' }, 403) : undefined
    }
    ```
    Call it in `/actions`, `/undo` and `/seat` right after `seatToken` is validated: `const locked = lockedFor(gameId, b.seatToken); if (locked) return locked`.
  - **GET:** when `presented` resolves to a locked seat, call `store.read(gameId, since, undefined)` and add `lockedSeat: { faction, owner }`.
  - **`publicSeats`:** add `...(s.ownerName === undefined ? {} : { owner: s.ownerName })`.
  - **New regexes:** `claim = /^\/games\/([^/]+)\/claim$/` and `release = /^\/games\/([^/]+)\/release$/`.
    - **claim:** validate the body. No account gives `bad(401, 'signed-out')`. Unknown seat gives `bad(403, 'seat token does not belong to this game')`. Then `isBot` gives `bad(403, 'bot-seat')` and `lockedFor` gives its 403. The name is `b.name` trimmed if given (validate 1–`NAME_MAX`), else the seat's existing name, else `account.displayName.slice(0, NAME_MAX)`. Call `store.claim(…)`, then `api.onSeatsChanged?.(gameId)`, then return `json({ seats: publicSeats(store, gameId) })`.
    - **release:** no account gives 401. A seat with `accountId === undefined` gives `bad(403, 'not-claimed')`. A seat claimed by someone else gives `lockedFor`'s 403. Then `store.release`, `onSeatsChanged`, and `{ seats }`.

- [ ] **Step 4: Run `npm test -- packages/server-node`.** Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "server: seat locks, claim and release"`.

---

### Task 4: Websocket honours the lock; env and compose

**Files:**
- Modify: `packages/server-node/src/server.ts:178-195`, `packages/server-node/src/main.ts`, `docker-compose.prod.yml`
- Test: `packages/server-node/test/server.test.ts`

**Interfaces:**
- Consumes: `api.auth?.accountOf`, `seatAccess`, `store.seatByToken`.

- [ ] **Step 1: Write a failing test** in `server.test.ts`, using that file's existing presence/websocket test setup: claim red to an account, then connect `/games/:id/live?seat=<red>` with no cookie. Assert that `presence` reports red as not connected. Use the same assertion style the existing presence test uses (grep `presence.connect`/`isActive` in `server.test.ts` and copy it). Then connect with the owner's cookie in the upgrade request headers (`new WebSocket(url, { headers: { cookie } })` from `ws`) and assert red is connected.

- [ ] **Step 2: Run it.** Expected: FAIL (presence is registered regardless).

- [ ] **Step 3: Implement.** In the upgrade handler, build the account from the upgrade request's cookie:
  ```ts
  const account = api.auth?.accountOf(new Request('http://x/', { headers: { cookie: req.headers.cookie ?? '' } }))
  const row = seatParam === undefined ? undefined : api.store.seatByToken(gameId, seatParam)
  const seat = row !== undefined && seatAccess(row, account?.id) === 'ok' ? seatParam : undefined
  ```
  This replaces the existing `seats(gameId).some(...)` check.

- [ ] **Step 4: Wire `main.ts`.**
  ```ts
  const DISCORD_CLIENT_ID = process.env['DISCORD_CLIENT_ID'] || undefined
  const DISCORD_CLIENT_SECRET = process.env['DISCORD_CLIENT_SECRET'] || undefined
  const auth = DISCORD_CLIENT_ID !== undefined && DISCORD_CLIENT_SECRET !== undefined
    ? new Auth(store, { clientId: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET, publicOrigin: PUBLIC_ORIGIN })
    : undefined
  ```
  Pass `...(auth === undefined ? {} : { auth })` into `api`, and add `login=${auth === undefined ? 'off' : 'discord'}` to the startup log line.

- [ ] **Step 5: Compose.** In `docker-compose.prod.yml`'s `environment:`, add `DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID:-}` and `DISCORD_CLIENT_SECRET: ${DISCORD_CLIENT_SECRET:-}`, matching how `DISCORD_BOT_TOKEN` is passed there.

- [ ] **Step 6: Run `npm test -- packages/server-node && npm run typecheck:node`.** Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -m "server: locked seats get no presence; login env"`.

---

### Task 5: `GET /me/games`

**Files:**
- Modify: `packages/server-node/src/api.ts`
- Test: `packages/server-node/test/api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface MyGame { gameId: string; seatToken: string; faction: string; createdAt: number; updatedAt: number; length: number; yourTurn: boolean; over: boolean; won?: boolean; seats: PublicSeat[] }
  GET /me/games → 200 { games: MyGame[] } | 401 signed-out | 404 when auth is off
  ```
  `seats` is included so the page can show who is at the table without a second request.

- [ ] **Step 1: Write the failing test.**

```ts
it('lists my games with whose turn and the result', async () => {
  const { a, gameId, red, me } = await setup()   // reuse the seat-locks setup; red leads first
  await route(post(`/games/${gameId}/claim`, { seatToken: red }, { cookie: me }), a)
  const res = (await route(get('/me/games', { cookie: me }), a))!
  const { games } = await res.json()
  expect(games).toHaveLength(1)
  expect(games[0]).toMatchObject({ gameId, faction: 'red', seatToken: red, yourTurn: true, over: false, length: 0 })
  expect(games[0].won).toBeUndefined()
  expect((await route(get('/me/games'), a))!.status).toBe(401)
})
```

For `won`, add a second assertion against a finished game only if a finished-game fixture already exists (grep `isOver` in `packages/server-node/test`). If none exists, cover `won` with a unit test of the pure mapper below.

- [ ] **Step 2: Run it.** Expected: FAIL (404).

- [ ] **Step 3: Implement.** Extract a pure function so `won` is testable without a full game:
  ```ts
  export function gameStatus(result: RuleResult, faction: string): { yourTurn: boolean; over: boolean; won?: boolean } {
    const over = result.state.isOver
    return over
      ? { yourTurn: false, over, won: result.state.winners[0] === faction }
      : { yourTurn: askedFactions(result).includes(faction), over }
  }
  ```
  `winners[0]` is the winner after tie-breaks; see `ai/play.ts:909`. Unit-test it with a stub `{ state: { isOver: true, winners: ['red'] } } as unknown as RuleResult`: red gets `won: true`, blue gets `won: false`.

  Then add the route before the `/me` auth line: `if (path === '/me/games' && request.method === 'GET')`. If auth is off, 404. With no account, 401. Otherwise map `store.accountSeats(account.id)` to `{ ...row, length: store.journalLength(row.gameId), ...gameStatus(gate.resultOf(row.gameId)!, row.faction), seats: publicSeats(store, row.gameId) }`. Skip rows where `resultOf` is `undefined`. Return `{ games }` with `cache-control: no-store`.

- [ ] **Step 4: Run `npm test -- packages/server-node`.** Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "server: GET /me/games"`.

---

### Task 6: Web — client calls, account store, session `lockedSeat`

**Files:**
- Modify: `apps/web/src/multiplayer/client.ts`, `apps/web/src/multiplayer/session.ts`, `apps/web/src/store.ts`, `apps/web/src/multiplayer/link.ts`
- Create: `apps/web/src/account.ts`
- Test: `apps/web/test/account.test.ts`, extend `apps/web/test/session-seats.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // client.ts
  PublicSeat.owner?: string
  GameTail.lockedSeat?: { faction: string; owner: string }
  MultiplayerClient.me(): Promise<{ account: { displayName: string; discordName: string } | null; enabled: boolean }>
  MultiplayerClient.myGames(): Promise<MyGame[]>          // MyGame as in Task 5
  MultiplayerClient.claim(gameId, seatToken, name?): Promise<readonly PublicSeat[]>
  MultiplayerClient.release(gameId, seatToken): Promise<readonly PublicSeat[]>
  // account.ts
  export interface AccountState { readonly loaded: boolean; readonly enabled: boolean; readonly account: { displayName: string; discordName: string } | null; readonly signinFailed: boolean }
  export function loadAccount(baseUrl: string): Promise<void>
  export function useAccount(): AccountState
  export function getAccount(): AccountState
  export function signInHref(baseUrl: string, hash: string): string   // `${baseUrl}/auth/discord?return=${encodeURIComponent(hash)}`
  export function signOut(baseUrl: string): Promise<void>               // POST /auth/logout then location.reload()
  export function setSigninFailed(v: boolean): void
  // session.ts
  Session.lockedSeat: { faction: string; owner: string } | null
  // store.ts
  store.lockedSeat(): { faction: string; owner: string } | null
  store.claimSeat(name?: string): Promise<void>
  store.releaseSeat(): Promise<void>
  store.mySeatOwner(): string | undefined      // owner display name of this client's own seat
  // link.ts
  export function rememberedSeats(): { gameId: string; seatToken: string }[]
  ```

- [ ] **Step 1: Write failing tests.**
  - **`account.test.ts`:** stub `globalThis.fetch`. Call `loadAccount('')` against a fetch that answers `/me` with `{account:{displayName:'Brian',discordName:'bri'},enabled:true}`, then assert `getAccount()` equals `{ loaded: true, enabled: true, account: {…}, signinFailed: false }`. Then a rejecting fetch, which should give `{ loaded: true, enabled: false, account: null, signinFailed: false }`. Assert `signInHref('', '#/g/a/s/b')` is `/auth/discord?return=%23%2Fg%2Fa%2Fs%2Fb`.
  - **`rememberedSeats`:** with a stubbed `localStorage` holding `arcs:seat:g1=t1`, `arcs:settings=x` and `arcs:seat:g2=t2`, it returns the two seat pairs. Follow `persist.test.ts` for how it stubs `localStorage` in a DOM-less test.
  - **`session-seats.test.ts`:** add a row where the read returns `lockedSeat: {faction:'red', owner:'Brian'}` and no `yourFaction`. Assert `session.isSpectator === true` and `session.lockedSeat` equals that object.

- [ ] **Step 2: Run `npm test -- apps/web/test/account.test.ts apps/web/test/session-seats.test.ts`.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`client.ts`:** the four calls go through `this.json`. `claim` and `release` POST `{seatToken, name?}`/`{seatToken}`. `me()` is a GET to `/me`. `myGames()` is a GET to `/me/games` that returns `body.games`.
  - **`session.ts`:** in `resync`, and wherever a tail is read, set `this.lockedSeat = tail.lockedSeat ?? null`. Add `claim(name?)`, which calls `client.claim` and then `host.seats(...)` and `resync()`; resync matters because `yourFaction` doesn't change, but the seats do. Add `release()` the same way.
  - **`store.ts`:** thin pass-throughs to the session. `mySeatOwner()` follows `mySeatDiscordName`'s pattern, reading `.owner`.
  - **`account.ts`:** a module-level state plus a listener `Set`, exposed through `useSyncExternalStore`, mirroring the hooks at the bottom of `store.ts`. `loadAccount` catches every error into `enabled: false`.
  - **`link.ts`:** `rememberedSeats` walks `localStorage.key(i)`, keeps keys with the prefix `arcs:seat:`, and is wrapped in `try`/`catch` like `recall`.

- [ ] **Step 4: Run `npm test -- apps/web && npm run typecheck`.** Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "web: account store, claim/release client, lockedSeat"`.

---

### Task 7: Web — navigation, sign-in button, Sit here, locked banner, release, notice

**Files:**
- Create: `apps/web/src/components/AccountBits.tsx`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/components/NamePrompt.tsx`, `apps/web/src/components/SettingsModal.tsx`, `apps/web/src/components/settings-sections.tsx`, `apps/web/src/components/NewGame.tsx`, `apps/web/src/styles.css`, `apps/web/src/phone.css`

**Interfaces:**
- Consumes: Task 6 (`useAccount`, `signInHref`, `signOut`, `store.claimSeat/releaseSeat/lockedSeat/mySeatOwner`).
- Produces: `SignInButton`, `AccountSection`, `SitHereBar`, `LockedBanner` and `SigninNotice` from `AccountBits.tsx`, for Task 8.

No unit tests (UI layout, per the repo's testing rules). Verify with screenshots in Task 9.

- [ ] **Step 1: `main.tsx` navigation.**
  ```ts
  window.addEventListener('hashchange', () => window.location.reload())
  const params = new URLSearchParams(window.location.search)
  if (params.get('signin') === 'failed') {
    setSigninFailed(true)
    history.replaceState(null, '', window.location.pathname + window.location.hash)
  }
  if (MULTIPLAYER_URL !== null) void loadAccount(MULTIPLAYER_URL)
  const myGames = window.location.hash === '#/me'
  ```
  When `myGames` is true, render `<MyGames />` (Task 8) instead of `<App />`, and skip the join/autosave branch. Update the comment above `parseLink` to say a hash change now reloads.

- [ ] **Step 2: `NewGame.tsx` `onEnter`.** Now that a hash change reloads, the hash assignment re-enters the game through `main.tsx`. Replace the body with:
  ```ts
  remember({ gameId: created.gameId, seatToken })
  window.location.hash = hashFor(created.gameId, seatToken)
  ```
  Drop the `joinSession` call, and rewrite the comment: the reload joins, and `remember` keeps the stash. Import `remember` from `../multiplayer/link.js`.

- [ ] **Step 3: `AccountBits.tsx`.**
  - **`SignInButton()`:** renders nothing unless `enabled`. Signed out, it's `<a className="ghost" href={signInHref(MULTIPLAYER_URL!, location.hash)}>Sign in with Discord</a>`. Signed in, `<a className="ghost" href="#/me">My games</a>`.
  - **`AccountSection()`:** renders nothing unless `enabled`. A `set-section` titled "Account". Signed out: one row with the sign-in link. Signed in: "Signed in as {displayName} (@{discordName})", a **My games** link, and a **Sign out** button that calls `signOut(MULTIPLAYER_URL!)`.
  - **`SitHereBar({ onSit, onDismiss })`:** a slim bar: "Sit here as @{displayName} to lock this seat to you and get turn pings on Discord." with a **Sit here** button and a **×** button.
  - **`LockedBanner({ owner })`:** "This seat is @{owner}'s. Sign in to play." Signed out, it adds the sign-in link. Signed in as someone else, it adds no button.
  - **`SigninNotice()`:** shown while `signinFailed`. The text is "Sign-in didn't complete", with a × that calls `setSigninFailed(false)`. It auto-dismisses after 8 s via `useEffect` and `setTimeout`.

- [ ] **Step 4: `NamePrompt.tsx`.** Add an optional `signedInAs?: string` prop. When set:
  - Above the form, a primary button **Sit here as @{signedInAs}** calls `onSubmit(signedInAs)` without validation.
  - The input and submit button stay, as the "use another name" path. The submit label is "Sit here".
  - The Discord id label, input and help text are hidden.

  The caller decides what `onSubmit` does.

- [ ] **Step 5: `App.tsx` wiring.**
  - **Lobby branch:** add `<SignInButton />` to `newgame-load` after Settings, and `<SigninNotice />` at the end.
  - **Game branch:**
    ```tsx
    const account = useAccount()
    const signedIn = account.account !== null
    const locked = store.lockedSeat()
    const owner = store.mySeatOwner()
    const [sitDismissed, setSitDismissed] = useState(false)
    ```
    - When `needsName`, render `NamePrompt`. If `signedIn`, pass `signedInAs={account.account.displayName}` and use `onSubmit={(name) => store.claimSeat(name)}`. Otherwise keep the current `store.claimName` behaviour.
    - When `seatView.kind === 'seat' && !needsName && signedIn && owner === undefined && !sitDismissed`, render `<SitHereBar onSit={() => void store.claimSeat()} onDismiss={() => setSitDismissed(true)} />` under the topbar.
    - When `locked !== null`, render `<LockedBanner owner={locked.owner} />` under the topbar.
    - Render `<SigninNotice />` once.
  - **Hooks:** keep them above any early return, following the existing order in `App`. If `useAccount` has to come before `if (result === null) return`, put it with the other hooks at the top.

- [ ] **Step 6: Settings.**
  - **`SettingsModal.tsx`:** render `<AccountSection />` first, on both screens (outside the `seat === undefined ? null : …` block).
  - **`settings-sections.tsx` `GameSection`:** read `store.mySeatOwner()` and `useAccount()`. When the owner equals the signed-in display name, add a row with **Release seat**, whose `onClick` is `if (window.confirm("Anyone with this seat's link will be able to play it. Release?")) void store.releaseSeat()`.
  - **`PlayerSection`:** hide the Discord-id field when the seat has an owner, and show "Discord: @{discordName} (from sign-in)" instead.

- [ ] **Step 7: Styles.** `.sit-bar`, `.locked-banner` and `.signin-notice` in `styles.css`. Use the existing banner and notice colours: grep `name-error` and `ask-strip` for the palette variables and reuse them. In `phone.css`, the bar and banner go full width above the docked decision.

- [ ] **Step 8: Run `npm test && npm run typecheck`.** Expected: PASS.

- [ ] **Step 9: Commit** — `git commit -m "web: sign in, Sit here, locked banner, release, hash navigation"`.

---

### Task 8: Web — My Games page

**Files:**
- Create: `apps/web/src/components/MyGames.tsx`
- Modify: `apps/web/src/styles.css`, `apps/web/src/phone.css`, `apps/web/src/main.tsx` (already routes to it)

**Interfaces:**
- Consumes: `MultiplayerClient.myGames()`, `MultiplayerClient.read()`, `MultiplayerClient.claim()`, `rememberedSeats()`, `useAccount()`, `SignInButton`.

- [ ] **Step 1: Implement `MyGames.tsx`.**
  - **Layout:** the same `newgame-wrap` shell as the lobby (wordmark, then a list). A header row holds **New game** (`href="#/"`, which reloads to the lobby) and `SignInButton`.
  - **Signed out** (`account.loaded && account.account === null`): "Sign in to see your games on any device." plus `SignInButton`.
  - **Loading:** "Loading…". On error: "Couldn't load your games." with a **Retry** button.
  - **Rows:** `myGames()`, sorted into Your turn, then In progress, then Finished, keeping server order within each group.
    - Each row is `<a className="mg-row" href={`#/g/${gameId}/s/${seatToken}`}>`, showing the faction dot (`colorOf(faction)`), the names at the table (`seats.map(s => s.name ?? s.faction).join(', ')`), "Turn {length}", and a status pill: **Your turn** (highlighted) / **Waiting** / **Won** / **Lost**.
    - Above the list, "Updated" shows a relative time from `updatedAt` (e.g. "2h ago") through a small local `ago(ms)` helper.
  - **Add games from this browser:** `const local = rememberedSeats().filter((r) => !games.some((g) => g.gameId === r.gameId))`. When `local.length > 0`, show a button **Add games from this browser ({n})**. It opens an inline checklist; each item is labelled with the game's seats, fetched with `client.read(gameId, 0, seatToken)` (show its `yourFaction` and seat names; skip a game that 404s), and every box starts **unticked**. **Add selected** calls `client.claim(gameId, seatToken)` for each ticked game, ignoring 403s (someone else's seat) but listing them as "Already someone else's", then reloads the list.
  - **Empty:** "No games yet. Start one, or open a game link and tap Sit here."

- [ ] **Step 2: Styles** for `.mg-list`, `.mg-row`, `.mg-pill` (with `.yours`), and `.mg-import`. On phone, rows are full width with tap targets of at least 44 px.

- [ ] **Step 3: Run `npm run typecheck && npm test`.** Expected: PASS.

- [ ] **Step 4: Commit** — `git commit -m "web: My Games page and add-from-this-browser"`.

---

### Task 9: End-to-end check, screenshots, docs

**Files:**
- Modify: `AGENTS.md` (current-state paragraph: login shipped, the env vars, the still-open items)
- Create: `.agent-board/login-*.png` (not committed if `.agent-board/` is gitignored; check first)

- [ ] **Step 1: Run locally, same origin.** `npm run build:site && npm run build:server`, then:
  ```bash
  DISCORD_CLIENT_ID=fake DISCORD_CLIENT_SECRET=fake PUBLIC_ORIGIN=http://localhost:3071 PORT=3071 \
    DATABASE_PATH=/tmp/arcs-login.db STATIC_DIR=$PWD/apps/web/dist node packages/server-node/dist/main.js
  ```
  Real Discord can't complete with fake credentials. To see signed-in screens, mint a session directly:
  ```bash
  node -e "const {createHash}=require('crypto');const D=require('node:sqlite').DatabaseSync;const d=new D('/tmp/arcs-login.db');d.exec(\"INSERT OR IGNORE INTO account VALUES('acc','111111111111111111','bri','Brian',0)\");d.prepare('INSERT INTO session VALUES(?,?,?)').run(createHash('sha256').update('dev').digest('hex'),'acc',Date.now()+864e5)"
  ```
  Then set the cookie `arcs_session=dev` in the browser tool, through `document.cookie` on `localhost:3071`. The cookie is HttpOnly only when the server sets it; one set by hand from JS works for testing.

- [ ] **Step 2: Screenshots** (browser tool; desktop and a 390×844 phone viewport), saved under `.agent-board/`:
  - the lobby signed out (Sign in button);
  - the lobby signed in (My games);
  - the Sit here prompt on a fresh seat;
  - the Sit here bar on a named, unclaimed seat;
  - the locked banner (open the claimed link in a context with no cookie);
  - My Games with one your-turn row and one waiting row;
  - the Add-from-this-browser checklist;
  - Settings with the Account section and Release seat;
  - the phone Settings sheet.

- [ ] **Step 3: Check with the env vars unset.** Restart without `DISCORD_CLIENT_*`. There's no sign-in button, `/me` gives `{"account":null,"enabled":false}`, and creating and playing a game works as before. Check it with `curl -s localhost:3071/me` and a screenshot.

- [ ] **Step 4: Check Back.** Go My Games → tap a row → the game loads → browser Back → My Games. Also New Game → Enter the game → it loads once, with no double join (watch the server log for a single websocket connect).

- [ ] **Step 5: AGENTS.md.** Add a "login" line to the still-open list: name-matching coexists with sign-in (tracked), and a lost account is unlocked by SQL: `UPDATE seat SET account_id = NULL WHERE token = ?`. Bump "Current release" only at release time.

- [ ] **Step 6: Run `npm test && npm run typecheck`.** Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -m "docs: login in AGENTS.md"`.

Live verification (sign in on arcs.basmith.net, play a seat from a phone through My Games, receive a ping with the real mention) happens after Brian's Build it and the release. It needs Brian's Discord OAuth app (ask `7abee398`).
