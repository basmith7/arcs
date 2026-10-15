# Hidden information: what the browser holds — design

Issue basmith7/arcs#18. Planned 2026-10-14; **not yet agreed with Brian**. The recommendation below
departs from the issue's fix direction on purpose, so the issue's "Done when" needs rewriting
if it is accepted.

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
| Look at the screen, Elements panel | Your own hand only. Rivals show as counts (`PlayerBoards.tsx:119` reads `.length`); no rival card ids in the DOM (unverified by test; slice 3 adds one) |
| Network tab | `options.seed` and a list of encoded actions. Played cards are public anyway; draws are not actions. Nothing readable about hands without running code |
| Console | Nothing: no `window.store` or other global (grep, 2026-10-14) |
| React DevTools extension | The store's `RuleResult` through component props: every hand, readable by clicking through `state.cards` |
| Load `@arcs/engine`, replay with the seed | Everything, including future shuffles and dice |
| **Create the game** | **The creator picks the seed.** `NewGame.tsx:84` makes it a visible, editable field, and `POST /games` stores it as sent. Pre-playing a start offline needs no devtools at all |

Two facts change the picture from the issue's framing:

- **Bots already don't run in players' browsers in joined games.** `store.botsAvailable()` is
  `session === null`; joined games' bots run in the server's gate (`gate.ts`, `thinker.ts`,
  `packages/server-node/src/bot-worker.ts`). The page's `bot-worker.ts` serves only local games,
  where one device holds everything anyway. That Done-when item is already met.
- **The client is a journal replayer through and through.** 23 files in `apps/web/src` read
  `GameState`/`RuleResult` directly. Optimistic moves, the legal-action list a seat is offered,
  `takeBackBlock` for the undo button, catch-up (`store.ts:720` replays slices), the interlude's
  `prevState` and the game-over history (`game-history.ts`) all run the engine on full state.
  docs/17 section 5 costs server-authoritative play as "the randomness change alone"; that is true
  of the engine and leaves out the client.

## Recommendation: keep "trust the table", close the cheap holes, say it out loud

Keep the shared-journal design. Do three small things that remove the low-effort routes, and
state the trust model where players can see it. Plan to revisit if Arcs ever seats strangers
(public lobby, open links posted outside the friend group). That trigger, not this issue, is
when server-side redaction earns its cost.

Why: everyone at this table is a friend, and in a physical game they could just as easily look at
each other's hands. After this change, cheating takes deliberate work: installing React DevTools
and digging through component props, or replaying the journal by hand. Someone doing that has
chosen to cheat, and no protocol stops that at a friends' table. The one low-effort hole is the
chosen seed, and it costs about an hour to close.

### Alternatives considered

