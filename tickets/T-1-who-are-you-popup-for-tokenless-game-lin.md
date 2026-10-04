---
id: T-1
title: '"Who are you?" popup for tokenless game links'
status: todo
labels: []
depends: []
created: 2026-10-04T22:29:29Z
updated: 2026-10-04T22:36:06Z
kind: build
risk: medium
riskReason: "Loosens the link-is-credential model: anyone with the game link can take a seat"
size: medium
---
Tim opened a bare game link on a browser that had never stashed his seat, landed as a spectator and couldn't see his hand.

Design (Brian picked "trust the pick"): a visitor with no seat token (none in URL, none recalled) gets a modal listing the human seats (name + faction) and "Just watching". Picking a seat calls a new `POST /games/:id/claim {faction}` that returns the seat token; the client stashes it (`remember`), rewrites the hash and rejoins in that seat. Anyone with the game link can take any human seat — accepted among friends.

## Done when
- [x] `POST /games/:id/claim` returns a human seat's token, 403 for a bot seat, 404 for unknown game/faction (tested)
- [x] Opening `#/g/<id>` with no stashed seat shows the "Who are you?" modal listing human seats
- [x] Picking a seat joins as that seat (hand visible, URL carries the seat), and a reload keeps it
- [ ] "Just watching" dismisses to spectator mode
