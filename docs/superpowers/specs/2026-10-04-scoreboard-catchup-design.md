# Scoreboard and personal catch-up — design

2026-10-04 · status: draft for Brian's review

## Why

Arcs online games run for weeks: the live game `158107d8` started 2026-09-22 and was in chapter 1,
round 3 on 2026-10-04. Coming back to a turn after days, a player has to rebuild who is ahead and who
is after what from the board and the log. Brian asked for "some kinda scoreboard", an indication of
who is trying to do what, and a bit of narrative.

The spike (`scripts/recap.ts`, `npm run recap -- <game> [--public] [--story]`) answered three
questions on the live game:

- The numbers are cheap and exact from the engine, including "if the chapter ended now" — run the
  engine's own `ambition/score` on a copy of the state.
- The bots' `intentFor` cannot say who is after what: it reads board structure only and called all
  four players "going hard for Keeper". What players have *done* can — declared ambitions, tax base
  (cities by planet resource) and the court cards their agents sit on.
- DeepSeek writes a lively story from a public fact report in ~20 s, but every run had small factual
  slips ("two cities each", "two Gatekeepers cards"). Prose needs structured facts in and a check out.

## What ships

1. **Scoreboard** — shared, live, all code. Same view for every seat and for watchers.
2. **Personal catch-up** — per seat, written when the turn reaches that seat, with the player as the
   main character. It calls out what they should be aware of. It never advises a move.

Out of scope: a per-chapter shared story, Discord delivery of the catch-up, an "advise me" mode,
catch-ups for bots.

## 1. Shared facts (engine)

One pure function in `packages/engine` (moved out of `scripts/recap.ts`):

`gameFacts(state) → Facts` — public only. Per faction: power, cities/starports/ships, systems ruled,
resources held, secured court cards, hand *size*, declared ambitions, tax base, courting (court card
+ agent count). Per ambition: declared markers and each faction's holding (`metric`). And
`ifChapterEndedNow`: `buildChapterReport(state, perform(state, ScoreAmbitions()).state)` — the real
scoring code, read through the one existing parser of its log lines, so it cannot disagree with the
chapter end.

Two engine changes make this data rather than log-scraping:
- `buildChapterReport` and its helpers move from `apps/web/src/chapter-report.ts` into the engine,
  unchanged; the interlude and game-over screens import them from there.
- `Declaration` gains `by: FactionId`. Replay regenerates state from the journal, so saved games
  need no migration. "Declared ambitions" per faction reads it instead of the log.

`seatFacts(state, faction, sinceJournalIndex) → SeatFacts` — `gameFacts` plus: that seat's hand, the
log since that seat's previous turn, and the heads-ups below. Built from `observe(state, faction)`
where it touches hidden information, so another seat's hand is unreachable by type, as for bots.

`scripts/recap.ts` becomes a thin printer over these.

## 2. Scoreboard (web)

- A **Scoreboard** button in the game header opens a dialog built like Settings and Rules (same modal
  shell): closes on ✕, Esc and backdrop click. On a phone it is in the header menu, as Settings is.
- Content: one row per player (name, colour, power, pieces, systems ruled, declared, tax base,
  courting, resources, cards in hand as a count); an ambition race (holding per faction, declared
  markers); and "If the chapter ended now: Brian would take Keeper (+5) · Neal would take Tycoon
  (+3)" — worded as a projection; "won" stays for the real chapter end.
- Computed in the browser from the state it already has (`gameFacts`), recomputed on each update. No
  server change.

## 3. Personal catch-up

### When and what

- Written when the turn passes to a human seat. A new `catchup.ts` subscribes to the gate's
  settled event alongside the notifier — `main.ts` fans the one `onSettled` out to both — so it does
  not inherit the notifier's webhook/channel and `lastNotifiedLength` guards. Covers the journal
  since that seat's previous turn.
- Shape, ≤ ~120 words: one or two lines of story with the player as hero, 2–4 heads-ups, one line of
  rooting for them.

### Heads-ups (code picks them; v1 list)

1. A rival gained tax base in the resource your declared ambition needs.
2. A rival is one Tax or one Secure from tying or overtaking you on an ambition you lead.
3. A rival outnumbers your ships in a system where you have pieces, and holds Aggression played this
   chapter or Weapons in their public resource slots.
4. If the chapter ended now you would lose — or have just taken — first place on a declared ambition.
5. Your hand: it holds no card of a suit the current threat calls for, or this is your last card of
   the chapter.

Code only flags; wording is "X happened / X is true", never "you should". The writer may not add
heads-ups of its own.

### Writing and checking (server)

- Writer: DeepSeek `deepseek-v4-pro` via its HTTP API, prompt carried over from the spike (hero
  framing, facts only, no hidden rival information, no advice).
