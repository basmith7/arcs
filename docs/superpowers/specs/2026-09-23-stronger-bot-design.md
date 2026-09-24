# A stronger Arcs bot, and an advisor — design (rev 3)

Date: 2026-09-23. Branch `feat/stronger-bot`. Base game only (no Leaders & Lore, no campaign).

Revision history: rev 1 → Fable adversarial review, *rethink* (rollouts cannot fit an opponent's
turn; the displacement rule flipped on noise; §17's evidence is partly selection on outcome).
Rev 2 → second round, *revise* (B2 could not pass by construction, C1 repeated `mobile.ts`'s failure
mode, weights shared with `normal`, family miscounted, no MDE). Rev 3 resolves both rounds; round 3 verdict *ship-spec*.

## 1. Goal and success criteria

Brian wants a **stronger opponent** for bot seats and an **advisor** ("what should red do?") for a
seat a human plays in a live game. "Better" is measured with the arena, never argued.

They are separate products with separate budgets:

- **Opponent:** stays at today's `hard` latency and improves only through what the evaluator can
  see. Features that clear their gate are folded into `hard` via a new `HARD_WEIGHTS` object; `normal`
  and `easy` stay byte-identical. No new rung, nothing for the web client or server to accommodate.
- **Advisor:** may spend minutes on many cores. It uses rollouts only if an offline power test (B2)
  shows the rollout rule improves on `hard`'s choice; otherwise it is `hard` with its full line and
  alternatives printed, and it says the rollout check was not detected to help.

"Knowing all parts of the base game": a coverage report of every base-game action type offered vs
taken (section 6), and one pre-registered attempt at each recorded base-game evaluator blind spot —
**ship position** (C1) and **court card text** (C2).

## 2. Measured cost

`normal` = one-ply search over a hand-weighted linear evaluator with chapter intent; `hard` = a
whole-turn beam at the card play plus one sampled rival reply (`levels.ts:65`, `roots: 1, deals: 1`,
weights `MOBILE_WEIGHTS` — the same object `normal` uses, `mobile.ts:43`).

Measured this session: a 4p `normal` game is **105 s / 1,034 decisions (~100 ms/decision; docs/19
says ~4 ms)**. Profile: `featuresOf` 88% inclusive; `parseFigureId` 44.5% self;
`metric`/`rivalHoldings` 40%; `slotsOf`/`citiesInReserve` 28%; `Tracker.contentsOf` 16% self.

Evaluator-only work caps at 8.3x (Amdahl, 12% outside `featuresOf`); planning figure **3.5x**:

| quantity (4p, one core) | pre-speedup | at 3.5x |
| --- | --- | --- |
| one `normal` decision | ~100 ms | ~29 ms |
| one `normal` playout, mid-game to game end (~500 decisions) | ~50 s | ~14 s |
| advisor: 4 candidates x 32 playouts | ~107 min | ~30 min; **~2 min on 14 cores** |

Rollouts inside an opponent's turn are therefore out by two orders of magnitude at 4p.

## 3. Phase A — foundation (ships regardless)

### A1. Make the evaluator cheap

Behaviour-preserving, in profile order, re-profiling after each: (1) memoise `parseFigureId`
(module-level `Map`, frozen results); (2) per-observation caches for what `featuresOf` recomputes per
term, in a `WeakMap` keyed by the `ObservedState`; (3) whatever the new profile shows, including
rules-engine hot spots.

**Correctness:** `scripts/golden-journals.ts` writes, **before any optimisation**, a committed
fixture `packages/engine/test/fixtures/golden-journals.json` — 20 `normal` + 6 `hard` games, 2p and
4p: options, journal, final power. `--check` replays the bots from the same options and requires
identical journals and power; any diff fails. A fast suite test checks 3 short 2p `normal` games
from the same fixture. The existing suite passes unchanged.

**Target:** ≥ 3x on a 4p `normal` game (stretch 5x). docs/19 section 0's 4 ms figure is corrected.

### A2. Measurement protocol (pre-registered)

- **Design:** challenger vs control, 2 seats each at 4p, same seeds, seats rotated (arena does
  both). Unit = game. **Only a 4p pass ships**; 2p runs are descriptive.
- **Statistic:** per game, challenger win share minus control win share (tie-break wins count,
  reported separately). **Pass: z ≥ 2.5 on win share, and mean-power difference not below z = −2.**
- **Family (7 tests, one-sided Bonferroni at α = 0.05 ⇒ z ≥ 2.45, rounded to 2.5):** C1a, C1b,
  C2a, C2b, C3 (only if it passes its pre-gate, else the slot goes unused), assembled `hard`, one
  re-measure spare. Twin runs are sanity checks (must be |z| < 2), not tests.
- **First run:** `hard` vs `hard` twin at 4p, which also measures a 4p `hard` game's cost. Every
  gate is then sized to ≤ 24 h on 14 jobs, and its **minimum detectable effect** (80% power at
  z = 2.5, per-game sd 0.5 ⇒ n ≈ 3,100 for +3 pts, ≈ 7,000 for +2) is written next to the result. A
  result below the MDE is reported "not detected", not "null".

## 4. Phase B — the advisor

### B1. Playout capability and oracle harness

`play.ts` gains `playoutFrom(result, self, { policy, horizon: 'chapter' | 'game', salt, maxSteps })`:
redeal hidden cards with the existing `dealRivals` (no-cheat pinned, `foresee.test.ts:117`), seed via
the journal-derived `probeFrom` convention, play every seat with `policy` (a `Bot`, stepped through
`stepBot` with `AskedThisTurn` threaded as `foresee` does), return final observed state, `winners[0]`,
`tied`, and power. Step cap 2,000.

`scripts/oracle.ts` fans (candidate, salt) jobs over `worker_threads`; workers replay options +
journal rather than receive a cloned `RuleResult`. Results are identical for any worker count. Every
evaluated decision is logged as JSONL (position ref, candidates, per-salt outcomes) for any later
distillation work. This rebuilds the docs/19 §17 oracle, which is not in the repo.

### B2. Offline power test — the kill switch

Tests the rollout rule **as a policy**, since §17's lost-vs-won contrast is partly selection on
outcome, saw true hands, and used the shipped bots as continuation.

- **Corpus:** ≥ 40 4p `hard` self-play games (post-A1), ≤ 10 card-play decisions each, **contested
  only** — `hard`'s tier-1 margin between its top two roots in the lower half of its distribution
  (an estimate-independent conditioner, per §17's trap note). ≥ 400 decisions.
- **Candidates:** `hard`'s roots ranked by **tier-1 value only** (no mixing with the one
  reply-checked root, `search.ts:276-309`); top 3, plus `hard`'s actual pick if absent.
- **Selection:** 32 salts per candidate, all seats `normal`, horizon `game`, primary estimator
  **win share** (`winners[0] === self`, tie-break wins included). Common salts across candidates.
  Displace `hard`'s pick with the best challenger if its paired mean difference has **z ≥ 1.0**. The
  selection rule is deliberately permissive: the held-out stage absorbs false flips.
- **Evaluation (held out, different continuation):** 32 fresh salts for `hard`'s pick and for the
  rule's pick, **all seats `hard`**, horizon `game`. This tests whether a pick found under `normal`
  continuations is still better under the stronger policy (continuation-bias check).
- **Report:** displacement rate; false-flip rate (flips whose held-out difference < 0); net held-out
  win-share gain per decision, game-clustered se; the same numbers for the secondary estimators
  (power margin, chapter-end `valueOf`) as description only.
- **Pass:** net held-out gain z ≥ 2 (one primary look). **Early stop** after 150 decisions if the gain
  is < +0.5% with se < 2%. MDE at 400 decisions (net over all contested decisions, so it is displacement rate × gain per flip; a miss is "not detected", not "null"): roughly +3% per decision (held-out paired sd ≈ 0.25
  per decision after averaging 32 salts); stated in the result.
- **Compute:** sized after A2's twin run measures `hard`'s playout cost. If the evaluation stage
  exceeds 48 h on 14 jobs, evaluation salts drop to 16 and the MDE is restated.

### B3. The CLI

`npm run advise -- <gameId | save.json> <faction> [--cores N]`:

- Source: a save file, or a live game's options + journal via `ssh tower sqlite3 -readonly`. No
  writes; no network calls from the engine.
- Not `faction`'s decision → says whose it is, exits 0.
- Card play: prints `hard`'s roots with values labelled **tier-1** or **reply-checked**; if B2 passed,
  runs the B2 selection rule across cores and prints each candidate's rollout win share ± se and
  whether it displaced `hard`'s pick. If B2 did not pass, it says the rollout check was not detected to help and shows `hard`'s analysis only.
- Then plays the recommended line through the rest of the turn with `hard`, printing each step's
  `because`.
- Deterministic for a fixed journal, regardless of `--cores`.

## 5. Phase C — the opponent: what the evaluator can see

Each attempt is weight 0 in `WEIGHTS` and enabled only in a candidate `HARD_WEIGHTS`; gated in
`hard` at 4p against today's `hard`. Action-level terms (C1) act on `hard`'s **delegate** asks only —
the beam scores lines with `valueOf` (`search.ts:200,236`) and cannot see them, exactly as
`moveReversal` today (`levels.ts:63-64`).

### C1. Where ships go — zero-sum among Move destinations

`mobile.ts:33-36` records why the proximity pull lost: "purposeful-looking movement bought by pips
that standard spends on the economy." So `moveToward` **cannot change Move-vs-economy**: at an ask
offering Move destinations, it scores each destination by the reduction in BFS gate-distance (over
`connected`, `board.ts:117`, precomputed per board) from the moving fleet to its nearest intent
target, times the pursuit strength, then **subtracts the mean over the offered destinations**, so its
sum over any Move ask is zero and it only re-ranks destinations. Asks that are not a destination
choice are untouched.

Targets by pursued ambition: an unruled planet of a needed resource (Tycoon: Material/Fuel; Keeper:
Relic; Empath: Psionic); a rival city/starport (Tyrant, Warlord); with no strong intent, the nearest
unruled planet of a resource we lack.

Probe-game criteria before arena time (100 4p games vs today): move reversals stay 0; unfinished
games 0; **Move share of pips unchanged within 2 points**. Two weights, C1a and C1b.

### C2. Court cards by what they do — hand-authored, restricted to used abilities

Rev 1's rollout-measured table hits §3i's label-noise wall and prices cards under a policy that never
uses them; it is dropped. The Weapon precedent (docs/19 §9) says pricing an asset does not make the
bot use it. So:

1. The section 6 coverage report runs first. For each of the **25 guild cards** (the 6 Vox are never
   held; `courtWorth` flat-prices them), it counts how often the card's ability was offered to its
   holder and how often it was taken.
2. C2 covers only guild cards whose ability the bots take when offered (≥ 50% take rate), or whose
   effect is passive (applies without a choice).
3. `court-knowledge.ts` records per such card, from the rules code implementing it: what holding it
   yields per chapter, in power-equivalent units; which ambition it serves (multiplied by pursuit,
   as `courtWorth` does for suit); **net of what `courtWorth` already prices** by suit and keys.
4. Justification against the register's bar: `courtWorth`'s suit-and-keys pricing is a recorded
   blind spot (docs/19 §0); a probe criterion before arena time is that the bot's Influence/Secure
   choices change in ≥ 5% of probe decisions (otherwise the feature cannot matter and the slots go
   unused).

Two variants: C2a full table, C2b at half scale.

### C3. The win threshold — pre-gated

`nearWin`: for self and the best rival, a term rising sharply as projected power (power + standing on
declared markers) approaches `39 − 3·factions` (`ambitions.ts:694`). docs/19 §19 showed an end-of-turn
threshold term cancels in the §18 game and cannot flip it, so C3 gets arena time **only if** it
first flips at least 3 contested B2-corpus decisions toward the rollout-preferred move at a weight
that leaves the §18 pinned test's outcome unchanged. Otherwise its family slot goes unused.

### Assembly and the fold into `hard`

Everything that passed goes into `HARD_WEIGHTS = { ...MOBILE_WEIGHTS, … }`, re-measured once against
today's `hard` (family test 6). On a pass, `levels.ts` points `hard` at it with the measurement in a
comment; `normal`/`easy` are asserted byte-identical by the golden fixture; pinned `hard` tests (e.g.
the game-41 oracle pin in `search-rounds.test.ts`) are re-derived and the changes explained. Note in
the release: the server picks the bot per step (`gate.ts:179`), so in-progress bot games get the new
`hard` from the deploy on. If nothing passes, `hard` is unchanged and the nulls are recorded.

## 6. Coverage report (script)

`playGame` gains an optional per-ask recorder (offered action types, taken type, faction; off by
default so arena output is unchanged); `scripts/coverage.ts` runs 200 4p `hard` games with it and
prints, per base-game action type and per guild-card ability, offered vs taken. Offered-but-never-
taken types are recorded in docs/19 as blind spots. Report, not gate.

## 7. Out of scope

Leaders & Lore / campaign tuning (bots must still run there; the suite keeps them working); a new
ladder rung; web/server worker threads; a learned evaluator (B1 logs labels for it); advisor UI.

## 8. Risks

- **B2 null** (plausible): the advisor is `hard`-with-explanation and says so.
- **All of C null** (plausible): deliverables are the speedup, harness, advisor, coverage report and
  recorded nulls; `hard` remains the strongest bot, which is itself the answer.
- **Speedup changes behaviour:** committed golden fixture, any diff fails.
- **Compute:** every gate sized from the A2 twin run; B2 has an early stop.
