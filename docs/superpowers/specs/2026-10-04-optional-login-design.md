# Optional Discord login — design

Ticket arcs/T-3. Agreed with Brian 2026-10-04.

## Goal

A real login without adding friction. Seat links stay the way in: nobody is ever asked to sign in to
play. Signing in with Discord is an opt-in layer that gives a player:

1. **My Games on any device** — a list of their games that is not tied to one browser's localStorage.
2. **Reliable Discord pings** — the seat's Discord id comes from the login, not from matching a typed
   name against guild members (`bot.resolveMember`).
3. **A locked seat** — once a signed-in player holds a seat, a leaked or forwarded link can only watch.

Stats/history (record, factions, average power) is phase 2, its own ticket, built on the account data
this adds.

Out of scope: Google, passwords, email, auto-claiming old seats by a matched `discord_id`, admin UI.

## What stays the same

- `#/g/<id>/s/<token>` links, `remember`/`recall` in localStorage, the spectator link, hotseat, bots.
- Every request still carries the seat token; the gate (`EngineGate`) stays token-based. Login only
  adds a check *in front of* it.
- With `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` unset the feature is off: no button, no routes
  beyond 404, every seat behaves as unlocked. Same pattern as the bot (`main.ts:32-35`).

## Data

Two new tables and one column, added in `SqliteStore`'s existing migration style
(`sqlite-store.ts:109-119`):

```sql
CREATE TABLE IF NOT EXISTS account (
  id            TEXT PRIMARY KEY,          -- randomUUID
  discord_id    TEXT NOT NULL UNIQUE,
  discord_name  TEXT NOT NULL,             -- username, refreshed each sign-in
  display_name  TEXT NOT NULL,             -- global_name ?? username, refreshed each sign-in
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  token_hash    TEXT PRIMARY KEY,          -- sha256 of the cookie value; the raw token is never stored
  account_id    TEXT NOT NULL REFERENCES account(id),
  expires_at    INTEGER NOT NULL
);
ALTER TABLE seat ADD COLUMN account_id TEXT REFERENCES account(id);  -- null = unlocked
```

Expired sessions are deleted lazily on lookup and in a sweep at startup.

## Sign-in flow (Discord OAuth2, authorization code, scope `identify`)

- `GET /auth/discord?return=<hash>` — sets a short-lived (10 min) HttpOnly `arcs_oauth` cookie holding a
  random `state` plus the return hash, and redirects to
  `https://discord.com/oauth2/authorize?response_type=code&scope=identify&client_id=…&redirect_uri=…&state=…`.
  `redirect_uri` is `${PUBLIC_ORIGIN}/auth/discord/callback`. `return` must start with `#/` or it is dropped.
- `GET /auth/discord/callback?code&state` — checks `state` against the cookie, exchanges `code` at
  `https://discord.com/api/oauth2/token`, reads `GET /users/@me`, upserts `account` by `discord_id`,
  creates a session, sets `arcs_session` (HttpOnly, Secure when `PUBLIC_ORIGIN` is https,
  SameSite=Lax, Path=/, 90 days) and redirects to `/` + return hash. On any failure (cancel, bad
  state, Discord down) it still redirects to the return hash, with `signin=failed` as a query on the
  path (`/?signin=failed#/g/…`), and logs why. The page shows a one-line "Sign-in didn't complete"
  notice and strips the query with `history.replaceState`.
- `GET /me` — `{ account: { displayName, discordName } | null, enabled: boolean }`. `enabled` lets the
  client hide the button when the feature is off.
- `POST /auth/logout` — deletes the session row, clears the cookie.

Sessions slide: a lookup more than a day after the last extension pushes `expires_at` out to 90 days again.

CSRF: the only cookie-authorised writes are same-origin `fetch` POSTs, and SameSite=Lax keeps the
cookie off cross-site POSTs. The `access-control-allow-origin: *` header stays for the token API (it
does not allow credentials, so a foreign origin can never ride the cookie).

## Locking

One rule, in one function the API and the websocket both call:

