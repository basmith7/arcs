---
id: T-1
title: '"Who are you?" popup for tokenless game links'
status: done
labels: []
depends: []
created: 2026-10-04T22:29:29Z
updated: 2026-10-04T23:00:28Z
kind: build
risk: medium
riskReason: "Loosens the link-is-credential model: anyone with the game link can take a seat"
size: medium
build:
  at: 2026-10-04T22:40:08Z
  agent: arcs-agent-2
merged: 8600945011c3338f7250006aaf20ccd67f837431
mergedBefore:
  - 5e221a2b48b5d5cd8b3632c4dd4ae4883256a3c7
mergedAt: 2026-10-04T22:59:09Z
---
Tim opened a bare game link on a browser that had never stashed his seat, landed as a spectator and couldn't see his hand.

Design (Brian picked "trust the pick"): a visitor with no seat token (none in URL, none recalled) gets a modal listing the human seats (name + faction) and "Just watching". Picking a seat calls a new `POST /games/:id/claim {faction}` that returns the seat token; the client stashes it (`remember`), rewrites the hash and rejoins in that seat. Anyone with the game link can take any human seat — accepted among friends.

## Done when
- [x] `POST /games/:id/claim` returns a human seat's token, 403 for a bot seat, 404 for unknown game/faction (tested)
- [x] Opening `#/g/<id>` with no stashed seat shows the "Who are you?" modal listing human seats
- [x] Picking a seat joins as that seat (hand visible, URL carries the seat), and a reload keeps it
- [x] "Just watching" dismisses to spectator mode

## Summary
A game link with no seat token, opened on a browser that has never saved one, now asks "Who are you?". It lists the human seats by name ("Open seat" if unnamed) plus "Just watching". Picking a seat calls the new POST /games/:id/claim for that seat's token. The page joins as that seat and only then drops the watching session, saves the token in the browser and puts it in the URL. Bot seats are never handed out, and there's no popup on a finished game.

Verification: an API test covers the claim endpoint (human, bot, unknown seat, missing faction, unknown game). A store test covers both rejoin outcomes: success, and a failed rejoin that leaves the visitor watching a live game. Checked by hand in a browser on a local server: the popup, picking a seat, reopening the bare link, and Just watching. Three DeepSeek review rounds; all findings fixed except one non-blocking item, filed as arcs/T-2.

Released as v0.12.0 and deployed to Tower with deploy-now.sh. Live check: the claim route answers and the served page has the popup.

## Call-outs
- v0.12.0 also shipped arcs-agent-4's merged-but-unreleased fleet placement and hover work, plus the system-glow change that was merged with it.
- By design, anyone with the bare game link can take any human seat, including one already in use.
- arcs/T-2 (low): overlapping polls can apply a move twice for a moment. It only happens in polling mode and fixes itself on the next poll.
- `scripts/shard-runner.test.ts` was already failing on main (esbuild build of the arena shard), unrelated to this change.
- I haven't tested the popup on a phone; desktop only.
