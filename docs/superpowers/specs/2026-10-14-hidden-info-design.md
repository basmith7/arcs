# Hidden information: what the browser holds — design

Issue basmith7/arcs#18. Planned 2026-10-14; reviewed by Fable (approve-with-changes, applied).
**Decision (Brian, friends-only table, keep it simple): trust the table.** #18 closes on this spec,
with a revisit trigger.

## Problem

`GET /games/:id` (`SqliteStore.read`, `sqlite-store.ts:230`) returns `options` (with `seed`) and the
whole journal to anyone holding the game id, with or without a seat token. The page replays it
(`session.ts` `adopt` → `replayGame`), so every browser holds the full `GameState`: every hand,
the deck order, `unusedLore` and the rng. Hands are hidden only by `Hand.tsx` (`handOwner`), which
says itself that this "stops shoulder-surfing and mis-clicks, not devtools".

This is a known, recorded choice: docs/17 section 2 ("Trust the table") picked it for v1, and
section 2a tabulates what is and isn't enforced. The issue asks whether to reverse it.

## What a peek actually costs today

Checked in the code, 2026-10-14:

| Effort | What it shows |
| --- | --- |
| Look at the screen, Elements panel | Your own hand only. Rivals show as counts (`PlayerBoards.tsx:119` reads `.length`); no rival card ids seen in the DOM (by reading, not tested) |
| Console | Nothing: there's no `window.store` or other global |
| Network tab / open `GET /games/:id` in a tab | Plain JSON: `options.seed`, the setup options and the encoded actions. That's enough to cheat with, as the next row shows |
| Type that seed into a local game | Hands and the deck order. The local New Game screen has a seed field (`NewGame.tsx:84`). Copy the seed, match the setup (a few retries if the board was chosen blind), and replay the visible moves |
| React DevTools extension | Every hand, by clicking through `state.cards` in component props |
| Load `@arcs/engine` and replay | Everything, including future shuffles and dice |

So the shared seed is the hole, and it can't be closed while the client replays. Any player with a
browser and a few minutes can see hands. What stops them is that it's a deliberate act, the same
as at a real table. Who chose the seed matters little: today the creator chooses it, but every
player can read it once the game exists.

Other facts that change the issue's framing:

- **Bots already don't run in players' browsers in joined games.** `store.botsAvailable()` is
  `session === null`; joined games' bots run in the server's gate (`gate.ts`, `thinker.ts`,
  `packages/server-node/src/bot-worker.ts`). The page's `bot-worker.ts` serves only local games,
  where one device holds everything anyway. That Done-when item is already met.
- **Tokenless watchers already see who sits where.** `publicSeats` returns owner display names
  and seat names to anyone with the bare link. That's intended (it's how the table shows who's who)
  and unchanged here.
- **The client is a journal replayer through and through.** 23 files in `apps/web/src` read
  `GameState`/`RuleResult` directly. Optimistic moves, the legal-action list a seat is offered,
  `takeBackBlock` for the undo button, catch-up (`store.ts:720` replays slices), the interlude's
  `prevState` and the game-over history (`game-history.ts`) all run the engine on full state.
  docs/17 section 5 costs server-authoritative play as "the randomness change alone"; that is true
  of the engine and leaves out the client.

## Recommendation: trust the table, and write it down

