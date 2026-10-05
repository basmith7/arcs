---
id: T-11
title: Unlock a seat someone else locked (Who are you? + Sit here griefing)
status: todo
priority: medium
labels: []
depends: []
created: 2026-10-05T19:42:00Z
updated: 2026-10-05T19:42:00Z
---
From the Fable review of arcs/T-3 (finding 1). v0.12.0's "Who are you?" (`POST /games/:id/claim {faction}`) hands any unlocked human seat's token to anyone with the bare game link (what Discord pings post). With login on, that person can then sign in and tap Sit here (`POST /games/:id/sit`), locking the real player out. The only way back today is SQL: `UPDATE seat SET account_id = NULL WHERE token = ?`.

Already done in T-3: `/claim` refuses a seat that is already locked, except to its owner.

Needs Brian: who may unlock a seat locked by someone else? Options: (a) the game creator; (b) any other account seated in the game; (c) `/sit` refuses tokens handed out by `/claim` until that seat has made a move; (d) accept the risk (friends-only tables).

## Done when
- [ ] Brian picks a rule.
- [ ] A seat locked by the wrong account can be unlocked without SQL, under that rule, with a test.