```ts
// seat-access.ts
type Access = 'ok' | 'locked'
function seatAccess(seat: StoredSeat, account: Account | undefined): Access
// ok      when seat.accountId is null, or equals account?.id
// locked  otherwise
```

- `POST /games/:id/actions`, `/undo`, `/seat` — after the token resolves to a seat, `locked` returns
  `403 { error: 'seat-locked', owner: displayName }` before the gate is called.
- Websocket upgrade — a locked seat without its account's cookie connects as a spectator (no presence),
  so a watcher with a forwarded link never suppresses the owner's ping.
- `GET /games/:id` — `yourFaction` is only filled when access is `ok`; `publicSeats` gains
  `owner?: displayName` for locked seats.

**Claiming is always an explicit tap, never a side effect of opening a link**, so a signed-in player
opening a friend's forwarded link can't lock the friend out. A signed-in player on an unclaimed seat
sees, in place of the NamePrompt, one button: **Sit here as @name** (and a "use another name" link that
opens the normal NamePrompt). Tapping either calls `POST /games/:id/claim {seatToken, name?}`, which sets
`account_id` and the name (default: display name). Signed out, the NamePrompt is unchanged. A signed-in
player already playing an unclaimed seat (named before signing in) gets the same **Sit here as @name**
as a one-line bar above the board until they tap it or dismiss it.

**Discord id has one source.** For a claimed seat, the notifier (`notify.ts`) and `publicSeats` read the
Discord id and name through `seat.account_id → account`; the seat's own `discord_id`/`discord_name`
columns are used only for unclaimed seats (today's pasted id and name matching). A Discord rename
therefore shows up on every seat at the owner's next sign-in.

A bot seat is never claimable. One account may hold several seats in a game (hotseat-style testing).

**Releasing.** `POST /games/:id/release {seatToken}` by the owner clears `account_id` (keeps the name;
the seat falls back to its own Discord columns, which a claim never wrote, so it stops mentioning the
old owner). Settings shows **Release seat**, behind a confirm: "Anyone with this seat's link will be
able to play it. Release?" A player who has lost their Discord account is unlocked by hand in SQL; the
spec does not add an admin page.

## My Games

- `GET /me/games` — for the session's account: `[{ gameId, seatToken, faction, createdAt, updatedAt,
  length, yourTurn, over, won? }]`, most recently played first. That needs a new `game.updated_at`
  column, set on create and bumped by `append` and `truncateLast` (existing games backfill to
  `created_at`). `yourTurn` and `won` come from the gate's cached
  `RuleResult` (`askedFactions`, `state.winners`), replaying only games not yet cached.
- `#/me` in the web app: one row per game. Your turn first and highlighted, then games in progress,
  then finished games marked Won/Lost. Each row links to `#/g/<id>/s/<token>`, so the existing
  join path handles everything else.
- **Add games from this browser**: when the browser holds `arcs:seat:*` entries not on the list, a
  button opens a checklist of those games (game id, faction, names at the table) and claims the ticked
  ones via `/claim`. Ticking, not a silent sweep, because a borrowed browser holds someone else's seats.

## Navigation

The app reads the hash once at boot (`main.tsx:21`); nothing listens for `hashchange`. This adds the
smallest thing that makes links and Back work: a `hashchange` listener that reloads the page. Boot then
routes `#/me` to My Games, a game link to the game, and anything else to the lobby as today. So a My
Games row is a plain anchor, and Back from a game opened from My Games lands on My Games. No client
router.

## UI touch points

- Lobby header and the Settings modal: **Sign in with Discord** when signed out; display name,
  **My games** and **Sign out** when signed in. The phone layout puts the same in its Settings sheet.
- Opening a locked seat you don't own: the game opens in watch mode with a banner, "This seat is
  @name's. Sign in to play.", whose button signs in and returns to the same link.
- Errors: a `seat-locked` 403 during play (session expired mid-game) shows the same banner. The
  refused move is rolled back by the existing resync, and the banner's Sign in returns to the same
  link, so the player loses one tap and redoes the move.

## Configuration