Keep the shared-journal design. Do one optional piece of cheap hygiene (the server picks the seed
for online games, which is also option A's first step), add one line for players, and correct
docs/17. Revisit only if Arcs ever seats strangers (a public lobby, or links posted outside the
friend group). That trigger, not this issue, is when server-side redaction earns its cost.

Why: everyone at this table is a friend, and in a physical game they could just as easily look at
each other's hands. Peeking here takes a deliberate act, and nothing short of option A changes that.
Option A's cost (below) is out of proportion for a friends' table.

### Alternatives considered

**A. Server-authoritative views (the issue's direction, docs/17 section 5).** The seed stays on the
server, randomness enters the journal as outcomes, and each seat gets `observe(state, faction)`.
Rejected *for now* for its cost:
- Engine: dice, deck shuffles, court draws, lore and the setup draft must carry their outcomes
  (`rules/battle.ts`, `turn.ts`, `setup.ts`, `leaders.ts`, `vox.ts` all read `state.rng`).
  Existing journals have no outcomes, so old games need a seed-replay compatibility path.
- Client: everything above that replays has to move. The server would offer each seat its
  legal actions and send views, and every one of the 23 state-reading files would be ported to a
  widened `ObservedState`. Optimistic moves go, so every click waits a round trip through Pangolin.
- Catch-up, the interlude and the game-over history would need server-side builders.
- Estimate: several weeks, and it touches the rules engine where the arena-tested bots live.

**B. Redacted `GameState` snapshots.** The server sends a full-shaped state with rivals' hands and
deck order replaced by placeholders; the client keeps its engine for rendering. Rejected: the engine
would have to cope with placeholder cards wherever it looks cards up, it still loses optimistic
moves, and it still needs A's server-side randomness. It's most of A's cost and gives a more
fragile result.

**C. Obfuscation (encrypt the journal, hide the devtools hook).** Rejected: the key and the engine
must be on the page, so it buys minutes against a determined player and costs our own debugging.

**D. Do nothing at all.** Close to what this spec does. The difference is a written answer, a
corrected docs/17, and the optional seed slice.

## Design

### 1. The server picks the seed for online games (optional hygiene)

- The create branch of `packages/server-node/src/api.ts` (lines 206-241, `POST /games`) replaces
  `options.seed` with `crypto.randomInt(1, 2 ** 32)` before `startGame` and `store.create`. A seed in
  the request body is ignored for online games. `startGame` doesn't validate seeds (`rng.ts` folds
  any number to 32 bits), so this range is simply the full space without the 0 that `rng()` remaps.
- `NewGame.tsx`: the shared path stops sending a seed. The seed field may stay for local games,
  where it's useful for reproducing one.
- The Cloudflare worker (`packages/server/src/api.ts`, upstream's) is left as-is. It isn't deployed
  here, and the upstream merges stay additive.
- Old games keep their stored seed; nothing migrates.
- What it buys, honestly: nobody can pick a seed they've already played. It doesn't stop anyone
  reading the seed afterwards (see the table above).

### 2. One line for players, plus docs/17

- One short line in the share step (`ShareGame.tsx`): "Hands are hidden on screen, not locked —
  play nice." If it doesn't fit as one line, drop it.
- docs/17: add a row to section 2a for the seed (who picks it, and that every client can read it),
  and correct section 5's cost to include the client work listed above.

### Not changed

`GET /games/:id`, the watch feed, undo, the interlude, saves/loads, catch-up, the phone layout and
the bot worker are untouched.

## Slices

1. **Server-picked seed.** The create branch in `packages/server-node/src/api.ts` plus the
   `NewGame.tsx` shared path.
   *Verify:* an API test that POSTs `seed: 1` and reads back `options.seed !== 1`, and that two
   identical creates get different seeds. A local game with a typed seed still reproduces.
   Paste the run.
2. **Docs and the line.** The docs/17 2a row, the section 5 correction, and the share-step line
   (if it fits).
   *Verify:* docs diff reviewed, plus one screenshot of the line if it shipped.
3. **Close #18** with a comment linking this spec and the revisit trigger.

## Test plan

- `packages/server-node/test`: the create-seed test (slice 1). Existing API and gate suites stay green.
- Live: create a shared game on arcs.basmith.net, check that the stored seed isn't what the client
  would have sent, and play a round.

## Risks

- **Strangers arrive.** Then this spec no longer applies. Option A gets its own spec, and slice 1 is
  already its first step.
- Any tooling that relied on choosing a shared game's seed loses that. Repros work from the stored
  options and journal, so this is likely a non-issue (unverified).

## Done when

- [ ] An online game's seed is picked by the server; a seed in the create body is ignored (API test pasted).
- [ ] docs/17 2a/5 record the trust model and the corrected cost of option A.
- [ ] Bots in joined games run on the server (already true; said so when closing).
- [ ] Existing tests pass, and a live round is played after deploy.
- [ ] #18 closed with the revisit trigger (strangers at the table → option A spec).