**A. Server-authoritative views (the issue's direction, docs/17 section 5).** The seed stays on the
server, randomness enters the journal as outcomes, and each seat gets `observe(state, faction)`.
Rejected *for now* for its cost:
- Engine: dice, deck shuffles, court draws, lore and the setup draft must carry their outcomes
  (`rules/battle.ts`, `turn.ts`, `setup.ts`, `leaders.ts`, `vox.ts` all read `state.rng`).
  Existing journals have no outcomes, so old games need a seed-replay compatibility path, against
  the issue's "no journal migration" item.
- Client: everything above that replays has to move. The server would offer each seat its
  legal actions and send views, and every one of the 23 state-reading files would be ported to a
  widened `ObservedState`. Optimistic moves go, so every click waits a round trip through Pangolin.
- Catch-up, the interlude and the game-over history would need server-side builders or retained
  views.
- Estimate: several weeks, and it touches the rules engine where the arena-tested bots live. It
  defends against a friend deliberately cheating.

**B. Redacted `GameState` snapshots.** The server sends a full-shaped `GameState` with rivals'
hands and deck order replaced by placeholders, and the client keeps its engine for rendering and
for its own seat's legal moves. Rejected: it's only cheaper if the engine copes with placeholder
cards everywhere it looks them up (an open-ended audit). It still gives up optimistic moves and
still needs the server-side randomness from A, because the next draw would otherwise be
computable from a real rng. It's most of A's cost and gives a more fragile result.

**C. Obfuscation (encrypt the journal, minify state names, block the devtools hook).** Rejected:
the key and the engine have to be on the page, so it slows a determined player down by minutes and
makes our own debugging worse.

**D. Do nothing.** Rejected only narrowly. The chosen seed is a real low-effort hole, and the
issue deserves a written answer rather than staying open.

## Design

### 1. The server mints the seed for shared games

- `POST /games` (`api.ts`, the create branch) replaces `options.seed` with a server-drawn value
  (`crypto.randomInt` over the engine's seed range) before `startGame` validates it and
  `store.create` stores it. Whatever seed the client sent is ignored. Local games are unchanged.
- `NewGame.tsx`: the seed field is shown only on the local path (it's useful for reproducing a
  local game). The shared path stops sending it.
- Old games keep their stored seed. Nothing migrates.
- Effect: nobody knows a shared game's seed until it exists, so nobody can pre-play the start.
  After creation it's in the `GET` response like today, which is the deliberate-effort route.

### 2. Hands never reach the DOM

Most of this already holds. The slice pins it with a test and fixes anything the test finds, for
example a rival's card id in a `data-` attribute, a `title`, an `alt`, or a card-back image named
after the card. The phone layout (`phone.ts`, `PhonePlays.tsx`) and the zoom and reader modals
(`CardZoom.tsx`, `MapZoom.tsx`) are in scope, since they render cards by id.

### 3. Say it where players see it

- One line in the Rules/About surface (`RulesModal.tsx` or the share step in `ShareGame.tsx`,
  whichever the implementer finds players actually read): "Hands are hidden on screen, not locked:
  like a real table, a determined peek is possible. Play nice."
- docs/17 section 2a gets a row for the seed ("chosen by: server, since v0.14.x"). Section 5's cost
  paragraph is corrected to include the client work listed above, so a future reader doesn't
  inherit the "randomness change alone" estimate.
- `Hand.tsx`'s comment already states the boundary and stays.

### Not changed

`GET /games/:id` still returns options and the journal to tokenless watchers. Watching needs replay,
and a watcher who could see hands still has to make the same deliberate effort as a player.
Undo, the watch feed, the interlude, saves and loads, catch-up and the bot worker are untouched.

## Slices

Each slice is its own commit, and each can ship alone.

1. **Server-minted seed.** `api.ts` create branch plus `NewGame.tsx` shared path.
   *Verify:* an API test that POSTs `seed: 1` and reads back `options.seed !== 1`, and that two
   creates with the same body get different seeds. A local game with a typed seed still reproduces.
2. **Trust line plus docs/17.** Copy in one surface, the 2a row, and the section 5 correction.
   *Verify:* screenshot of the line on desktop and phone, and docs diff reviewed.
3. **DOM hygiene test.** Render a joined, seated game mid-round (desktop and phone layouts). Collect
   every card id held in rivals' hands from the full state, and assert none appears in the
   serialized DOM (text and attributes). Fix any hits.
   *Verify:* the test fails against a planted leak (temporarily render a rival's id) and passes
   without it. Paste both runs.
4. **Close #18** with a comment linking this spec and the revisit trigger, after Brian agrees.

## Test plan

- `packages/server-node/test`: create-seed test (slice 1). The existing API/gate suites must stay
  green, since `startGame` validates the minted seed like any other.
- `apps/web/test`: the DOM hygiene test (slice 3), using whatever DOM environment the existing
  web tests use. If none renders `<App/>`, use the interaction harness in docs/18 instead, and say
  which in the commit.
- Live: create a shared game on arcs.basmith.net and confirm the stored seed isn't the one in the
  page's form. Play a round to confirm nothing else moved.

## Risks

- **Brian may want the real guarantee anyway** (for example, he's planning to seat strangers). Then
  this spec is the wrong one. Option A should get its own spec, and slice 1 still stands as a
  first step: the server owning the seed is A's first move too.
- Seed range: the minted value must fall inside whatever `startGame`/`rng()` accepts (`rng.ts` takes
  any number and folds 0 to a constant). Use a 32-bit unsigned range.
- Any tooling that relies on a shared game's chosen seed (arena runs, bug repros of shared games)
  loses it. Repros already work from the stored options and journal, so this is likely a non-issue
  (unverified).

## Done when (replaces the issue's list if accepted)

- [ ] A shared game's seed is chosen by the server; a seed in the create body is ignored (API test).
- [ ] No rival's hand card id appears in the DOM of a seated or watching page, desktop or phone (test).
- [ ] The trust model is stated in one player-visible line, and in docs/17 2a/5 with corrected costs.
- [ ] Bots in joined games run on the server (already true; noted in the issue when closing).
- [ ] Existing games, moves, undo, watching, interlude, saves/loads and phone layout are unchanged:
      existing tests pass and a live round is played.
- [ ] #18 closed with the revisit trigger (strangers at the table → option A spec).
