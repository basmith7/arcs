# Stronger Bot and Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bot evaluator cheap, measure every idea with a pre-registered 4-player paired gate, build a rollout advisor behind an offline power test, and fold whichever evaluator features pass into `hard`.

**Architecture:** Engine stays pure and deterministic (`packages/engine`, zero runtime deps). Speed work is behaviour-preserving and checked against a committed golden-journal fixture. Rollouts live in a new `playoutFrom` capability in `ai/play.ts`, driven from `scripts/` with `worker_threads`. Evaluator features follow the frozen-baseline convention: weight 0 in `WEIGHTS`, enabled only in a candidate `HARD_WEIGHTS`.

**Tech Stack:** TypeScript (ESM), vitest, vite-node for scripts, Node 22 `worker_threads`, sqlite3 CLI over ssh (advisor source only).

**Spec:** `docs/superpowers/specs/2026-09-23-stronger-bot-design.md` (rev 3, Fable-reviewed, ship-spec).

## Global Constraints

- Base game only for every measurement; Leaders & Lore and campaign must still run (existing suite).
- Engine: no runtime dependencies, no clock, no `Math.random`, no network; all randomness from the seeded state RNG / journal-derived `probeFrom`.
- `normal` (`mobileBot`) and `easy` must stay byte-identical — asserted by the golden fixture.
- Gate: 4p, challenger 2 seats vs control 2 seats, seats rotated; pass = z ≥ 2.5 on per-game win-share difference and power difference not below z = −2. Only a 4p pass ships. Family ≤ 7 tests.
- Twin runs are sanity checks (|z| < 2), never thresholds. Every gate records its MDE; a miss below MDE is "not detected".
- B2 kill switch: selection z ≥ 1.0 on 32 `normal` salts; evaluation on 32 held-out salts under all-`hard`; pass = held-out net gain z ≥ 2; early stop after 150 decisions if gain < +0.5% with se < 2%.
- Advisor never writes to the prod DB (`sqlite3 -readonly`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Record every measurement (pass, null, not detected) in `docs/19-ai-implementation-plan.md` — a new numbered section plus a row in section 0's register.

## Review Focus

1. **Speedup silently changes a tie-break** (float reassociation, iteration order, a cache returning a stale value for a different faction) → golden `--check` must diff journals, not just winners. Pinned in Task 1/2.
2. **A cache keyed on `ObservedState` that is reused across factions or mutated states** → cache keys include faction; test that two factions' metrics from one observation differ as before. Task 2.
3. **Advisor run on a finished game, a game whose journal fails to replay, or when it is someone else's turn** → exit 0 with a clear message, no stack trace. Task 7.
4. **Rollout reads a rival's true hand** → two states differing only in a rival's hidden hand give identical `playoutFrom` results. Task 5.
5. **`moveToward` changes Move-vs-other choices** → its terms sum to zero across a Move ask's destination candidates; non-move candidates get 0. Task 9.

---

### Task 1: Golden-journal fixture (before any optimisation)

**Files:**
- Create: `scripts/golden-journals.ts`
- Create: `packages/engine/test/fixtures/golden-journals.json` (generated)
- Create: `packages/engine/test/golden-journals.test.ts`
- Modify: `package.json` (scripts: `"golden": "vite-node scripts/golden-journals.ts"`)

**Interfaces:**
- Produces: fixture shape `{ games: Array<{ name: string; options: NewGameOptions; level: 'normal'|'hard'; journal: string[]; power: Record<string, number> }> }`.

- [ ] **Step 1: Write the generator/checker**

```ts
// scripts/golden-journals.ts
/**
 * Golden journals: the speed work must not change a single decision.
 *
 *   npm run golden -- --write   # record (only on a commit whose bots are the reference)
 *   npm run golden              # re-play every game and diff journals + power
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { botForLevel, defaultRegistry, runBots, startGame } from '@arcs/engine'
import type { FactionId, NewGameOptions } from '@arcs/engine'

const PATH = 'packages/engine/test/fixtures/golden-journals.json'
type Level = 'normal' | 'hard'
interface Golden { name: string; options: NewGameOptions; level: Level; journal: string[]; power: Record<string, number> }

const F4: FactionId[] = ['red', 'yellow', 'blue', 'white']
const F2: FactionId[] = ['red', 'yellow']
const plan: Array<{ name: string; options: NewGameOptions; level: Level }> = []
for (let i = 0; i < 10; i++) plan.push({ name: `n2-${i}`, level: 'normal', options: { board: 'Board2Frontiers', factions: F2, seed: 9000 + i, bots: F2 } })
for (let i = 0; i < 10; i++) plan.push({ name: `n4-${i}`, level: 'normal', options: { board: 'Board4MixUp1', factions: F4, seed: 9100 + i, bots: F4 } })
for (let i = 0; i < 3; i++) plan.push({ name: `h2-${i}`, level: 'hard', options: { board: 'Board2Frontiers', factions: F2, seed: 9200 + i, bots: F2 } })
for (let i = 0; i < 3; i++) plan.push({ name: `h4-${i}`, level: 'hard', options: { board: 'Board4MixUp1', factions: F4, seed: 9300 + i, bots: F4 } })

export function play(p: { options: NewGameOptions; level: Level }): { journal: string[]; power: Record<string, number> } {
  const reg = defaultRegistry()
  const out = runBots(startGame(p.options, reg), p.options.factions, botForLevel(p.level), reg, 50_000)
  return { journal: [...out.result.state.journal], power: { ...out.result.state.power } as Record<string, number> }
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
if (process.argv.includes('--write')) {
  const games: Golden[] = plan.map((p) => { const r = play(p); console.log(p.name, r.journal.length); return { ...p, ...r } })
  writeFileSync(PATH, JSON.stringify({ games }, null, 1) + '\n')
} else {
  const { games } = JSON.parse(readFileSync(PATH, 'utf8')) as { games: Golden[] }
  let bad = 0
  for (const g of games) {
    if (only !== undefined && !g.name.startsWith(only)) continue
    const t = Date.now()
    const r = play(g)
    const i = r.journal.findIndex((e, k) => e !== g.journal[k])
    const same = i === -1 && r.journal.length === g.journal.length && JSON.stringify(r.power) === JSON.stringify(g.power)
    if (!same) bad++
    console.log(`${same ? 'ok  ' : 'DIFF'} ${g.name} ${Date.now() - t}ms${same ? '' : ` first diff at ${i}`}`)
  }
  process.exit(bad === 0 ? 0 : 1)
}
```

Check `runBots`'s real signature in `packages/engine/src/ai/play.ts:841` before running; adapt the call (arguments are `result, factions, seats, registry, stuckAfter`) if it differs.

- [ ] **Step 2: Record the fixture on the current (reference) commit**

Run: `npm run golden -- --write` (backgrounded; ~40 min pre-speedup, dominated by the 4p `hard` games)
Expected: 26 lines `name length`, fixture file written.

- [ ] **Step 3: Write the fast test**

```ts
// packages/engine/test/golden-journals.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { botForLevel, defaultRegistry, runBots, startGame } from '../src/index.js'
import type { NewGameOptions } from '../src/index.js'

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/golden-journals.json', import.meta.url), 'utf8'),
) as { games: Array<{ name: string; options: NewGameOptions; level: 'normal' | 'hard'; journal: string[] }> }

describe('golden journals', () => {
  // Three short 2p normal games: the full 26-game check is `npm run golden`.
  for (const g of fixture.games.filter((x) => x.name.startsWith('n2-')).slice(0, 3)) {
    it(`${g.name} replays decision for decision`, () => {
      const reg = defaultRegistry()
      const out = runBots(startGame(g.options, reg), g.options.factions, botForLevel(g.level), reg, 50_000)
      expect(out.result.state.journal).toEqual(g.journal)
    }, 120_000)
  }
})
```

- [ ] **Step 4: Run test + full check**

Run: `npx vitest run packages/engine/test/golden-journals.test.ts` → PASS. `npm run golden -- --only=n2` → all `ok`.

- [ ] **Step 5: Commit** — `git add scripts/golden-journals.ts packages/engine/test/fixtures packages/engine/test/golden-journals.test.ts package.json && git commit -m "Golden journals: pin every bot decision before the speed work"`

---

### Task 2: Make the evaluator cheap

**Files:**
- Create: `scripts/profile-game.ts`
- Modify: `packages/engine/src/ids.ts:59-66` (`parseFigureId`)
- Modify: hot spots the profile names — expected `packages/engine/src/rules/ambitions.ts` (`metric`, `rivalHoldings`), `packages/engine/src/control.ts` (`slotsOf`, `citiesInReserve`), `packages/engine/src/ai/value.ts` (`featuresOf`, `pieces`)
- Test: `packages/engine/test/perf-caches.test.ts`

**Interfaces:**
- Produces: `parseFigureId` unchanged signature, now memoised. Any new cache is private to its module.

- [ ] **Step 1: Profile script**

```ts
// scripts/profile-game.ts — time one seeded game; run under `node --cpu-prof` via vite-node for a profile.
import { botForLevel, playGame } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'
const players = Number(process.argv[2] ?? 4)
const level = (process.argv[3] ?? 'normal') as 'normal' | 'hard'
const factions = (['red', 'yellow', 'blue', 'white'] as FactionId[]).slice(0, players)
const t = Date.now()
const o = playGame({ seats: botForLevel(level), seed: 201, factions, board: players === 4 ? 'Board4MixUp1' : 'Board2Frontiers' })
console.log(`${players}p ${level}: ${Date.now() - t} ms, ${o.actions} decisions, ${((Date.now() - t) / o.actions).toFixed(1)} ms/decision`)
```

Run: `npx vite-node scripts/profile-game.ts 4 normal` → baseline (expect ~105 s).

- [ ] **Step 2: Failing test for memo semantics**

```ts
// packages/engine/test/perf-caches.test.ts
import { describe, expect, it } from 'vitest'
import { parseFigureId } from '../src/ids.js'

describe('parseFigureId memo', () => {
  it('returns equal, frozen results and still rejects malformed ids', () => {
    const a = parseFigureId('red/Ship/3')
    expect(a).toEqual({ color: 'red', piece: 'Ship', index: 3 })
    expect(parseFigureId('red/Ship/3')).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
    expect(() => parseFigureId('red/Ship')).toThrow(/malformed/)
  })
})
```

Run: `npx vitest run packages/engine/test/perf-caches.test.ts` → FAIL (`toBe` / frozen).

- [ ] **Step 3: Memoise**

```ts
const PARSED = new Map<FigureId, Readonly<{ color: ColorId; piece: Piece; index: number }>>()

export function parseFigureId(id: FigureId): Readonly<{ color: ColorId; piece: Piece; index: number }> {
  const hit = PARSED.get(id)
  if (hit !== undefined) return hit
  const parts = id.split('/')
  const [color, piece, index] = parts
  if (parts.length !== 3 || color === undefined || piece === undefined || index === undefined) {
    throw new Error(`malformed figure id: ${id}`)
  }
  const parsed = Object.freeze({ color: color as ColorId, piece: piece as Piece, index: Number(index) })
  PARSED.set(id, parsed)
  return parsed
}
```

Run `npx tsc -p packages/engine --noEmit`; fix any caller that mutated the result (none expected).

- [ ] **Step 4: Test + golden + re-profile**

`npx vitest run packages/engine/test/perf-caches.test.ts` → PASS; `npm run golden -- --only=n` → all ok; profile again, record ms/decision.

- [ ] **Step 5: Commit** — "Memoise parseFigureId: 44% of a normal game was re-splitting figure ids"

- [ ] **Step 6: Per-observation caches, one hot spot at a time.** For each function the new profile shows above ~10% inclusive that is a pure function of `(view, faction[, ambition])`, wrap it:

```ts
// pattern — in the function's own module
const CACHE = new WeakMap<object, Map<string, number>>()
export function metric(view: MetricView, faction: FactionId, ambition: Ambition): number {
  let m = CACHE.get(view)
  if (m === undefined) CACHE.set(view, (m = new Map()))
  const key = `${faction}|${ambition}`
  const hit = m.get(key)
  if (hit !== undefined) return hit
  const v = metricUncached(view, faction, ambition)
  m.set(key, v)
  return v
}
```

Key on the object that is immutable for the computation (the `ObservedState` or the `GameState`; confirm the function reads nothing that changes without a new object — `Tracker` updates always return new objects, `tracker.ts:55-98`). Add a test per cache to `perf-caches.test.ts`: two factions from one observation give the same values as the uncached function.

- [ ] **Step 7: After each cache** — test, `npm run golden -- --only=n`, re-profile, commit. Stop when a 4p normal game is ≥ 3x faster than baseline or the top remaining hot spot is < 10%.

- [ ] **Step 8: Full golden + suite** — `npm run golden` (all 26) and `npm test` → all pass. Commit.

---

### Task 3: Record the speedup

**Files:** Modify `docs/19-ai-implementation-plan.md` (section 0 "Supporting numbers" and a new section `## 21. The evaluator was the cost`).

- [ ] **Step 1:** Write the before/after table (4p normal ms/decision, 2p hard ms/game, profile top-5 before/after) and correct the "~4ms" line with a pointer to section 21.
- [ ] **Step 2: Commit** — "docs/19 §21: the evaluator was the cost"

---

### Task 4: Paired gate statistic and arena outcome log

**Files:**
- Modify: `packages/engine/src/ai/arena.ts` (add `pairedGate`)
- Modify: `scripts/arena.ts` (add `--out <file.jsonl>`, `--gate <challengerId>,<controlId>`)
- Test: `packages/engine/test/arena-gate.test.ts`

**Interfaces:**
- Produces: `export interface GateResult { games: number; winDiff: number; winSe: number; winZ: number; powerDiff: number; powerSe: number; powerZ: number; pass: boolean }` and `export function pairedGate(outcomes: readonly GameOutcome[], challenger: string, control: string, zPass = 2.5): GateResult`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import { pairedGate } from '../src/ai/arena.js'
import type { GameOutcome } from '../src/ai/arena.js'

const game = (winnerBot: 'A' | 'B', pa: number, pb: number): GameOutcome => ({
  seed: 1, finished: true, reason: '', tied: false, chapters: 5, actions: 1, ms: 1,
  seats: { red: 'A', yellow: 'B', blue: 'A', white: 'B' },
  winner: winnerBot === 'A' ? 'red' : 'yellow',
  power: { red: pa, yellow: pb, blue: pa, white: pb },
})

describe('pairedGate', () => {
  it('scores win share per side per game and passes only past z', () => {
    const many = [...Array(60)].map((_, i) => game(i % 3 === 0 ? 'B' : 'A', 20, 15))
    const r = pairedGate(many, 'A', 'B')
    expect(r.games).toBe(60)
    expect(r.winDiff).toBeCloseTo(2 / 3 - 1 / 3, 5)
    expect(r.pass).toBe(true)
    const even = [...Array(60)].map((_, i) => game(i % 2 === 0 ? 'B' : 'A', 15, 15))
    expect(pairedGate(even, 'A', 'B').pass).toBe(false)
  })
  it('ignores unfinished games', () => {
    const g = { ...game('A', 1, 1), finished: false }
    expect(pairedGate([g], 'A', 'B').games).toBe(0)
  })
})
```

- [ ] **Step 2:** Run → FAIL (no export).

- [ ] **Step 3: Implement**

```ts
export interface GateResult { games: number; winDiff: number; winSe: number; winZ: number; powerDiff: number; powerSe: number; powerZ: number; pass: boolean }

/**
 * The pre-registered gate (spec rev 3, section A2): per game, the challenger side's win share minus
 * the control side's, and the same for mean power per seat. The game is the unit; z is mean / se.
 */
export function pairedGate(outcomes: readonly GameOutcome[], challenger: string, control: string, zPass = 2.5): GateResult {
  const wins: number[] = []
  const power: number[] = []
  for (const o of outcomes) {
    if (!o.finished) continue
    const seats = Object.entries(o.seats) as [FactionId, string][]
    const side = (id: string): FactionId[] => seats.filter(([, b]) => b === id).map(([f]) => f)
    const c = side(challenger), k = side(control)
    if (c.length === 0 || k.length === 0) continue
    const w = o.winner
    wins.push((w !== undefined && c.includes(w) ? 1 : 0) - (w !== undefined && k.includes(w) ? 1 : 0))
    const mean = (fs: FactionId[]): number => fs.reduce((n, f) => n + (o.power[f] ?? 0), 0) / fs.length
    power.push(mean(c) - mean(k))
  }
  const stat = (xs: number[]): [number, number] => {
    const n = xs.length
    if (n < 2) return [0, Infinity]
    const m = xs.reduce((a, b) => a + b, 0) / n
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)
    return [m, Math.sqrt(v / n)]
  }
  const [winDiff, winSe] = stat(wins)
  const [powerDiff, powerSe] = stat(power)
  const winZ = winSe === 0 ? 0 : winDiff / winSe
  const powerZ = powerSe === 0 ? 0 : powerDiff / powerSe
  return { games: wins.length, winDiff, winSe, winZ, powerDiff, powerSe, powerZ, pass: winZ >= zPass && powerZ >= -2 }
}
```

- [ ] **Step 4:** In `scripts/arena.ts`, after the report: if `--out` given, write one JSON line per outcome; if `--gate a,b` given, print `pairedGate(outcomes, a, b)` formatted (`win Δ x ± se (z) | power Δ … | PASS/FAIL | MDE(+3pts)=…`). Test PASS; `npm run arena -- --seats mobile,mobile --games 4 --gate mobile,mobile` sanity run.

- [ ] **Step 5: Commit** — "Arena: the pre-registered paired gate and an outcome log"

---

### Task 5: 4p `hard` twin run (sanity + cost)

- [ ] **Step 1:** `npm run arena -- --seats hard,hard,hard,hard --games 200 --jobs 14 --noise --out runs/twin-hard-4p.jsonl` (bot spec: add a `hard` kind to `scripts/bot-spec.ts` that returns `botForLevel('hard')`, with a test in `bot-spec` style if one exists; `runs/` is gitignored — add it).
- [ ] **Step 2:** Record: per-game cost, twin z (must be |z| < 2), and the games affordable in 24 h on 14 jobs ⇒ MDE per gate. Write into docs/19 §21. Commit.

---

### Task 6: `playoutFrom` and the oracle harness

**Files:**
- Modify: `packages/engine/src/ai/play.ts` (export `playoutFrom`, reuse `dealRivals`, `probeFrom`)
- Create: `scripts/oracle.ts`, `scripts/oracle-worker.ts`
- Test: `packages/engine/test/playout-from.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PlayoutResult { readonly winner: FactionId | undefined; readonly tied: boolean; readonly power: Readonly<Partial<Record<FactionId, number>>>; readonly finished: boolean; readonly observed: ObservedState }
export function playoutFrom(result: RuleResult, self: FactionId, first: Action | undefined, opts: { policy: Bot; horizon: 'chapter' | 'game'; salt: number; maxSteps?: number }, registry?: RuleRegistry): PlayoutResult
```
  `first` is the candidate applied after the redeal (undefined = play from the position as is).
- `scripts/oracle.ts` exports `evaluate(job: { options: NewGameOptions; journal: string[]; self: FactionId; candidates: string[] /* encoded */; salts: number[]; policy: 'normal'|'hard'; horizon: 'chapter'|'game' }, cores: number): Promise<number[][]>` → `[candidate][salt]` = 1 if `winner === self` else 0 (tie-break wins count), plus power margins in a parallel array.

- [ ] **Step 1: Failing tests** — (a) determinism: same inputs ⇒ identical `PlayoutResult.power`; (b) no-cheat: build two states from one game that differ only by swapping one card between a rival hand and the deck (copy the technique in `foresee.test.ts:117`), assert identical results for the same salt; (c) `horizon: 'chapter'` stops when `state.chapter` changes; (d) a finished game returns immediately with `finished: true`.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** in `play.ts`:

```ts
export function playoutFrom(result: RuleResult, self: FactionId, first: Action | undefined,
  opts: { policy: Bot; horizon: 'chapter' | 'game'; salt: number; maxSteps?: number },
  registry?: RuleRegistry): PlayoutResult {
  const reg = registry ?? defaultRegistry()
  const cap = opts.maxSteps ?? 2000
  let at: RuleResult = { ...result, state: dealRivals(probeFrom(result.state, 8000 + opts.salt), self) }
  if (first !== undefined) at = advance(at.state, first, reg)
  const chapter = at.state.chapter
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < cap; i++) {
    const c = at.continue
    if (c.kind !== 'ask') break
    if (opts.horizon === 'chapter' && at.state.chapter !== chapter) break
    const step = stepBot(at, opts.policy, c.faction, reg, asked)
    at = step.result
    asked = step.asked
  }
  const s = at.state
  const top = Math.max(...s.factions.map((f) => s.power[f] ?? 0))
  return {
    winner: s.isOver ? s.winners[0] : undefined,
    tied: s.isOver && s.factions.filter((f) => (s.power[f] ?? 0) === top).length > 1,
    power: s.power, finished: s.isOver, observed: observe(s, self),
  }
}
```

Note `stepBot` uses `applyExternal`, which grows the journal; that is fine here (the playout is thrown away) but check it does not dominate cost — if it does, add an internal `stepBotUnrecorded` that calls `advance`. Test PASS.

- [ ] **Step 4: Worker fan-out.** `oracle-worker.ts` receives `{ options, journal, self, candidate, salt, policy, horizon }` batches, replays with `replayGame`, runs `playoutFrom(result, self, decodeAction(candidate), …)`, posts back `{ win, margin }`. `oracle.ts` splits jobs round-robin over `cores` workers and reassembles by index (so results do not depend on core count). Smoke: evaluate 2 candidates × 4 salts on a 2p position with `--cores 1` and `--cores 4`; results identical.

- [ ] **Step 5: Commit** — "playoutFrom and the oracle harness: game-horizon rollouts across cores"

---

### Task 7: The advisor CLI (hard-only mode first)

**Files:**
- Create: `scripts/advise.ts`
- Modify: `package.json` (`"advise": "vite-node scripts/advise.ts"`)

- [ ] **Step 1:** Implement: parse `<gameId|path.json> <faction> [--cores N] [--oracle]`. Load source: a path ending `.json` → `loadGame`; otherwise `ssh tower "sqlite3 -readonly -json /mnt/cache/appdata/arcs/arcs.db \"select options from game where id='ID'; …\""` for options and `select action from journal where game_id=? order by idx`. Validate `gameId` against `/^[0-9a-f-]{36}$/` before interpolating. Replay with `replayGame`; if the replay throws, print `journal failed to replay at entry N: <message>` and exit 1; if `state.isOver`, print winners and exit 0; if the ask is not `faction`'s, print `waiting on <faction> (<prompt>)` and exit 0.
- [ ] **Step 2:** Card play: run `botForLevel('hard').decide` via `stepBot`, print each `considered` entry as `label  score  [tier-1|reply-checked]` (reply-checked = note contains "after replies"); then loop `stepBot` with `hard` while the ask stays with `faction` and the turn key is unchanged, printing `- label | because`.
- [ ] **Step 3:** With `--oracle` (enabled only after Task 8 passes): take the top 3 tier-1 roots plus hard's pick, `evaluate(... salts 0..31, policy normal, horizon game)`, apply the B2 selection rule (paired z ≥ 1.0 vs hard's pick), print each candidate's win share ± se, and mark a displacement. Without a B2 pass, `--oracle` prints "rollout check: not detected to help (docs/19 §N)" and runs hard-only.
- [ ] **Step 4:** Run it on the live game: `npm run advise -- 158107d8-6b11-4c4e-937e-953e84321d10 red` → matches the earlier manual analysis (Lead Mobilization-7 …) or explains the difference (journal may have advanced).
- [ ] **Step 5: Commit** — "npm run advise: hard's analysis of a live seat"

---

### Task 8: B2 offline power test

**Files:** Create `scripts/b2-power.ts`; outputs `runs/b2/*.jsonl`.

- [ ] **Step 1: Corpus.** Play ≥ 40 4p `hard` self-play games (arena seeds 50_000+), recording at each card play: journal index, faction, `considered` tier-1 values. Keep decisions whose top-two tier-1 margin is below the corpus median; sample ≤ 10 per game, ≥ 400 total. Save `runs/b2/corpus.jsonl`.
- [ ] **Step 2: Selection** for each decision: candidates = top 3 by tier-1 + hard's pick; `evaluate(salts 0..31, policy normal, horizon game)`; paired diff of each challenger vs hard's pick, z; rule pick = best challenger if z ≥ 1.0 else hard's pick. Log to `runs/b2/selection.jsonl`.
- [ ] **Step 3: Evaluation** for displaced decisions only (non-displaced contribute 0): `evaluate([hardPick, rulePick], salts 1000..1031, policy hard, horizon game)`; held-out diff. Log.
- [ ] **Step 4: Report** (script prints): displacement rate, false-flip rate, net gain per decision over all decisions with game-clustered se, z; secondary estimators descriptive. Early stop after 150 decisions if gain < +0.005 and se < 0.02.
- [ ] **Step 5:** Record in docs/19 new section + register row; enable `--oracle` in the advisor iff z ≥ 2. Commit.

---

### Task 9: C1 `moveToward` (zero-sum among Move destinations)

**Files:**
- Create: `packages/engine/src/ai/move-target.ts`
- Modify: `packages/engine/src/ai/value.ts` (add `'moveToward'` to `FEATURES`, weight 0 in `WEIGHTS`)
- Modify: `packages/engine/src/ai/heuristic.ts` (apply after scoring candidates)
- Test: `packages/engine/test/move-target.test.ts`

**Interfaces:**
- Produces: `export function gateDistances(board: BoardVariant): ReadonlyMap<SystemId, ReadonlyMap<SystemId, number>>` (BFS over `connected`, memoised per board name); `export function intentTargets(observed: ObservedState, self: FactionId, intent: ChapterIntent): readonly { system: SystemId; pull: number }[]`; `export function moveTowardTerms(observed, self, intent, actions: readonly Action[]): ReadonlyMap<Action, number>` — for `action/move-pick` candidates, `pull × (d(from,t) − d(to,t))` for the nearest target t, then minus the mean over those candidates; non-move actions absent from the map.

- [ ] **Step 1: Failing tests**: BFS distance symmetric and 0 on the diagonal on `Board4MixUp1`; `moveTowardTerms` sums to 0 (±1e-9) on a real Move ask taken from a seeded game; non-move actions get no entry; with a Keeper intent and one unruled Relic planet two gates away, the destination one gate closer scores highest.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Targets: for each ambition with `intent.pursuing.get(a) ≥ 0.5`: Tycoon → systems whose `planetResource` is Material/Fuel with no city of `self`; Keeper → Relic; Empath → Psionic; Tyrant/Warlord → systems holding a rival City/Starport. Pull = pursuit strength. No ambition above 0.5 → planets of a resource `self` holds none of, pull 0.5. In `heuristic.ts`, after the candidate loop: if `weights.moveToward !== 0`, compute terms once and add `weights.moveToward * term` to each move-pick's `score` before choosing. Test PASS; golden `--only=n` still ok (weight 0 in shipped sets).
- [ ] **Step 4: Probe games** (100 4p, `hard` + candidate weight 0.5 and 1.0 vs `hard`): reversals 0, unfinished 0, Move share of pips within 2 points of control. Pick C1a/C1b from the passing weights (if neither passes the probe, record and skip the arena).
- [ ] **Step 5: Gate** each in the arena (4p, `--gate`), sized from Task 5. Record. Commit.

---

### Task 10: Coverage report

**Files:**
- Modify: `packages/engine/src/ai/play.ts` (`runBots` optional `onDecision?: (ask: Ask, taken: Action) => void`) and `arena.ts` passthrough
- Create: `scripts/coverage.ts`

- [ ] **Step 1:** Test that `onDecision` is called once per bot decision with the offered actions and the taken one, and that omitting it leaves outcomes identical (golden `--only=n2`).
- [ ] **Step 2:** `coverage.ts`: 200 4p `hard` games (jobs 14); tally per `action.type` offered/taken; for guild abilities, tally by the card id present in the action (inspect the Prelude ability action shape in `prelude.ts` / `guild-actions.ts` and key on its card field). Print both tables.
- [ ] **Step 3:** Record offered-but-never-taken types and per-card take rates in docs/19. Commit.

---

### Task 11: C2 court knowledge table

**Files:**
- Create: `packages/engine/src/ai/court-knowledge.ts`
- Modify: `value.ts` (`'courtText'` feature, weight 0)
- Test: `packages/engine/test/court-knowledge.test.ts`

- [ ] **Step 1:** From Task 10's report, list guild cards with take rate ≥ 50% or passive effects. For each, read its implementation (`grep -n "bcNN\|<CONST>" packages/engine/src`) and write a row `{ id, ambition?: Ambition, perChapter: number /* power-equivalent */, why: string }` with the bonus net of `courtWorth` (value.ts:84-100) for that card.
- [ ] **Step 2:** Tests: every row's id exists in the base court (`court.ts`), no Vox ids, `courtText` is 0 for a faction holding none of them and equals the sum of rows × `bias` for one holding two.
- [ ] **Step 3:** Probe criterion: in 100 probe games, Influence/Secure choices differ from control in ≥ 5% of those decisions; otherwise record and skip. Gate C2a (weight 1) and C2b (0.5). Record. Commit.

---

### Task 12: C3 `nearWin` pre-gate

- [ ] **Step 1:** Implement `nearWin` in `value.ts` (weight 0): for self and best rival, `projected = power + Σ declared markers' payout at current standing`; term = `max(0, projected − (threshold − 6)) ** 2 / 36` for self minus the same for the best rival, where `threshold = 39 − 3 × factions`.
- [ ] **Step 2:** Pre-gate: over the B2 corpus, count decisions where adding `nearWin` at weight ∈ {1, 2} changes hard's tier-1 choice to the rollout-preferred candidate while leaving the `search-rounds.test.ts` pinned outcome unchanged. Arena gate only if ≥ 3. Record either way. Commit.

---

### Task 13: Assemble and fold into `hard`

**Files:** Modify `packages/engine/src/ai/levels.ts`, `mobile.ts` or a new `hard-weights.ts`.

- [ ] **Step 1:** `export const HARD_WEIGHTS: Weights = { ...MOBILE_WEIGHTS, /* passed features */ }`; candidate `hard` = `searchBot({ width: 3, depth: 14, replies: { roots: 1, deals: 1 }, weights: HARD_WEIGHTS })` plus any action-level term.
- [ ] **Step 2:** Gate candidate vs today's `hard` (family test 6). If pass: point `HARD` at it with a measurement comment; re-derive pinned `hard` tests; `npm run golden` shows only `h*` diffs, then re-record the fixture with a commit message explaining it. If nothing passed, skip.
- [ ] **Step 3:** Update AGENTS.md "current state" line if released, docs/19 register, and commit.

---

### Task 14: Wrap-up

- [ ] `npm test`, `npm run typecheck`, `npm run golden` all pass.
- [ ] Final whole-branch review on the most capable model (Fable) before merge.
- [ ] Merge to `main` with a merge commit only after Brian's go-ahead for a release (release = tag → prod deploy).
