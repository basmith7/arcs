# Scoreboard and personal catch-up — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live Scoreboard every seat can open, and a per-seat catch-up — code-picked heads-ups plus a DeepSeek-written story — when the turn reaches a human seat.

**Architecture:** The engine gains one public fact model (`gameFacts`, `seatFacts`, heads-ups) built on `buildChapterReport` (moved in from the web app) and a `by` on `Declaration`. The web app renders the Scoreboard and the catch-up bullets from that model. The server only writes the story: a `catchup.ts` gate subscriber calls DeepSeek (writer, then checker), stores the result per seat and pushes it down that seat's socket.

**Tech Stack:** TypeScript, vitest, React 18 (no jsdom — `renderToStaticMarkup`), Node `node:sqlite` store, `ws`, DeepSeek HTTP API (OpenAI-compatible `POST https://api.deepseek.com/chat/completions`).

**Spec:** `docs/superpowers/specs/2026-10-04-scoreboard-catchup-design.md`

## Global Constraints

- Hidden information: nothing built from a seat's view may contain another seat's hand. `seatFacts` reads the hand only through `observe(state, faction).hand`.
- Heads-ups state facts ("X happened / X is true"); no string in this feature says "you should", "consider", or names a move to make.
- The projection is worded "would take", never "won"/"wins".
- The catch-up never blocks or delays a move: all DeepSeek work is fire-and-forget off the gate's settled event.
- Missing `DEEPSEEK_API_KEY` → bullets only, no error logged per turn (one line at startup).
- DeepSeek call timeout 30 s; writer `deepseek-v4-pro`, checker `deepseek-v4-flash` (env `CATCHUP_WRITER_MODEL` / `CATCHUP_CHECKER_MODEL` override). If the API rejects these ids, use the ids `GET https://api.deepseek.com/models` lists for the pro and flash tiers and record them in the env defaults — do not guess.
- Story ≤ ~120 words.
- Phone: Scoreboard is the fifth bottom tab (`score`, label "Scoreboard"); desktop: a header button opening a `da-modal` dialog.
- Commit after every task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run tests from the repo root: `npm test -- <path>`; typecheck: `npm run typecheck`.

## Review Focus

1. **A seat with no previous turn** (chapter 1, first time the turn reaches it): `sinceLastTurn` returns 0 and the catch-up covers the whole game — test in Task 3.
2. **The turn reaches the same seat twice in a row** (e.g. it seized the initiative, or a multi-ask returns to it): only one story is written per (seat, hand-off) — test in Task 6 (`changed` guard).
3. **A take-back after a story was written**: the stored story is keyed by journal length, so a story for a length that no longer exists must not be served — test in Task 6.
4. **Game over**: no catch-up is written for the final state, and the game's `catchup` rows are deleted — test in Task 6.
5. **A watcher (no seat token) or hot-seat game**: no catch-up card, and the Scoreboard still works — test in Task 7 (card renders nothing without a seat faction).

---

### Task 1: `Declaration.by` and `buildChapterReport` in the engine

**Files:**
- Modify: `packages/engine/src/state.ts:46-55` (Declaration)
- Modify: `packages/engine/src/rules/ambitions.ts:317` (takeAmbitionMarker)
- Move: `apps/web/src/chapter-report.ts` → `packages/engine/src/chapter-report.ts`
- Move: `apps/web/test/chapter-report.test.ts` → `packages/engine/test/chapter-report.test.ts`
- Modify: `packages/engine/src/index.ts` (export)
- Modify: `apps/web/src/store.ts`, `apps/web/src/components/ChapterInterlude.tsx`, `apps/web/src/components/GameOverScreen.tsx` (imports)
- Test: `packages/engine/test/ambitions.test.ts`

**Interfaces:**
- Produces: `Declaration.by: FactionId`; `buildChapterReport(prev, next): ChapterReport`, `chapterEnded`, `finalChapterReport`, `buildGameHistory` and types `ChapterReport`, `AmbitionResult`, `AmbitionAward`, `GameHistory` exported from `@arcs/engine`.

- [ ] **Step 1: Failing test for `by`.** Append to `packages/engine/test/ambitions.test.ts`:

```ts
it('a declaration records who declared it', () => {
  const opts: NewGameOptions = { players: 4, seed: 1, board: 'Board4MixUp1', factions: ['red', 'yellow', 'blue', 'white'] } as NewGameOptions
  let state = createGame(opts)
  state = { ...state, ambitionable: [{ high: 5, low: 3 }] }
  const after = takeAmbitionMarker(state, 'yellow', 'Keeper')
  expect(after.declared.at(-1)).toMatchObject({ ambition: 'Keeper', by: 'yellow' })
})
```