- Checker: `deepseek-v4-flash` asked whether every claim is in the fact sheet and whether any
  sentence tells the player what to do. On fail, rewrite once; on a second fail, keep bullets only.
- 30 s timeout per call. A single in-process queue (one game at a time); it never blocks a move.
- Stored in a new table `catchup(game_id, faction, journal_len, text, created_at)`; rows for a game
  are deleted when it ends. A deploy mid-write loses that one story; bullets still show.
- No `DEEPSEEK_API_KEY` in Tower's `.env` → bullets only, no error.

### Serving and UI

- **Bullets are computed in the browser** from `seatFacts`, like everything else the page derives
  from the journal, so they appear at once with no request.
- **The story is pushed**: when it is written, the server sends `{ catchup }` down that seat's
  existing socket (the per-seat push path `notify.ts` uses). `GET /games/:id/catchup` with
  `x-seat-token` returns the stored story for a page that loads after the push. No token, or a token
  for another game → 403.
- Honest limit: the page already receives the full journal whatever the token (`sqlite-store.ts`),
  so a determined player can reconstruct hands today. The catch-up does not change that; it just
  never puts another seat's hand into the text it writes or stores.
- A card above the current decision on your turn. Desktop: open in full. Phone: opens collapsed to
  the headline and bullets above the docked decision, tap to expand the story. The story is placed
  *below* the bullets in space reserved for it, so nothing moves under the thumb and the decision
  controls never shift.
- Dismissable; dismissal is remembered per game and journal length (localStorage), so a reload or
  second visit this turn keeps it closed. A **Catch-up** header button reopens it for the rest of the
  turn.

## Testing

Test-first:
- `gameFacts`: table tests on saved games, including this game's position — standings, ambition race
  and `ifChapterEndedNow` matching what the real chapter-end scoring awards.
- Each heads-up: one position where it fires, one where it does not.
- Privacy: `seatFacts(state, 'red', …)` never contains another seat's hand card ids (hard test).
- `Declaration.by` set on every declare path (action card, Populist Demands).
- `GET /games/:id/catchup` without the seat token returns 403; a written story arrives as a push.
- Server pipeline with DeepSeek faked: writer → checker fail → rewrite → bullets-only; and a timeout.
  Moves are not delayed while a catch-up is being written.

Screenshot, not tests: Scoreboard dialog (desktop and phone), catch-up card, dismiss/reopen,
bullets-only state.

Live: after deploy, `npm run recap -- <game> --story` on the live game, and Brian reads his seat's
catch-up on his next turn.

## If we started over
*Spec review (accretion), Fable, 2026-10-04. Advisory.*

Clean design: the engine owns one structured fact model (scoring awards as data, declarations that
say who declared); the browser derives scoreboard and bullets like everything else; the server only
writes, stores and pushes the story, from its own gate subscriber.

- "If ended now" re-parsing scoring prose: a third parser of one log format. **Fixed in the design**
  — reuse `buildChapterReport`, moved into the engine.
- Declared-by read from the log: `Declaration` has no faction. **Fixed** — add `by`.
- Bullets over an HTTP endpoint with polling: guards nothing the journal does not already hand out,
  and the poll can miss the story. **Fixed** — bullets in the browser, story pushed on the socket.
- Catch-up inside `Notifier`: would inherit its webhook and ping guards. **Fixed** — separate
  `catchup.ts` subscriber.
- Scoreboard repeats what Players and Ambitions show. **Accept** — one glance view is what was asked.

Verdict: acceptable accretion (four fixes folded in).

## Expectations
*Spec review (Jakob's Law), Fable, 2026-10-04. Advisory.*

- Scoreboard in the phone header menu: on Android, views live in bottom tabs and the overflow menu
  holds actions; here Court/Ambitions/Players/Log are tabs. **Departs** — kept as Brian chose ("copy
  the settings"); flagged for him to confirm or make it a fifth tab.
- System Back with a dialog open leaves the game (no dialog pushes history — Settings and Rules too).
  **Unclear** — out of scope here; tracked as its own ticket for all dialogs.
- 120-word card over the map on a phone. **Fixed** — opens collapsed on phone.
- Story inserting above bullets as it arrives. **Fixed** — appended below in reserved space.
- Dismissal surviving reload. **Fixed** — remembered per game and journal length.
- "wins" for a projection. **Fixed** — "would take".

## Needs Brian

- A DeepSeek API key in Tower's arcs `.env` as `DEEPSEEK_API_KEY` (the spike borrowed opencode's
  login, which the server cannot).
- DeepSeek pricing for ~2 calls per human turn is assumed to be pennies a month — unconfirmed; check
  the DeepSeek pricing page before relying on it.
