# Player stats page — design

Issue basmith7/arcs#19, phase 2 of the optional Discord login
(`2026-10-04-optional-login-design.md`). Planned 2026-10-14; **not yet agreed with Brian**.

## Problem

A signed-in player can list their games (`#/me`, `GET /me/games`), but nothing adds them up.
The issue asks for a per-player page with record, factions played, average power and game history.
The goal is a small first version that feels good to open after a game night, built only on data
that already exists.

## What data exists

- `seat.account_id → account` (sqlite-store.ts) links a seat to a player, and
  `SqliteStore.accountSeats(accountId)` already lists them with `created_at`/`updated_at`.
- Each game's outcome comes from replaying it: `gate.resultOf(gameId)` (LRU-cached) gives
  `state.isOver`, `state.winners`, `state.power`, `state.factions`, `state.leaders` (when Leaders &
  Lore is on) and `state.chapter`. `gameStatus()` in `api.ts` already turns that into `over`/`won`.
- Seats give the table: names, `isBot`, owner display names (`publicSeats`).
- "Faction" in the base game is a **colour** (`FACTION_IDS = red, yellow, blue, white`). The
  identity players care about is the **leader** when Leaders & Lore is on, so the page shows both.

What it doesn't have:

- **Games played before signing in** count only if the player claims them: by tapping Sit here, or
  through My Games' "Add games from this browser". Games on a lost or cleared browser are gone.
  The page says so and links to My Games.
- **Opponents without accounts** are names only (seat `name`, possibly different each game).
  Head-to-head against a person is only reliable between two signed-in accounts, so it isn't in v1.
- **Local games** (one device, no server) never reach the server. Out of scope.
- **Abandoned games** look the same as slow ones: nothing marks a game dead. v1 counts only
  finished games in the record and lists the rest as "in progress". No retention sweep exists, so
  this never resolves on its own.
- **When a game finished** isn't stored. `game.updated_at` is the last append, which is close
  enough for a finished game and is what the history shows.

## Recommendation

**Your own stats only, computed on request from the replays, no new tables.**

- `GET /me/stats` builds one summary per claimed game from `gate.resultOf`. Finished-game summaries
  are memoised in-process (a `Map` keyed by `gameId` and journal length) because a finished game
  never changes. With a few dozen games the cold path is roughly 25 ms per game, a second or so at
  most after a deploy, then instant. This is an estimate from docs/17's 0.049 ms/action, not measured.
- A `#/me/stats` page, linked from My Games, with four blocks: record, by leader / colour, average
  power, and history.

### Alternatives considered

- **A `game_result` table written at game end** (by the gate's `onSettled`), with a backfill. Rejected
  for v1: it's a migration, a backfill, and a second source of truth for something the journal
  already reproduces. A take-back near the end, or a replay fix in the engine, would leave it
  stale. Worth it only if the cold path gets slow, and the memo makes that unlikely at this scale.
- **Public profiles / a leaderboard of everyone** (`#/u/<accountId>`). Rejected for v1: friends
  probably wouldn't mind, but it needs a decision about what is visible (in-progress games? who
  you lost to?), and showing it means exposing account ids in URLs. This is the open question
  below; v1 leaves room for it because the summary builder takes an account id, not the session.
- **Charts (power over time, per-chapter lines).** Rejected for v1. The per-chapter data exists
  (`game-history.ts` builds chapter reports by replay), so it's a natural v2 on the same endpoint.

## Design

### API: `GET /me/stats` (`packages/server-node/src/api.ts`)

Same guards as `/me/games`: 404 when auth is off, 401 when signed out, `cache-control: no-store`.
Response (shape, not code):

- `summary`: `played` (finished), `won`, `inProgress`, `averagePower` (final power over finished
  games), `averagePlace`.