(Import `createGame`, `takeAmbitionMarker` and `NewGameOptions` as the file's other tests do; if `takeAmbitionMarker` is not exported from `../src/index.js`, import it from `../src/rules/ambitions.js`. If `createGame` needs more options, copy the options object used at the top of this test file.)

- [ ] **Step 2:** `npm test -- packages/engine/test/ambitions.test.ts` → FAIL (`by` undefined).

- [ ] **Step 3: Implement.** In `state.ts` add to `Declaration`, after `ambition`:

```ts
  /** Who declared it. Replay regenerates state, so saved games need no migration. */
  readonly by: FactionId
```

In `rules/ambitions.ts:317` change the pushed object to `{ ambition, marker: best, round: state.round, by: faction }`. Run `npm run typecheck`; fix any test fixture that builds a `Declaration` literal by adding `by` (grep `round: ` in `packages/*/test` and `apps/web/test` for `declared:` literals).

- [ ] **Step 4:** `git mv apps/web/src/chapter-report.ts packages/engine/src/chapter-report.ts` and `git mv apps/web/test/chapter-report.test.ts packages/engine/test/chapter-report.test.ts`. `buildGameHistory` needs `startGame`/`applyExternal`, which live in the engine's `index.ts` — importing those back into an engine module is a cycle, so move `buildGameHistory` and `GameHistory` out into a new `apps/web/src/game-history.ts` (importing `buildChapterReport`, `ChapterReport` from `@arcs/engine`), and keep everything else in the engine file. Its imports become relative: `AMBITIONS` and types `Ambition`, `GameState` from `./state.js`; `FACTION_IDS`, `FactionId` from `./ids.js`; `metric` from `./rules/ambitions.js`. Add `export * from './chapter-report.js'` to `index.ts`. Point the moved test's imports at `../src/index.js`, and move its `buildGameHistory` cases (if any) to `apps/web/test/game-history.test.ts`.

- [ ] **Step 5:** Update the three web importers to import from `@arcs/engine` (and `buildGameHistory` from `./game-history.js`). `npm run typecheck && npm test` → all pass.

- [ ] **Step 6: Commit** — `git commit -am "Engine: declarations record who declared; chapter report moves into the engine"` (plus `git add` of moved/new files).

---

### Task 2: `gameFacts`

**Files:**
- Create: `packages/engine/src/facts.ts`
- Create: `packages/engine/test/fixtures/game-158107d8.json`
- Test: `packages/engine/test/facts.test.ts`
- Modify: `packages/engine/src/index.ts` (export)

**Interfaces:**
- Consumes: `buildChapterReport` (Task 1), `Declaration.by` (Task 1).
- Produces:

```ts
export interface CourtingFacts { readonly card: string; readonly suit?: Resource; readonly agents: number }
export interface FactionFacts {
  readonly faction: FactionId
  readonly power: number
  readonly cities: number
  readonly starports: number
  readonly ships: number
  readonly rules: readonly SystemId[]
  readonly resources: readonly Resource[]
  readonly court: readonly string[]          // secured court card names
  readonly handSize: number
  readonly declared: readonly Ambition[]
  readonly taxBase: Readonly<Partial<Record<Resource, number>>>
  readonly courting: readonly CourtingFacts[]
}
export interface AmbitionFacts {
  readonly ambition: Ambition
  readonly markers: readonly AmbitionMarker[]
  readonly holdings: readonly { readonly faction: FactionId; readonly value: number }[]  // all factions, best first
}
export interface GameFacts {
  readonly chapter: number
  readonly round: number
  readonly factions: readonly FactionFacts[]
  readonly ambitions: readonly AmbitionFacts[]
  /** null when nothing is declared or the game is over. */
  readonly ifChapterEndedNow: ChapterReport | null
}
export function gameFacts(state: GameState, registry: RuleRegistry): GameFacts
export function piecesIn(state: GameState, f: FactionId, system: SystemId, piece: string): number
```

- [ ] **Step 1: Fixture.** Snapshot the live game's first 71 entries (public: options + journal, no tokens):

```bash
ssh tower "sqlite3 -readonly -json /mnt/cache/appdata/arcs/arcs.db \"select options from game where id='158107d8-6b11-4c4e-937e-953e84321d10'\"" > /tmp/o.json
ssh tower "sqlite3 -readonly -json /mnt/cache/appdata/arcs/arcs.db \"select action from journal where game_id='158107d8-6b11-4c4e-937e-953e84321d10' and idx < 71 order by idx\"" > /tmp/j.json
python3 -c "import json;o=json.loads(json.load(open('/tmp/o.json'))[0]['options']);j=[r['action'] for r in json.load(open('/tmp/j.json'))];json.dump({'options':o,'journal':j},open('packages/engine/test/fixtures/game-158107d8.json','w'),indent=1)"
```

- [ ] **Step 2: Failing tests** — `packages/engine/test/facts.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultRegistry, gameFacts, replayGame } from '../src/index.js'
import type { NewGameOptions } from '../src/index.js'

const live = JSON.parse(readFileSync(new URL('./fixtures/game-158107d8.json', import.meta.url), 'utf8')) as {
  options: NewGameOptions; journal: string[]
}
const state = replayGame(live.options, live.journal, defaultRegistry()).state
const facts = gameFacts(state, defaultRegistry())
const of = (f: string) => facts.factions.find((x) => x.faction === f)!

describe('gameFacts on game 158107d8 after 71 entries', () => {
  it('reads each player from what they have done', () => {
    expect(of('red')).toMatchObject({ cities: 2, starports: 1, declared: ['Keeper'], taxBase: { Relic: 2 }, court: ['Loyal Keepers'], handSize: 4 })
    expect(of('yellow')).toMatchObject({ declared: ['Tycoon'], taxBase: { Material: 1, Fuel: 1 }, resources: ['Material', 'Psionic'] })
    expect(of('blue').courting).toEqual([{ card: 'Prison Wardens', suit: 'Weapon', agents: 2 }])
    expect(of('white').declared).toEqual([])
  })
  it('ranks the ambition race', () => {
    const keeper = facts.ambitions.find((a) => a.ambition === 'Keeper')!
    expect(keeper.markers).toEqual([{ high: 5, low: 3 }])
    expect(keeper.holdings[0]).toEqual({ faction: 'red', value: 1 })
  })
  it('projects the chapter end with the real scoring', () => {
    const awards = facts.ifChapterEndedNow!.results.flatMap((r) => r.awards.map((a) => [r.ambition, a.faction, a.place, a.power]))
    expect(awards).toEqual([['Tycoon', 'yellow', 'first', 3], ['Keeper', 'red', 'first', 5]])
  })
  it('does not move the game', () => {
    expect(state.power).toEqual({ red: 0, yellow: 0, blue: 0, white: 0 })
    expect(facts.chapter).toBe(1)
  })
})
```

(Order of `results` follows the engine's `state.ambitions` order — Tycoon before Keeper on this board; if the engine orders differently, assert as a set.)

- [ ] **Step 3:** `npm test -- packages/engine/test/facts.test.ts` → FAIL (no export).

- [ ] **Step 4: Implement** `packages/engine/src/facts.ts`:

```ts
/**
 * The public facts of a game in progress, for the Scoreboard and the turn catch-up
 * (spec 2026-10-04-scoreboard-catchup-design.md). Pure and public: hand *sizes* only.
 */
import { buildChapterReport } from './chapter-report.js'
import type { ChapterReport } from './chapter-report.js'
import { planetResource, rules } from './control.js'
import { CourtPile, courtCard, securedCards } from './court.js'
import { CardLocation, Location, parseFigureId } from './ids.js'
import type { FactionId, SystemId } from './ids.js'
import { parseResourceToken } from './resources.js'
import type { Resource } from './resources.js'
import { ScoreAmbitions, metric } from './rules/ambitions.js'
import { AMBITIONS } from './state.js'
import type { Ambition, AmbitionMarker, GameState } from './state.js'
import { contentsOf } from './tracker.js'
import { perform } from './dispatch.js'
import type { RuleRegistry } from './dispatch.js'

// ...interfaces exactly as in the Interfaces block above...

export function piecesIn(state: GameState, f: FactionId, system: SystemId, piece: string): number {
  return contentsOf(state.figures, Location.system(system)).filter((id) => {
    const p = parseFigureId(id)
    return p.color === f && p.piece === piece
  }).length
}

function factionFacts(state: GameState, f: FactionId): FactionFacts {
  const count = (piece: string): number => state.board.systems.reduce((n, s) => n + piecesIn(state, f, s, piece), 0)
  const resources = [...state.resources.contents.entries()]
    .filter(([loc]) => loc.startsWith(`cityslot:${f}:`) || loc.startsWith(`cardslot:${f}:`))
    .flatMap(([, ids]) => ids.map((id) => parseResourceToken(id).resource))
  const taxBase: Partial<Record<Resource, number>> = {}
  for (const s of state.board.systems) {
    const n = piecesIn(state, f, s, 'City')
    const r = n > 0 ? planetResource(state, s) : undefined
    if (r !== undefined) taxBase[r] = (taxBase[r] ?? 0) + n
  }
  const courting: CourtingFacts[] = []
  for (const [loc, ids] of state.figures.contents) {
    if (!loc.startsWith('court:agents:')) continue
    const agents = ids.filter((id) => parseFigureId(id).color === f).length
    const card = contentsOf(state.courtCards, CourtPile.slot(Number(loc.slice('court:agents:'.length))))[0]
    if (agents === 0 || card === undefined) continue
    const c = courtCard(card)
    courting.push({ card: c.name, ...(c.suit === undefined ? {} : { suit: c.suit }), agents })
  }
  return {
    faction: f,
    power: state.power[f] ?? 0,
    cities: count('City'),
    starports: count('Starport'),
    ships: count('Ship'),
    rules: state.board.systems.filter((s) => rules(state, f, s)),
    resources,
    court: securedCards(state, f).map((id) => courtCard(id).name),
    handSize: contentsOf(state.cards, CardLocation.hand(f)).length,
    declared: state.declared.filter((d) => d.by === f).map((d) => d.ambition),
    taxBase,
    courting,
  }
}

export function gameFacts(state: GameState, registry: RuleRegistry): GameFacts {
  const ambitions: AmbitionFacts[] = AMBITIONS.map((ambition) => ({
    ambition,
    markers: state.declared.filter((d) => d.ambition === ambition).map((d) => d.marker),
    holdings: state.factions
      .map((faction) => ({ faction, value: metric(state, faction, ambition) }))
      .sort((a, b) => b.value - a.value),
  }))
  const ifChapterEndedNow =
    state.declared.length === 0 || state.isOver
      ? null
      : buildChapterReport(state, perform(state, ScoreAmbitions(), registry).state)
  return { chapter: state.chapter, round: state.round, factions: state.factions.map((f) => factionFacts(state, f)), ambitions, ifChapterEndedNow }
}
```

Export from `index.ts`: `export * from './facts.js'`. `registry` is required (importing `defaultRegistry` from `./index.js` would be a cycle); callers pass `defaultRegistry()`.

- [ ] **Step 5:** `npm test -- packages/engine/test/facts.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit** — `git add packages/engine && git commit -m "Engine: gameFacts — the public scoreboard facts, projection by the real scoring"`

---

### Task 3: `seatFacts`, `sinceLastTurn` and the five heads-ups

**Files:**
- Create: `packages/engine/src/heads-ups.ts`
- Test: `packages/engine/test/heads-ups.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `gameFacts`, `piecesIn`, `FactionFacts` (Task 2); `observe` (existing).
- Produces:

```ts
export type HeadsUpKind = 'rival-tax-base' | 'overtake-risk' | 'outnumbered' | 'first-place' | 'hand'
export interface HeadsUp { readonly kind: HeadsUpKind; readonly text: string }
export interface SeatFacts extends GameFacts {
  readonly self: FactionId
  readonly hand: readonly string[]      // own hand only, via observe()
  readonly since: readonly string[]     // log lines since this seat's previous turn
  readonly headsUps: readonly HeadsUp[]
}
/** Journal index just after this faction's previous turn ended; 0 if it has not had one. */
export function sinceLastTurn(journal: readonly string[], faction: FactionId): number
export function seatFacts(before: GameState, now: GameState, faction: FactionId, registry: RuleRegistry): SeatFacts
```

Heads-up definitions (text uses faction ids; the UI and the server substitute player names):

1. `rival-tax-base` — for each ambition `a` that `faction` declared (`Declaration.by`), with resources `R(a)` (Tycoon: Material, Fuel; Keeper: Relic; Empath: Psionic; others: none): any rival whose `taxBase[r]` for some `r ∈ R(a)` is higher in `now` than in `before`. Text: `"${rival} can now tax ${r} — it counts toward ${a}."`
2. `overtake-risk` — for each declared ambition `a` (by anyone) with `R(a)` non-empty where `faction` strictly leads (`metric` above every rival): a rival with `metric ≥ mine − 1` who has a city on a planet of some `r ∈ R(a)` (one Tax), or has the most agents (strictly) on a court card whose suit is in `R(a)` (one Secure). Text: `"${rival} is one Tax|Secure from tying you on ${a}."` (use "overtaking" when the rival's metric equals yours − 0, i.e. the action would pass you; with `≥ mine − 1`, say "tying" when `rival = mine − 1`, "overtaking" when `rival = mine`).
3. `outnumbered` — a system where `faction` has any piece and a rival has more Ships than `faction`, and that rival either holds a Weapon in its resource slots or has a log line this chapter matching `^${rival} (led|surpassed|pivoted) with Aggression-`. Text: `"${rival} has ${n} ships to your ${m} in ${system}."`
4. `first-place` — for each declared ambition, the strict leader by `metric` in `before` vs `now`. If `faction` led before and does not now: `"You no longer lead ${a}."`; if it leads now and did not before: `"You now lead ${a}."`
5. `hand` — if hand size is 1: `"This is your last card this chapter."`; and if any `outnumbered` heads-up fired and the hand has no card starting `Aggression-`: `"You hold no Aggression card."`

`since` is `now.log.slice(before.log.length)`. Order of `headsUps`: the kinds in the order above; cap at 4.

- [ ] **Step 1: Failing tests** — `packages/engine/test/heads-ups.test.ts`. Use the live fixture: entry 59 is blue building a City on 2-Hex (a Relic world).

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FACTION_IDS, defaultRegistry, observe, replayGame, seatFacts, sinceLastTurn } from '../src/index.js'
import type { NewGameOptions } from '../src/index.js'

const live = JSON.parse(readFileSync(new URL('./fixtures/game-158107d8.json', import.meta.url), 'utf8')) as { options: NewGameOptions; journal: string[] }
const reg = defaultRegistry()
const at = (n: number) => replayGame(live.options, live.journal.slice(0, n), reg).state

describe('sinceLastTurn', () => {
  it('is just after the faction\'s previous turn', () => {
    // red's previous turn ended at entry 31 (its last chapter-1 round-1 action) — read the fixture
    // and set this to the index after red's last action before entry 45; red then acts at 66.
    const j = live.journal.slice(0, 66)
    const lastRed = j.map((e, i) => (e.includes('faction="red"') ? i : -1)).filter((i) => i >= 0).at(-1)!
    expect(sinceLastTurn(j, 'red')).toBe(lastRed + 1)
  })
  it('skips the turn in progress', () => {
    const j = live.journal.slice(0, 69) // red is mid-turn (66..68 are red's)
    expect(sinceLastTurn(j, 'red')).toBe(sinceLastTurn(live.journal.slice(0, 66), 'red'))
  })
  it('is 0 for a seat that has not had a turn', () => {
    expect(sinceLastTurn(live.journal.slice(0, 5), 'yellow')).toBe(0)
  })
})

describe('heads-ups', () => {
  const sinceRed = sinceLastTurn(live.journal.slice(0, 66), 'red')
  const facts = seatFacts(at(sinceRed), at(66), 'red', reg)

  it('rival-tax-base fires when a rival builds on your ambition\'s world', () => {
    expect(facts.headsUps).toContainEqual({ kind: 'rival-tax-base', text: 'blue can now tax Relic — it counts toward Keeper.' })
  })
  it('rival-tax-base does not fire for an ambition you did not declare', () => {
    const y = seatFacts(at(sinceLastTurn(live.journal.slice(0, 66), 'yellow')), at(66), 'yellow', reg)
    expect(y.headsUps.filter((h) => h.kind === 'rival-tax-base')).toEqual([])
  })
  it('never contains another seat\'s hand', () => {
    const text = JSON.stringify(facts)
    const state = at(66)
    for (const f of FACTION_IDS.filter((x) => x !== 'red' && state.factions.includes(x))) {
      for (const card of state.cards.contents.get(`hand:${f}`) ?? []) expect(text).not.toContain(card)
    }
    expect(facts.hand).toEqual(observe(state, 'red').hand)
  })
  it('lists the log since the last turn', () => {
    expect(facts.since[0]).toBe(at(66).log[at(sinceRed).log.length])
  })
})
```

Then add one fires / one doesn't-fire case for each of `overtake-risk`, `outnumbered`, `first-place` and `hand`, built by editing a fixture state directly (the engine's state is plain data — spread and replace trackers with `move(...)` from `tracker.ts`, `place` for figures). Concretely:
- `overtake-risk` fires: from `at(66)`, `move` a Relic token from `supply:Relic` into `cityslot:blue:1` so blue holds 1 Relic vs red's 1 (Loyal Keepers) — red no longer strictly leads, so it must NOT fire; then give red a second Relic (`cityslot:red:0`) — red leads 2–1 and blue has a city on 2-Hex → fires `"blue is one Tax from tying you on Keeper."`.
- `outnumbered` fires: `at(66)` already has white 5 ships vs red 2 in 1-Arrow; it fires only once white has a Weapon — move `Weapon#1` (from `supply:Weapon`) into `cityslot:white:0`. Doesn't fire without the Weapon (and white has no Aggression line this chapter).
- `first-place` fires: `before = at(0)`-equivalent state where nobody leads Keeper (use `at(1)`, after red declares but before the secure at entry ~6), `now = at(66)` → `"You now lead Keeper."`; doesn't fire for `before = now = at(66)`.
- `hand` fires: replace `hand:red` contents with a single card id → `"This is your last card this chapter."`; with four cards it does not.

(If an engine helper for moving resources differs from `move(tracker, entity, to)`, use the one in `tracker.ts` — `move` is exported there.)

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement** `heads-ups.ts`. `sinceLastTurn`:

```ts
const factionOf = (encoded: string): string | undefined => /faction="([a-z]+)"/.exec(encoded)?.[1]

export function sinceLastTurn(journal: readonly string[], faction: FactionId): number {
  let i = journal.length - 1
  while (i >= 0 && factionOf(journal[i]!) === faction) i-- // the turn in progress
  while (i >= 0 && factionOf(journal[i]!) !== faction) i-- // everyone else since
  return i + 1
}
```

(Prefer `decodeAction(e).faction` over the regex if `Action` exposes `faction`; the regex is the fallback because every journal entry carries `faction="…"`.)

`seatFacts` builds `gameFacts(now)` and `gameFacts(before)`, takes the hand from `observe(now, faction).hand`, computes the five checks above using `FactionFacts.taxBase`, `metric`, `piecesIn`, `CourtPile`/`Location.court(n)` for agents, and returns `{ ...gameFacts(now), self: faction, hand, since, headsUps: list.slice(0, 4) }`. Every string from the definitions above, verbatim.

- [ ] **Step 4:** run → PASS; `npm run typecheck`.

- [ ] **Step 5: Commit** — `git commit -am "Engine: seatFacts and the five heads-ups"` (add the new files).

---

### Task 4: `recap` prints from the fact model

**Files:**
- Modify: `scripts/recap.ts`

- [ ] **Step 1:** Replace the scoreboard, ambitions, "if the chapter ended now" and "what each player looks to be going for" sections with printing from `gameFacts(s, registry)` (same output lines as today; "If the chapter ended now" prints each award as `${faction} would take ${ambition} (+${power})` / `placed second` / `tied`). Add `--seat <faction>`: prints `seatFacts(before, now, faction)` headsUps and `since` count, where `before` is the replay of `journal.slice(0, sinceLastTurn(journal, faction))`. Keep `--story` and the log-by-round section as they are.

- [ ] **Step 2: Verify** — `npm run -s recap -- 158107d8-6b11-4c4e-937e-953e84321d10 --public` prints the same standings as before the change (red 2 cities, Keeper 5 to red, Tycoon 3 to yellow); `--seat red` prints heads-ups.

- [ ] **Step 3: Commit** — `git commit -am "recap prints from the engine's fact model; --seat shows heads-ups"`

---

### Task 5: Scoreboard (web)

**Files:**
- Create: `apps/web/src/components/Scoreboard.tsx` (content + `ScoreboardModal`)
- Modify: `apps/web/src/App.tsx` (header button :270-279, modal mount :427-437, phone sheet branch :313-331)
- Modify: `apps/web/src/phone.ts:31` (`Sheet` gains `'score'`), `apps/web/src/components/PhoneTabs.tsx:18-23` (fifth tab)
- Modify: `apps/web/src/styles.css` (append `.sb-` rules near `.settings-modal` :6243)
- Test: `apps/web/test/scoreboard.test.ts`

**Interfaces:**
- Consumes: `gameFacts`, `GameFacts` (Task 2); `store.seatName(f)` for names.
- Produces: `Scoreboard({ facts, name }: { facts: GameFacts; name: (f: FactionId) => string })`, `ScoreboardModal({ state, onClose })`.

- [ ] **Step 1: Failing test** — `apps/web/test/scoreboard.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { defaultRegistry, gameFacts, replayGame } from '@arcs/engine'
import type { NewGameOptions } from '@arcs/engine'
import { Scoreboard } from '../src/components/Scoreboard.js'

const live = JSON.parse(readFileSync(new URL('../../../packages/engine/test/fixtures/game-158107d8.json', import.meta.url), 'utf8')) as { options: NewGameOptions; journal: string[] }
const facts = gameFacts(replayGame(live.options, live.journal, defaultRegistry()).state, defaultRegistry())
const names: Record<string, string> = { red: 'Brian', yellow: 'Neal', blue: 'Ken', white: 'Tim' }
const html = renderToStaticMarkup(createElement(Scoreboard, { facts, name: (f: string) => names[f]! }))

it('shows the projection as a projection', () => {
  expect(html).toContain('Brian would take Keeper (+5)')
  expect(html).toContain('Neal would take Tycoon (+3)')
  expect(html).not.toMatch(/\bwins?\b/)
})
it('shows who declared what and their tax base', () => {
  expect(html).toContain('2 Relic')
  expect(html).toContain('Prison Wardens ×2')
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement** `Scoreboard.tsx`:
  - `Scoreboard`: a `<div className="sb">` with (a) a `<table className="sb-players">` — one row per `facts.factions`: name with a colour dot (reuse the faction colour CSS variable/class the log uses — grep `LogPanel.tsx` for how it colours a faction), power, `cities/starports/ships`, `rules.join(', ')`, declared (or "—"), tax base as `n Resource` joined, courting as `Card ×n`, resources, `handSize` cards; (b) `<section className="sb-race">` — per ambition with any marker or any holding > 0: `Ambition (H/L)` or `Ambition (undeclared)` then `name value` best first, zeros omitted; (c) `<p className="sb-projection">` — "If the chapter ended now: " + awards joined by " · " as `${name} would take ${ambition} (+${power})`, `${name} would place second in ${ambition} (+${power})`, `${name} would tie ${ambition} (+${power})`; omitted when `ifChapterEndedNow` is null.
  - `ScoreboardModal({ state, onClose })`: the Settings shell exactly (`useModalDrag`, Esc, backdrop, `createPortal`), class `da-modal scoreboard-modal`, title "Scoreboard", body `<Scoreboard facts={useMemo(() => gameFacts(state, registry), [state])} name={(f) => store.seatName(f) ?? f} />`.
  - `App.tsx`: `const [scoreOpen, setScoreOpen] = useState(false)`; desktop-only header button after Log: `{phone ? null : <button className="ghost" onClick={() => setScoreOpen(true)}>Scoreboard</button>}`; mount `{scoreOpen ? <ScoreboardModal state={state} onClose={() => setScoreOpen(false)} /> : null}` beside RulesModal; phone sheet branch `sheet === 'score' ? <Scoreboard facts={gameFacts(state, registry)} name={…} />` (the web app's shared `defaultRegistry()` — grep `defaultRegistry` in `apps/web/src/store.ts` for the instance it already holds) ` :` before the LogPanel default.
  - `phone.ts`: `Sheet = 'court' | 'ambitions' | 'boards' | 'log' | 'score'`; `PhoneTabs.tsx` TABS gains `['score', 'Scoreboard']`.
  - CSS: `.sb-players { width: 100%; border-collapse: collapse }`, cells padded like `.set-section`, `.sb-projection { font-weight: 600 }`; on `.app.phone` the table becomes one block per player (`display: block` rows) so it fits 360 px.

- [ ] **Step 4:** `npm test -- apps/web/test/scoreboard.test.ts` → PASS; `npm run typecheck`.

- [ ] **Step 5: Screenshot check.** `npm run serve` (or the dev server the `run` skill finds), load `saves/` or a local game, open the dialog on desktop (1280×800) and the tab on phone (390×844); save to `.agent-board/scoreboard-desktop.png` and `.agent-board/scoreboard-phone.png`. Nothing overflows; Esc and backdrop close the dialog.

- [ ] **Step 6: Commit** — `git commit -am "Scoreboard: header dialog on desktop, fifth tab on phone"` (add new files).

---

### Task 6: Catch-up writer (server)

**Files:**
- Create: `packages/server-node/src/deepseek.ts` (HTTP client)
- Create: `packages/server-node/src/catchup.ts` (subscriber, prompt, writer → checker, store glue)
- Modify: `packages/server-node/src/sqlite-store.ts` (`catchup` table in `SCHEMA` :50-77; methods)
- Modify: `packages/server-node/src/api.ts` (route next to :173-177, before :305; `Api` gains `catchup?`)
- Modify: `packages/server-node/src/main.ts` (env, wiring at :56-62)
- Modify: `docker-compose.prod.yml` (environment)
- Test: `packages/server-node/test/catchup.test.ts`, extend `packages/server-node/test/api.test.ts`

**Interfaces:**
- Consumes: `seatFacts`, `sinceLastTurn`, `SeatFacts` (Task 3); `Settled`, `askedOf` (gate.ts:44, :72); `Presence.send` (presence.ts:69); `gate.resultOf`.
- Produces:

```ts
// deepseek.ts
export type Chat = (model: string, system: string, user: string, signal: AbortSignal) => Promise<string>
export function deepseekChat(apiKey: string, fetchFn?: typeof fetch): Chat

// sqlite-store.ts
putCatchup(gameId: string, faction: string, journalLen: number, text: string, now: number): void
getCatchup(gameId: string, faction: string, journalLen: number): string | undefined
deleteCatchups(gameId: string): void
seatForToken(gameId: string, token: string): SeatRow | undefined   // public wrapper of seatByToken

// catchup.ts
export interface CatchupOptions {
  readonly chat?: Chat                       // undefined → bullets only
  readonly writerModel: string
  readonly checkerModel: string
  readonly timeoutMs?: number                // default 30_000
  readonly now?: () => number
}
export class CatchupWriter {
  constructor(store: SqliteStore, gate: EngineGate, presence: Presence, options: CatchupOptions)
  onSettled(s: Settled): void                // never throws, never awaited by the gate
  settled(gameId: string): Promise<void>     // for tests
}
export function storyPrompt(facts: SeatFacts, name: (f: string) => string): { system: string; user: string }
export function checkPrompt(facts: SeatFacts, story: string): { system: string; user: string }
// push payload sent to the seat: { catchup: { length: number; story: string } }
```

`sqlite-store` table (append to `SCHEMA`):

```sql
CREATE TABLE IF NOT EXISTS catchup (
  game_id TEXT NOT NULL,
  faction TEXT NOT NULL,
  journal_len INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, faction, journal_len)
);
```

Writer flow in `onSettled({ gameId, before, after })`:
1. If `after.state.isOver` → `store.deleteCatchups(gameId)`; return.
2. `asked = askedOf(after)`; if undefined, or `before !== null && askedOf(before) === asked` (no hand-off), return.
3. Seat = `store.seats(gameId).find(s => s.faction === asked)`; return if missing or `isBot`.
4. If no `chat` → return (bullets come from the browser).
5. Enqueue on a single promise chain (copy `EngineGate.enqueue`'s never-rejecting chain, gate.ts:335-350, but one chain for the whole server). In the job: `journal = after.state.journal`, `since = sinceLastTurn(journal, asked)`, `beforeState = replayGame(options, journal.slice(0, since)).state`, `facts = seatFacts(beforeState, after.state, asked, registry)` (the gate's registry); names from `store.seats`.
6. `story = await chat(writerModel, …storyPrompt)`; `verdict = await chat(checkerModel, …checkPrompt)`; pass = verdict starts with `PASS`. On fail, write once more and check once more; on second fail, return (no story). Each call gets `AbortSignal.timeout(timeoutMs)`; any throw → return.
7. If `gate.resultOf(gameId)?.state.journal.length !== journal.length` (someone moved or took back while writing) → return without storing.
8. `store.putCatchup(gameId, asked, journal.length, story, now())`; `presence.send(gameId, seat.seatToken, { catchup: { length: journal.length, story } })`.

`storyPrompt` system text (verbatim):

```
You narrate a game of Arcs for one player, who is the hero of the story. Root for them.
Write at most 120 words of plain markdown: one or two sentences on what happened since their
last turn, then the heads-ups given (reworded warmly, same facts), then one line cheering them on.
Use only the facts provided. Never invent moves, cards or numbers. Never tell the player what to
do, suggest a move, or say "you should"/"consider". Do not guess what any rival holds in hand.
Arcs basics: taxing a city gains its planet's resource; Relics score Keeper, Material and Fuel
score Tycoon, Psionics score Empath; a secured Guild card counts as one of its resource; Weapons
score no ambition.
```

User text: the player's name and colour, then JSON of `{ since, headsUps, standings: factions (with names), ambitions, ifChapterEndedNow, hand }` (hand labelled "your hand — private to you").

`checkPrompt` system text: `You check a short game recap against the facts it was written from. Reply PASS if every claim in it is supported by the facts and no sentence tells the player what to do. Otherwise reply FAIL: followed by the first unsupported or advising sentence.` User text: facts JSON + `---` + story.

`deepseekChat`: `POST https://api.deepseek.com/chat/completions`, headers `authorization: Bearer ${apiKey}`, `content-type: application/json`, body `{ model, messages: [{role:'system',content:system},{role:'user',content:user}], max_tokens: 400 }`; returns `choices[0].message.content`; non-2xx → throw `Error(\`deepseek ${status}\`)`.

API route in `api.ts`: `const catchupPath = /^\/games\/([^/]+)\/catchup$/.exec(path)`; GET: token from `x-seat-token`; no token or `store.seatForToken(gameId, token)` undefined → `bad(403, 'seat token does not belong to this game')`; else `length = gate.resultOf(gameId)?.state.journal.length`; `text = store.getCatchup(gameId, seat.faction, length)`; `json({ length, story: text ?? null })`.

`main.ts`: read `DEEPSEEK_API_KEY`, `CATCHUP_WRITER_MODEL` (default `deepseek-v4-pro`), `CATCHUP_CHECKER_MODEL` (default `deepseek-v4-flash`); log once `catch-up stories: on|off (no DEEPSEEK_API_KEY)`; construct `CatchupWriter` after `gate` exists — since the gate takes `onSettled` in its constructor, create the writer with a late-bound gate reference (`let gate: EngineGate`; `onSettled: (s) => { void notifier.onSettled(s); catchup.onSettled(s) }`). Pass `catchup` nowhere else; the API reads the store directly.

`docker-compose.prod.yml` environment gains `DEEPSEEK_API_KEY: "${DEEPSEEK_API_KEY:-}"`.

- [ ] **Step 1: Failing tests** — `packages/server-node/test/catchup.test.ts`, following `notify.test.ts`'s setup (`new SqliteStore(':memory:')`, `THREE_PLAYER`, `replayGame`, hand-built `Settled`). A fake `Chat` records calls and returns scripted replies. Cases:
  1. hand-off to a human seat with writer → "story", checker → "PASS": one row stored at `after.state.journal.length`, one `presence.send` with `{ catchup: { length, story: 'story' } }` (fake `Presence` capturing `send`).
  2. checker FAIL then PASS on the rewrite: writer called twice, story stored is the second.
  3. checker FAIL twice: nothing stored, nothing sent.
  4. chat throws (simulated timeout): nothing stored; `onSettled` did not throw.
  5. no hand-off (`askedOf(before) === askedOf(after)`): chat never called.
  6. bot seat asked (`ONE_HUMAN` fixture, settle to a bot's ask): chat never called.
  7. `chat` undefined: nothing called, nothing stored.
  8. journal moved on while writing (fake gate `resultOf` returns a longer journal): nothing stored.
  9. `after.state.isOver`: existing rows for the game deleted.
  10. `onSettled` returns synchronously while chat is still pending (prove with a never-resolving chat: `onSettled` returns and a following assertion runs) — the "moves never delayed" check.
  In `api.test.ts`: `GET /games/:id/catchup` with no token → 403; wrong token → 403; right token with a stored row → `{ length, story }`; right token, row stored for an older length → `story: null`.

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4:** `npm test -- packages/server-node` → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -am "Server: catch-up stories written by DeepSeek on hand-off, checked, stored per seat and pushed"` (add new files).

---

### Task 7: Catch-up card (web)

**Files:**
- Create: `apps/web/src/components/CatchUp.tsx`
- Modify: `apps/web/src/multiplayer/session.ts` (`applyPush` :248-286, `SessionHost` :52-62), `apps/web/src/multiplayer/client.ts` (a `catchup(gameId, seatToken)` GET), `apps/web/src/store.ts` (hold the latest story; `joinSession` wiring :483-503)
- Modify: `apps/web/src/settings.ts` (dismissal) — or a separate localStorage key, see Step 3
- Modify: `apps/web/src/App.tsx` (card above `.hand-row` :355; header "Catch-up" button)
- Modify: `apps/web/src/styles.css`, `apps/web/src/phone.css`
- Test: `apps/web/test/catchup.test.ts`, extend `apps/web/test/push.test.ts`

**Interfaces:**
- Consumes: `seatFacts`, `sinceLastTurn`, `HeadsUp` (Task 3); push `{ catchup: { length, story } }` and `GET /games/:id/catchup → { length, story | null }` (Task 6).
- Produces: `CatchUp({ headsUps, story, name, collapsed, onDismiss })`; `store.catchupStory(length): string | null`; `catchupDismissed(gameId, length): boolean`, `dismissCatchup(gameId, length)`.

- [ ] **Step 1: Failing tests.**
  - `catchup.test.ts`: render `CatchUp` with two heads-ups and `story: null` → contains both heads-up texts with names substituted (`blue` → `Ken`), no story block; with `story: 'Ken built…'` → story appears *after* the bullets in the markup (assert `html.indexOf(story) > html.indexOf(lastBullet)`); `collapsed: true` → story hidden behind a "More" toggle (`<details>`). Dismissal: with a fake localStorage, `dismissCatchup('g', 71)` then `catchupDismissed('g', 71)` true, `catchupDismissed('g', 72)` false. A watcher/hot-seat: the App-level guard renders nothing when `seatView.kind !== 'seat'` — test the small pure helper `shouldShowCatchup(seatView, cont)` (seat + `cont.kind === 'ask'` + `cont.faction === seatView.faction`).
  - `push.test.ts`: a `{ catchup: { length: 71, story: 's' } }` push reaches the new `SessionHost.catchup` hook (copy the `pushTurn` fake-socket pattern, :56-57).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
  - `session.ts`: in `applyPush`, before the `{turn}` branch: `if (msg.catchup !== undefined) { this.host.catchup?.(msg.catchup); return }`; `SessionHost.catchup?: (c: { length: number; story: string }) => void`. On join and on `resync`, call the new `client.catchup(gameId, seatToken)` once and feed a non-null story to the same hook.
  - `store.ts`: keep `private catchup: { length: number; story: string } | null`; hook sets it and notifies subscribers; `catchupStory(length)` returns the story only when lengths match (so a take-back never shows a stale story).
  - Dismissal: its own localStorage key `arcs:catchup-dismissed` holding `{ [gameId]: length }` (one entry per game, overwritten) — not in `Settings`, which is user preferences.
  - `CatchUp.tsx`: `<aside className="cu-card">` with a close ✕ (`onDismiss`), `<ul>` of heads-ups (faction ids in text replaced by `name(f)` with a word-boundary regex over the game's factions), then the story block: `collapsed ? <details><summary>More</summary>{story}</details> : <p>{story}</p>`; while `story` is null and a key is configured, reserve the block's height with an empty `.cu-story-slot` (min-height 3 lines) so nothing shifts when it arrives — when the server says stories are off there is no slot (the GET returning `story: null` *and* no push within 60 s → drop the slot).
  - `App.tsx`: compute `const mine = shouldShowCatchup(seatView, engineCont)`; when true and not dismissed, compute `facts = useMemo(() => seatFacts(replay(journal.slice(0, sinceLastTurn(journal, f))), state, f), [journal.length])` (replay via the store's options + `replayGame`) and render `<CatchUp …/>` immediately before `.hand-row` (desktop: give it its own grid row in `.board-col` — add `catchup` to `grid-template-areas` above `hand`; phone: it sits between `.board-cell` and the dock, `collapsed` true). A header "Catch-up" button (shown only when `mine` and dismissed) clears the dismissal for this length.
- [ ] **Step 4:** `npm test -- apps/web` → PASS; `npm run typecheck`.
- [ ] **Step 5: Screenshot check** with a local server and a seat link on your turn: desktop card, phone collapsed card, bullets-only (no key locally), dismissed + reopen. Save to `.agent-board/catchup-*.png`.
- [ ] **Step 6: Commit** — `git commit -am "Catch-up card: heads-ups at once, story when pushed, dismissal remembered"` (add new files).

---

### Task 8: Whole-branch check and hand-off

- [ ] `npm run typecheck && npm test` — all green; paste the summary line.
- [ ] `npm run -s recap -- 158107d8-6b11-4c4e-937e-953e84321d10 --seat red` against the live game.
- [ ] Code review of the branch (requesting-code-review), fix findings, commit.
- [ ] Tick the ticket's Done-when items that are now true (`check_done`); tell Brian it's ready for Build it. After Build it: `merge_ticket`; if the merge doesn't ship it, release per AGENTS.md (tag `vX.Y.Z`, `scripts/deploy-now.sh`), add `DEEPSEEK_API_KEY` to Tower's compose `environment` (Tower copy of the compose file, mirroring the repo), update AGENTS.md's current-release line, then verify live: Scoreboard on arcs.basmith.net, and Brian's catch-up on his next turn.
