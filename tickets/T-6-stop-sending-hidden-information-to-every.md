---
id: T-6
title: Stop sending hidden information to every browser
status: todo
priority: medium
labels: []
depends: []
created: 2026-10-05T06:51:34Z
updated: 2026-10-05T06:51:34Z
---
Follow-up from arcs/T-4's spec review. `GET /games/:id` (`SqliteStore.read`) returns the game options (incl. the seed) and the full journal to anyone with the game id, token or not. The page replays it, so any player — or anyone with the bare link — can reconstruct every hand, the deck order and future shuffles from devtools. Hands are hidden only by the UI.

Fix direction (to settle in a spec): the server replays and sends each seat a redacted view — its own hand only, no seed, no rng — and watchers the public view. The engine already has the boundary: `observe(state, faction)` (packages/engine/src/observe.ts) for bots. Things that touch it: client-side replay and undo (`store.apply`, `takeBackBlock`), the bot Web Worker (runs on the page today, needs the full state), the watch feed, saves/loads, and the chapter interlude, which diffs two full states.

Identity is the seat token (the link is the credential); this doesn't need accounts.

## Done when
- [ ] No response or socket push to a seat contains another seat's hand, the seed, the rng state or the undealt deck order (test against the API, not just the UI)
- [ ] A request without a seat token gets the public view only
- [ ] Bots no longer run in players' browsers with full information (they run on the server or on a redacted view)
- [ ] Moves, undo, watching, the chapter interlude and the phone layout work as before (existing tests pass; a live game played through a round)
- [ ] Existing saved and live games keep working without a journal migration
