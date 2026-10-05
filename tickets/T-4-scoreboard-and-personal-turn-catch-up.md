---
id: T-4
title: Scoreboard and personal turn catch-up
status: done
priority: medium
labels: []
depends: []
created: 2026-10-05T06:33:56Z
updated: 2026-10-05T08:38:04Z
kind: build
risk: high
riskReason: New AI dependency, a new table and per-seat private text on the live server; 3,100 changed lines
size: large
spec: docs/superpowers/specs/2026-10-04-scoreboard-catchup-design.md
plan: docs/superpowers/plans/2026-10-04-scoreboard-catchup.md
build:
  at: 2026-10-05T07:02:07Z
  agent: arcs-t-4-1
merged: ebad4af3b51ce16c2fe9c0a42ea451dc23fde381
mergedAt: 2026-10-05T08:38:04Z
---
A shared live Scoreboard (dialog on desktop, fifth tab on phone) and a per-seat AI catch-up when your turn comes (hero framing, heads-ups, never advice). Spec approved by Brian 2026-10-04: docs/superpowers/specs/2026-10-04-scoreboard-catchup-design.md. Spike: scripts/recap.ts on idea/agent-3.

The live check ("Brian sees his seat's catch-up on his next turn after deploy") moved to arcs/T-9: it can only be done after this merges and deploys.

## Done when
- [x] Engine `gameFacts`/`seatFacts` exist; table tests on saved games (incl. game 158107d8's position) match the real chapter-end scoring
- [x] `buildChapterReport` lives in the engine; `Declaration` carries `by`
- [x] Each of the 5 heads-ups has a fires / doesn't-fire test
- [x] Privacy test: a seat's facts never contain another seat's hand
- [x] Scoreboard opens as a dialog from the header on desktop and as a fifth bottom tab on phone; screenshots of both
- [x] Catch-up card on your turn: bullets at once, story pushed when written, collapsed on phone, dismissal remembered
- [x] Server writer → checker → rewrite → bullets-only path tested with DeepSeek faked, plus timeout; moves never delayed
- [x] Without DEEPSEEK_API_KEY the card shows bullets only, no errors
- [x] DEEPSEEK_API_KEY wired into the compose environment (repo and Tower copy)
