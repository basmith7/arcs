---
id: T-3
title: Optional login (accounts layered on seat links)
status: todo
labels: []
depends: []
created: 2026-10-05T01:47:30Z
updated: 2026-10-05T07:07:41Z
kind: build
risk: medium
riskReason: New auth/session surface on a public site; seat locking can lock players out of live games if wrong.
size: large
spec: docs/superpowers/specs/2026-10-04-optional-login-design.md
plan: docs/superpowers/plans/2026-10-04-optional-login.md
---
Add a real login while keeping today's zero-friction seat links working: Discord OAuth sign-in, layered on top of the links.

Goals (Brian, 2026-10-04): My Games on any device, reliable Discord pings (id from the login, not name matching), seats locked to an account. Stats/history is phase 2, its own ticket.

Spec: docs/superpowers/specs/2026-10-04-optional-login-design.md
Plan: docs/superpowers/plans/2026-10-04-optional-login.md
Branch: idea/agent-5 (16 commits on main 35111fc)

## Done when
- [ ] With the Discord env vars unset, the app behaves exactly as v0.11.1 and shows no sign-in button.
- [ ] Sign in with Discord creates an account and session and returns to the page it started from.
- [ ] Opening a seat link never claims it; a signed-in player's "Sit here as @name" tap does, and from then on pings mention their account's Discord id.
- [ ] A claimed seat's link, used signed out or by another account, watches only and shows the locked banner; /actions, /undo and /seat return 403 seat-locked.
- [ ] My Games lists the account's games with your-turn and Won/Lost, and opening one on another device plays the seat.
- [ ] Add games from this browser claims only the ticked games.
- [ ] Release seat (after a confirm) unlocks it for link play again.
- [ ] My Games rows and Back work through the hash; a failed sign-in returns to the starting page with a notice.
- [ ] Tests pass; screenshots taken; verified live on arcs.basmith.net.