- `byLeader`: per leader id, `{ played, won, averagePower }`; omitted for games without Leaders & Lore.
- `byColour`: the same per colour.
- `games`: newest first, one per game. Fields: `gameId`, `seatToken` (so a row links like My
  Games), `updatedAt`, `over`, `won`, `place`, `power`, `colour`, `leader?`, `chapter`, `withBots`,
  and `table` (each seat's colour, name, power, isBot, and owner when one exists).

Rules, settled here so the implementer doesn't have to:

- **Place** uses the engine's winner order: power descending, seating order breaking ties. That
  rule currently lives in `apps/web/src/game-history.ts` (`standings`). Move it into
  `@arcs/engine` (next to `chapter-report.ts`) and have both the game-over screen and the server
  call it, so there's one owner and the two can't disagree.
- **Hotseat**: an account holding several seats in one game counts that game once, using the
  winning seat if any, otherwise the first. This is the same rule as `/me/games`. The row notes
  "held 2 seats".
- **Bot games count.** Most of these games include bots, and excluding them would empty the page.
  `withBots` lets the UI show a "vs humans only" toggle later. Not in v1.
- A game that won't replay is skipped, as in `/me/games`.

Share the per-game row building with `/me/games` (one helper that returns the result and seats
per claimed game) rather than copying the loop.

### Memo (`packages/server-node/src/gate.ts` or a small `stats.ts`)

A `Map<gameId, { length, summary }>` held next to the gate. It's used only when `isOver` is true and
the length still matches, so in-progress games always recompute (from the gate's cache).
Process-lifetime only, with no eviction needed at this scale.

### UI (`apps/web`)

- `components/PlayerStats.tsx`, rendered by `main.tsx` for `#/me/stats` the way `#/me` renders
  `MyGames` (outside `<App/>`, no game state).
- `MyGames.tsx` header gets a **Stats** link; the stats page has **My games** back. Signed out, it
  shows the same `SignInButton` as My Games.
- Layout, top to bottom:
  - A record line: "12 games, 5 won, average power 21.4, average place 2.1"
  - A small table by leader (or by colour when no game used leaders), with the colour swatch
    from `theme.ts` `colorOf`
  - The history list, one row per game: date, colour, leader, Won / 2nd / 3rd, power, and the
    table's names. Rows link to the game.
  - A footer line: "Only games you've claimed are counted. Add older games from this browser in
    My games."
- Phone: the page is one column already. Check it at the phone breakpoint `phone.css` uses and
  let the table scroll horizontally if it has to. Use no `phone.ts` machinery, since this isn't a game screen.
- Empty state: zero finished games shows the in-progress count and the footer line.

No new tables, columns or env vars.

## Slices

1. **Standings into the engine.** Move the place/tie rule from `game-history.ts` into
   `@arcs/engine`, and make the game-over screen use it.
   *Verify:* engine unit test with a tie broken by seating order. The existing game-over tests pass.
2. **`GET /me/stats` plus memo.** Shared row helper with `/me/games`.
   *Verify:* server test with a seeded account holding one won game, one lost game (with a tie on
   power), one in progress, and one hotseat game. Assert the summary numbers, places, `byLeader`,
   and that a second call doesn't replay (count via a spy on `replayGame` or the gate's stats).
   Paste the run.
3. **`#/me/stats` page.** Routing in `main.tsx`, `PlayerStats.tsx`, the link from My Games.
   *Verify:* screenshots on desktop and phone width, with data and empty. Run `screenshot-critique`
   before calling it done.
4. **Live check.** Deploy; open the page signed in on arcs.basmith.net and confirm the record
   matches what Brian remembers of the claimed games.

## Test plan

- Engine: the standings rule (slice 1).
- Server: `/me/stats` against a seeded store (slice 2), plus 404 with auth off and 401 signed out.
- UI: screenshots only, which is the house rule (no UI unit tests, per the login spec).
- Live: slice 4.

## Risks

- **Thin data at first.** Only claimed seats count, and login shipped on 2026-10-04 (v0.12.0), so the
  page may show two or three games at launch. The footer line and My Games' import are the
  remedy, and it's worth Brian importing his own browser's games before judging the page.
- **Cold replay after a deploy.** Estimated, not measured. If the first load of a large account
  is visibly slow, that's the trigger for the `game_result` table, not for anything cleverer.
- **Leader ids → names.** The page needs the display name of a leader card; the web app already
  has card names (`CardFace.tsx`/engine card data). Use that, not a new list.

## Open question for Brian

Own stats only, or can friends see each other's (a public `#/u/<id>` page or a table-wide
leaderboard)? v1 builds own-only and keeps the builder account-scoped so either is a small
follow-up.

## Done when

- [ ] `GET /me/stats` returns record, by-leader, by-colour, average power/place and history for
      the signed-in account. It 401s signed out and 404s with login off (tests pasted).
- [ ] Place and ties come from one engine function shared with the game-over screen.
- [ ] A second request doesn't replay finished games (test).
- [ ] `#/me/stats` renders with data, empty, and signed out, on desktop and phone (screenshots
      critiqued). It's linked from My Games, and each history row opens its game.
- [ ] The page says which games are missing (unclaimed / pre-sign-in) and points to My Games' import.
- [ ] Verified live on arcs.basmith.net.
