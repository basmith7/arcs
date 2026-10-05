---
id: T-4
title: Scoreboard and personal turn catch-up
status: todo
priority: medium
labels: []
depends: []
created: 2026-10-05T06:33:56Z
updated: 2026-10-05T06:34:00Z
kind: build
risk: medium
riskReason: New AI dependency and per-seat private text on the live server; scoreboard itself is read-only
size: large
spec: docs/superpowers/specs/2026-10-04-scoreboard-catchup-design.md
---
A shared live Scoreboard dialog and a per-seat AI catch-up when your turn comes (hero framing, heads-ups, never advice). Spec: docs/superpowers/specs/2026-10-04-scoreboard-catchup-design.md. Spike: scripts/recap.ts on idea/agent-3.

## Done when
- [ ] Engine `gameFacts`/`seatFacts` exist; table tests on saved games (incl. game 158107d8's position) match the real chapter-end scoring
- [ ] `buildChapterReport` lives in the engine; `Declaration` carries `by`
- [ ] Each of the 5 heads-ups has a fires / doesn't-fire test
- [ ] Privacy test: a seat's facts never contain another seat's hand
- [ ] Scoreboard dialog opens from the header (desktop) and header menu (phone); screenshots of both
- [ ] Catch-up card on your turn: bullets at once, story pushed when written, collapsed on phone, dismissal remembered
- [ ] Server writer → checker → rewrite → bullets-only path tested with DeepSeek faked, plus timeout; moves never delayed
- [ ] Without DEEPSEEK_API_KEY the card shows bullets only, no errors
- [ ] Live: Brian sees his seat's catch-up on his next turn after deploy
