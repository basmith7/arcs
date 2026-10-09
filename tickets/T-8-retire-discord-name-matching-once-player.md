---
id: T-8
title: Retire Discord name-matching once players sign in
status: todo
priority: low
labels: []
depends:
  - T-3
created: 2026-10-05T07:07:49Z
updated: 2026-10-05T07:07:49Z
---
After the optional login (arcs/T-3), three ways of linking a seat to Discord coexist: guild name-matching (`bot.resolveMember` in api.ts `/seat`), a pasted Discord id in NamePrompt/Settings, and the signed-in account. The spec review marked this "track". Once most players sign in, drop name-matching (it guesses) and consider dropping the pasted id. Also: while a seat is claimed, a Discord id set through `/seat` is stored but ignored (the account's id wins); the UI should say so or hide it.

## Done when
- [ ] Name-matching is removed or kept with a recorded reason.
- [ ] A claimed seat's Settings never offers a Discord field that has no effect.