New env: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. `PUBLIC_ORIGIN` already exists and builds the
redirect URI. Brian adds a redirect `https://arcs.basmith.net/auth/discord/callback` to a Discord
application (the Pikachu bot's application is fine) and puts both values in Tower's `.env`.
`docker-compose.prod.yml` passes them through.

## Testing

- **Lock rule:** one table test of `seatAccess` plus the 403 from `/actions`: (unclaimed | claimed by me
  | claimed by another) × (signed in | signed out).
- **OAuth callback:** `fetch` to Discord mocked. Covers a good code (creates the account, sets the
  cookie, redirects to the return hash), a bad `state` (no session), and a second sign-in (same
  account, refreshed names).
- **Claim:** sets `account_id`, and pings for the seat mention the account's Discord id. It is refused for bot seats and for seats claimed
  by someone else. Release clears it.
- **`/me/games`:** a seeded game with one seat to move and one finished game, checking the right
  `yourTurn`/`won`.
- **Websocket:** a locked seat without its cookie gets no presence.
- **UI:** screenshots of the signed-out button, the signed-in menu, My Games, the locked banner, and
  the phone Settings sheet. No UI unit tests.
- **Live:** sign in on arcs.basmith.net, open a game on a phone through My Games, take a turn, and get
  a Discord ping with the real mention.

## Rollout

Additive migration; existing seats stay `account_id = null`, so every current game plays exactly as
before. The release that adds this is a minor version (v0.12.0).

## Done when

- [ ] With the Discord env vars unset, the app behaves exactly as v0.11.1 and shows no sign-in button.
- [ ] Sign in with Discord creates an account and session and returns to the page it started from.
- [ ] Opening a seat link never claims it; a signed-in player's **Sit here as @name** tap does, and from then on pings mention their account's Discord id.
- [ ] A claimed seat's link, used signed out or by another account, watches only and shows the locked banner; `/actions`, `/undo`, `/seat` return 403 `seat-locked`.
- [ ] My Games lists the account's games with your-turn and Won/Lost, and opening one on another device plays the seat.
- [ ] Add games from this browser claims only the ticked games.
- [ ] Release seat (after a confirm) unlocks it for link play again.
- [ ] My Games rows and Back work through the hash (a `hashchange` reload); a failed sign-in returns to the starting page with a notice.
- [ ] Tests above pass; screenshots taken; verified live on arcs.basmith.net.

## If we started over
*Spec review (accretion), Fable 5.1, 2026-10-04. Advisory.*

Clean design: the account and session cookie are the identity, and the seat token stays the
capability. One `seatAccess` rule guards writes and the socket. Ownership comes from an explicit act,
and the Discord id is read through the account. A small hash router handles the new routes.

- Copying the account's Discord id onto the seat: two sources of truth, with stale names after a rename or release. **Fixed in this spec**: read it through `account_id`.
- Silent claim on opening a link. **Fixed**: claim only on a tap.
- Three ways to link Discord coexist (name matching, pasted id, OAuth). **Track**: drop name matching once most players sign in.
- Routes the app can't handle (`#/me`, the failure landing). **Fixed**: a `hashchange` reload plus boot routing.
- "Newest activity first" had no data behind it. **Fixed**: `game.updated_at`.

Verdict: acceptable accretion.

## Expectations
*Spec review (Jakob's Law), Fable 5.1, 2026-10-04. Advisory.*

- Following a link transfers ownership: users expect a link never to take something over, as in Docs, Slack and GitHub. **Departed without a reason. Fixed**: Sit here as @name.
- A failed sign-in: users expect to land back where they started, as with GitHub or Google OAuth. **Fixed**: return hash plus a notice.
- List → game → Back: users expect Back to return to the list. **Fixed** by the `hashchange` reload.
- Release seat in one tap: users expect a confirm before removing a protection. **Fixed**: confirm added.
- Session expiring mid-move: users expect to keep their work. **Fixed**: resync plus sign-in to the same link; the move is redone.
- Sign in with Discord in the header and My Games once signed in: matches common patterns.
- Skipping the name prompt in favour of the display name: **departs for a good reason**, less friction, and renaming stays available.
