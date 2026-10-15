# Player stats page — design

Issue basmith7/arcs#19, phase 2 of the optional Discord login
(`2026-10-04-optional-login-design.md`). Planned 2026-10-14; reviewed by Fable (approve-with-changes,
applied). Scope from Brian: friends-only table, simple.

## Problem

A signed-in player can list their games (`#/me`, `GET /me/games`), but nothing adds them up.
The issue asks for a per-player page with record, factions played, average power and game history.
The goal is a small first version that feels good to open after a game night, built only on data
that already exists.

## What data exists

- `seat.account_id → account` (sqlite-store.ts) links a seat to a player, and
  `SqliteStore.accountSeats(accountId)` already lists them with `created_at`/`updated_at`.
- Each game's outcome comes from replaying it: `gate.resultOf(gameId)` gives `state.isOver`,
  `state.winners`, `state.power`, `state.factions`, `state.initiativeOrder`, `state.leaders` (when
  Leaders & Lore is on) and `state.chapter`. `gameStatus()` in `api.ts` already turns that into
  `over`/`won`.
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

**Your own stats only, computed on request from the replays, with no new tables and no new cache.**

- `GET /me/stats` builds one summary per claimed game from `gate.resultOf`, which is already an LRU
  of 100 replayed results (`gate.ts:58,78,96-108`). That's plenty for a friends' table, so v1 adds
  no memo. Cold, a game costs its journal length × 0.049 ms/action (docs/19's measured figure),
  about 25 ms for a full game. That's estimated, not measured for this endpoint.
- A `#/me/stats` page, linked from My Games, with four blocks: record, by leader / colour, average
  power, and history.

### Alternatives considered

- **A `game_result` table written at game end** (by the gate's `onSettled`), with a backfill. Rejected
  for v1: it's a migration, a backfill, and a second source of truth for something the journal
  already reproduces. A take-back near the end, or a replay fix in the engine, would leave it
  stale. Worth it only if the page gets visibly slow.
- **A stats memo next to the gate.** Rejected: the gate's LRU already holds the results.
- **Public profiles / a leaderboard of everyone** (`#/u/<accountId>`). Rejected for v1: it needs a
  decision about what is visible, and it exposes account ids in URLs. The summary builder takes an
  account id rather than the session, so it's a small follow-up.
- **Charts (power over time, per-chapter lines).** Rejected for v1. The per-chapter data exists
  (`game-history.ts` builds chapter reports by replay), so it's a natural v2 on the same endpoint.

## Design

### Placing: one engine rule (`packages/engine`)

The engine breaks a tie for the win by **initiative order** (`performCheckWin`,
`rules/ambitions.ts:718-731`, rulebook 6.2.3). Factions missing from `initiativeOrder` go last, in
seating order. `game-history.ts:13,47` instead sorts standings by seating order, so on a tie the
game-over screen can list someone other than the winner first. That's a live bug, not just a stats
concern.

The fix is one helper, `standings(state)`, in the engine:
- Power descending, ties broken by the same order list `performCheckWin` builds (extracted into a
  shared `turnOrder(state)` helper so both use it).
- 2nd, 3rd and 4th use the same order, so place is fully determined.

`performCheckWin`, `game-history.ts` and the stats endpoint all call it.

### API: `GET /me/stats` (`packages/server-node/src/api.ts`)

Same guards as `/me/games`: 404 when auth is off, 401 when signed out, `cache-control: no-store`.
Response (shape, not code):

- `summary`: `played` (finished, counted), `won`, `inProgress`, `averagePower` and `averagePlace`,
  each **per player count** (`{ 2: …, 3: …, 4: … }`). Power and place aren't comparable across
  table sizes: the win threshold is `39 − 3 × players`, and 2nd of 2 isn't 2nd of 4.
- `byLeader`: per leader id, `{ played, won }`; omitted for games without Leaders & Lore.
- `byColour`: the same per colour.
- `games`: newest first, one per game. Fields: `gameId`, `seatToken` (so a row links like My
  Games), `updatedAt`, `over`, `won`, `place`, `players`, `power`, `colour`, `leader?`, `chapter`,
  `withBots`, `soloHotseat`, and `table` (each seat's colour, name, power, isBot, and owner when one
  exists).

Rules, settled here so the implementer doesn't have to:

- **Hotseat (new rule, not `/me/games`').** `/me/games` keeps the seat whose turn it is, else the
  first. That's a "where do I go now" rule and means nothing for a finished game. For stats, an
  account holding several seats in one game is represented by its **best-placed** seat.
- **Solo hotseat is excluded from the record.** If the account holds every human seat (testing,
  or a person playing against bots alone in hotseat), the game appears in history marked "hotseat",
  but stays out of `summary`, `byLeader` and `byColour`. A single human with bots in one seat
  counts normally.
- **Bot games count.** Most of these games include bots, and excluding them would empty the page.
  `withBots` lets the UI add a "vs humans only" toggle later. Not in v1.
- A game that won't replay is skipped, as in `/me/games`.

Share the per-game row building with `/me/games` (one helper that returns the result and seats
per claimed game) rather than copying the loop.

### UI (`apps/web`)

- `components/PlayerStats.tsx`, rendered by `main.tsx` for `#/me/stats` the way `#/me` renders
  `MyGames` (outside `<App/>`, no game state). `main.tsx:48` matches `'#/me'` exactly today, so the
  boot routing has to widen to tell the two pages apart.
- `MyGames.tsx` header gets a **Stats** link; the stats page has **My games** back. Signed out, it
  shows the same `SignInButton` as My Games.
- Layout, top to bottom:
  - A record line: "12 games, 5 won"
  - Average power and place for each player count played ("4 players: power 21.4, place 2.1"), so no
    number mixes table sizes
  - A small table by leader (or by colour when no game used leaders), with the colour swatch
    from `theme.ts` `colorOf`
  - The history list, one row per game: date, colour, leader, Won / 2nd of 4, power, and the
    table's names, marked "hotseat" where excluded. Rows link to the game.
  - A footer line: "Only games you've claimed are counted. Add older games from this browser in
    My games."
- Phone: one column. Check at the phone breakpoint `phone.css` uses, and let the table scroll
  horizontally if it has to.
- Empty state: zero finished games shows the in-progress count and the footer line.

No new tables, columns or env vars.

## Slices

1. **`standings` in the engine.** Extract the order list from `performCheckWin` into an engine
   helper, add `standings(state)`, and make `performCheckWin` and `game-history.ts` use it. This
   fixes the game-over screen's tie order on its own.
   *Verify:* engine test with a two-way power tie where initiative isn't seat one. `standings[0]` is
   the engine's winner, and 2nd/3rd follow initiative. Existing game-over tests pass. Paste the run.
2. **`GET /me/stats`.** Shared row helper with `/me/games`.
   *Verify:* server test with a seeded account holding one won game, one lost game with a power
   tie, one in progress, a two-seat hotseat game with another human, and a solo hotseat game.
   Assert per-player-count averages, places, `byLeader`, best-seat selection, and the solo game in
   history but not in the record. Also 404 with auth off and 401 signed out. Paste the run.
3. **`#/me/stats` page.** Widened `main.tsx` routing, `PlayerStats.tsx`, the link from My Games.
   *Verify:* screenshots at desktop and phone width (with data, empty, signed out), then
   `screenshot-critique` before calling it done.
4. **Live check.** Deploy; open the page signed in on arcs.basmith.net and confirm the record
   matches what Brian remembers of the claimed games.

## Test plan

- Engine: `standings` and the tie (slice 1).
- Server: `/me/stats` against a seeded store (slice 2).
- UI: screenshots only, which is the house rule (no UI unit tests, per the login spec).
- Live: slice 4.

## Risks

- **Thin data at first.** Only claimed seats count. Login shipped in v0.14.0 and has been live in
  prod since v0.14.1 (2026-10-14), so the page may show only a few games at launch. The footer line
  and My Games' import are the remedy; Brian should import his own browser's games before judging
  the page.
- **Cold replay after a deploy.** Estimated, not measured. If a first load is visibly slow, that's
  the trigger for the `game_result` table.
- **Leader ids → names.** Use the card names the web app already has (engine card data /
  `CardFace.tsx`), not a new list.

## Open question for Brian

Own stats only, or can friends see each other's (a public `#/u/<id>` page or a table-wide
leaderboard)? v1 builds own-only, and the builder is account-scoped so either is a small follow-up.

## Done when

- [ ] One engine `standings` rule (initiative order breaks ties) drives the winner, the game-over
      screen and stats; the tie test is pasted.
- [ ] `GET /me/stats` returns the record, per-player-count averages, by-leader, by-colour and history
      for the signed-in account, applying the hotseat rules. It 401s signed out and 404s with login
      off (tests pasted).
- [ ] `#/me/stats` renders with data, empty, and signed out, on desktop and phone (screenshots
      critiqued). It's linked from My Games, and each history row opens its game.
- [ ] The page says which games are missing (unclaimed / pre-sign-in) and points to My Games' import.
- [ ] Verified live on arcs.basmith.net.
