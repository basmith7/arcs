---
id: T-9
title: Check the turn catch-up live after the v0.13.0 deploy
status: todo
priority: medium
labels: []
depends:
  - T-4
created: 2026-10-05T08:24:59Z
updated: 2026-10-05T08:24:59Z
---
Moved out of arcs/T-4's Done-when: it can only be checked after T-4 merges and deploys, and the board will not merge T-4 with it open.

What to check on arcs.basmith.net after v0.13.0 is live:
- Tower log shows `catch-up stories: on (deepseek-v4-pro, checked by deepseek-flash)` at startup (`docker logs arcs`).
- On the next hand-off to a human seat in game 158107d8, the log shows either nothing (story stored) or one `[catchup] bullets only …` / `[catchup] no story …` line; `sqlite3 -readonly /mnt/cache/appdata/arcs/arcs.db "select game_id, faction, journal_len, length(text) from catchup"` shows the stored row.
- Brian opens his seat on his next turn and sees the card (bullets, then the story).

## Done when
- [ ] The live server logs that catch-up stories are on
- [ ] A story row is written for a human seat in the live game on a real hand-off
- [ ] Brian sees his seat's catch-up on his next turn
