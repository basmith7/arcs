---
name: next-turn
description: Advise Brian's move in a live arcs game he is playing. Use when he asks for help with his turn, what to play, or how his game stands.
---

# Next turn

Brian plays live games on Tower. He enters the move himself; you read the game, never write it.

**Hidden-hand rule:** every rival hand stays out of tool output. The commands below are
seat-scoped (`recap --seat` prints only that seat's hand; `advise` plays `hard`, which sees only an
`ObservedState`). Plain `recap` prints every hand, so it never runs on a live game.

## Steps

1. **Find the game.** List his seats, newest first:
   `ssh tower "sqlite3 -readonly /mnt/cache/appdata/arcs/arcs.db \"select g.id, s.faction, datetime(g.updated_at/1000,'unixepoch') from game g join seat s on s.game_id=g.id where s.name='Brian' order by g.updated_at desc limit 5\""`.
   Done when you have one game id and his faction. If several games are live, the one where step 3
   says `<faction> to act` is the one.
2. **Read the board:** `npm run recap -- <id> --seat <faction>`. The catch-up section is his view
   of what changed since his last turn.
3. **Ask the advisor:** `npm run advise -- <id> <faction>`. If it is not his decision, tell him
   whose turn it is and stop.
4. **Read the ranking.** `<` marks `hard`'s pick. `[tier-1]` (valued at the end of his turn) and
   `[reply-checked]` (after a sampled rival reply) are on different scales: compare scores only
   within a tag. Gaps under ~0.3 are a close call; say so. `--oracle` adds nothing (B2 did not
   pass), so skip it.
5. **Answer.** Done when he has:
   - the card play (lead, surpass, copy or pivot, and which card);
   - the actions in order, from "the line";
   - one or two reasons drawn from the board: ambition races, threats, what the card choice keeps
     in hand;
   - the runner-up when it was close.

   If memory holds a standing plan for this game (`game-plan-<id prefix>`), weigh the line against
   it and call out where they diverge.

   The line is `hard`'s plan, so actions after a battle or a rival's reply may need rethinking at
   the table. Flag that when the line has such a step.
