---
id: T-2
title: Make the session poll idempotent (double-apply under overlapping polls)
status: todo
priority: low
labels: []
depends: []
created: 2026-10-04T22:59:03Z
updated: 2026-10-04T22:59:03Z
---
Found by the DeepSeek review of arcs/T-1. `Session.runPoll` (apps/web/src/multiplayer/session.ts) snapshots the journal length `have` before awaiting `read(since=have)` and then applies every returned entry with no re-check. Two sessions writing into the store at once can both apply the same action. That happens while "Who are you?" joins the seated session before leaving the watching one, or when a left session's poll is still in flight. The socket path (`applyPush`) already dedups against the current length.

Impact: narrow and self-healing. It only happens in polling mode (no WebSocket, or a socket drop); the next read sees `tail.length < have` and resyncs. The board can briefly show a doubled move.

Fix: after the await, skip entries already present, the same way `applyPush` does: `const already = (host.current()?.state.journal.length ?? have) - have; entries.slice(already)`.

## Done when
- [ ] A test with two overlapping polls returning the same entry applies it once
