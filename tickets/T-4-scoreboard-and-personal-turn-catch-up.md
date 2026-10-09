---
id: T-4
title: Scoreboard and personal turn catch-up
status: done
priority: medium
labels: []
depends: []
created: 2026-10-05T06:33:56Z
updated: 2026-10-05T15:49:35Z
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

## Summary
Built and shipped v0.13.0. Everyone gets a Scoreboard: a button in the header on desktop, a fifth tab on phones. It shows each player's pieces, what they've declared, what they can tax, which court cards they're after, the ambition race, and "If the chapter ended now: Brian would take Keeper (+5) · Neal would take Tycoon (+3)". That last line comes from the game's real scoring. When your turn comes, a catch-up card shows what to be aware of right away. DeepSeek then writes a short story with you as the hero, and a second DeepSeek call checks it against the facts and for advice. If the story fails twice, you get just the bullet points. Tested with automated tests on the engine, the server (DeepSeek faked, including timeouts) and the page. I also ran real DeepSeek end to end on a copy of your game: most runs produced a checked story in 15–70 s, and the rest fell back to bullets as designed. I checked desktop and phone with screenshots. It was reviewed by Fable twice and DeepSeek three times, and every finding was fixed with a test except three small polish items (ticket T-10). Deployed. The live site reports stories on, the key reaches the server, and the live Scoreboard shows the right projection.
Tests and commands: npm test (1444 pass), npm run typecheck, local real-DeepSeek runs, scripts/deploy-now.sh v0.13.0, live log, database and Scoreboard checks.

## Call-outs
- Whether you actually see your catch-up on your next turn can only be checked when the game reaches you. Ticket T-9.
- A story appears for most turns. When DeepSeek's checker rejects both drafts you get just the bullets; that's the safety net working. Leaving it, because a missing story is better than a wrong one.
- Stories cost two to four DeepSeek calls per human turn, on the key shared with SMARTDraft. I haven't checked DeepSeek's prices. Leaving it, because it should be small at your pace.
- The card sits over the bottom of the map for your whole turn until you close it, and on a busy server a late story can make the card grow. Ticket T-10.
- Anyone with the game link could already work out every player's hand from the page. This feature doesn't make that worse. Ticket T-6.
- I added one line to Tower's arcs settings file so the server gets the DeepSeek key, with a backup kept and the change logged in the vault. Fixed.
