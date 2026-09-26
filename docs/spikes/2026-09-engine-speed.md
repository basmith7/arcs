# Spike: is engine speed the bottleneck for training a learned Arcs bot? (2026-09-26)

Branch `spike/engine-speed` (from `feat/weekend-lab` d90a0ea), worktree `~/Projects/arcs-speed`.
A time-boxed spike. The output is this answer; only step 4's `Tracker` might be kept.

## Answer

**No. At training scale the engine is not the binding constraint, and neither a TS rewrite nor Rust
changes that.**

- A training label comes from `playoutFrom` under the `normal` bot. From the same 100 4p
  positions, that playout costs **14.3 CPU-s** (mean). With a nearly free policy
  (`playoutChoice`) it costs **0.029 s**. **About 99.8% of a playout is the policy's evaluator,
  not the rules engine.**
- A §3i-grade label set (370 playouts per position) for 10k 4p positions costs **~14,650
  core-hours at today's speed and ~1,465 even at 10x.** That is 44 days on 14 cores at 1x, and
  4.4 days at 10x. At 100k positions it is 14,650 core-hours even at 10x. This is thousands of
  core-hours at 10x, so **engine speed is not what limits it.** The cost of the rollout policy and
  the noise in the label (§3i: ~20x the effect) are the limits.
- The dense-id `Tracker` rewrite passed every check (26 golden games identical, 1339/1339 tests)
  and bought **1.02x** on a whole game. Rust on the same representation is **1.41x** on tracker
  operations and **1.17x** on the positional BFS.

**Recommendation: neither.** Details and the result that would change it are at the end.

## Method

- **CPU time per process** (`process.cpuUsage` in Node, `CLOCK_PROCESS_CPUTIME_ID` in Rust). The
  machine was loaded throughout: load average ~18 on 16 cores, and B2 was running from the main
  checkout. Wall time was not used.
- **At most 2 cores.** Processes were pinned with `taskset` to cores 14 and 15.
- **Whole games** ran as esbuild bundles, the same way `scripts/shard-runner.ts` builds them
  (`scripts/spike/build.sh`).
- **A/B runs were interleaved.** Each round ran A and B at the same time, one per core, and
  swapped cores every round. Results are reported as medians and ranges, not means.
- **Call counters** (`packages/engine/src/spike-count.ts`) are a few integer increments in
  `advance`, `perform`, `observe`, `featuresOf`, `featuresOfUncached` and `positionalUncached`.
  Both A and B carry them.
- Every script is in `scripts/spike/`, and the Rust crate is in `spike/rust/`. Raw outputs are in
  `runs-spike/` (untracked).

## 1. In-situ profile (4p, seed 201, `node --cpu-prof`, bundled)

| | 4p `normal` | 4p `hard` |
| --- | --- | --- |
| CPU under the profiler / decisions | 26.0 s / 1,034 | 58.0 s / 882 |

Inclusive shares, with `.cpuprofile` frames mapped back to source through the bundle's source map
(`scripts/spike/prof.mjs`):

| component | `normal` | `hard` | Amdahl ceiling if it cost 0 (`normal` / `hard`) |
| --- | --- | --- | --- |
| `featuresOf` (cached entry, incl. uncached) | 60.6% | 54.5% | 2.54x / 2.20x |
| — `featuresOfUncached` | 57.1% | 51.2% | |
| — cached path only (hits and lookups) | 3.5% | 3.3% | |
| — `positionalUncached` (the BFS) | 11.5% | 8.8% | 1.13x / 1.10x |
| — rule helpers called by the evaluator (`metric` etc.) | 15.9% | 15.8% | |
| `advance` (the rules engine proper) | 14.3% | 19.5% | **1.17x / 1.24x** |
| `observe` | 0.4% | 0.3% | 1.00x |
| `tracker.*` (all callers, self) | 14.8% | 15.6% | 1.17x / 1.18x |
| — tracker under `advance` / under `featuresOf` | 5.0% / 8.2% | 7.3% / 7.2% | |
| search: `settle` (`play.ts`) | 80.7% | 55.6% | |
| search: `foresee` | — | 51.8% | |
| search: `explore` | — | 12.1% | |
| GC (profiler) | 10.0% | 12.2% | 1.11x / 1.14x |
| GC (`PerformanceObserver`, separate count) | 3.0 of 26.0 s | 8.2 of 58.0 s | |

The largest self costs are `contentsOf` (10.8% / 10.6%) and GC. `contentsOf` is a single
`Map.get`. Its cost is hashing location keys that are built fresh on each call
(`` `system:${s}` ``): a microbenchmark puts a fresh concatenated key at ~45-53 ns per lookup
against ~21 ns for an interned one. The callers that pay most are `countResource` (3.8%) and the
evaluator.

Call counts per decision (median / p90 / max / mean):

| | `advance` | `observe` | `featuresOfUncached` |
| --- | --- | --- | --- |
| 4p `normal` | 9 / 89 / 39,089 / 192 | 5 / 48 / 21,989 / 111 | 20 / 192 / 87,956 / 443 |
| 4p `hard` | 11 / 1,306 / 87,997 / 845 | 6 / 795 / 50,205 / 342 | 24 / 2,636 / 200,816 / 1,218 |

Most decisions are cheap, and a heavy tail sets the mean. The `featuresOf` cache hits 15% of calls
(`normal`: 540k calls, 458k computed).

**Reading:** the rules engine is 14-20% of a bot game. **Making the engine infinitely fast would
give at most 1.17x (`normal`) or 1.24x (`hard`).** The evaluator is the majority, and a learned
evaluator would replace it.

## 2. Training-data unit cost

The positions were 10 evenly spaced points in each of the 10 golden `normal` journals at each
player count: 100 at 4p and 100 at 2p, the first ask at or after each point. Each position got
one `playoutFrom(result, self, undefined, { policy: normal, horizon: 'game', salt })`. Replay was
outside the timed region.

| policy | players | n | finished | median | mean | p10 | p90 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `normal` | 4p | 100 | 100 | **9.30 s** | **14.25 s** | 1.07 | 33.2 | 64.2 |
| `normal` | 2p | 100 | 100 | **1.47 s** | **2.73 s** | 0.17 | 5.70 | 42.7 |
| `playoutChoice` (no evaluator) | 4p | 100 | 92 | 0.018 s | 0.029 s | 0.005 | 0.059 | 0.199 |
| `playoutChoice` (no evaluator) | 2p | 100 | 99 | 0.011 s | 0.015 s | 0.003 | 0.030 | 0.066 |

Two things to note:

- The distribution is heavy-tailed, and early positions cost most. A budget is a sum, so step 3
  uses the **mean**.
- The `playoutChoice` games are not the same games: it plays differently, and 8 of 100 4p
  playouts hit the step cap. It measures what the engine plus `stepBot` cost when the policy is
  nearly free. **That is ~490x (4p) and ~180x (2p) below `normal`.**

## 3. Training budget

Core-hours = positions × playouts per position × mean unit cost. Days are on 14 cores. The 1x
column is measured. **The 5x, 10x and 20x columns are hypothetical** engine speeds applied to the
whole playout, which step 1 shows no engine change can deliver (see the Amdahl ceiling).

### 4p (unit 14.25 CPU-s)

| label | positions | playouts | core-h @1x | @5x | @10x | @20x | days/14c @1x | @10x |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| §3i-grade (370/position) | 10k | 3.7M | 14,650 | 2,930 | 1,465 | 733 | 43.6 | 4.4 |
| §3i-grade | 100k | 37M | 146,502 | 29,300 | 14,650 | 7,325 | 436 | 43.6 |
| §3i-grade | 1M | 370M | 1,465,020 | 293,004 | 146,502 | 73,251 | 4,360 | 436 |
| AlphaZero-style (12/position) | 10k | 120k | 475 | 95 | 48 | 24 | 1.4 | 0.1 |
| AlphaZero-style | 100k | 1.2M | 4,751 | 950 | 475 | 238 | 14.1 | 1.4 |
| AlphaZero-style | 1M | 12M | 47,514 | 9,503 | 4,751 | 2,376 | 141 | 14.1 |

### 2p (unit 2.73 CPU-s)

| label | positions | core-h @1x | @5x | @10x | @20x | days/14c @1x | @10x |
| --- | --- | --- | --- | --- | --- | --- | --- |
| §3i-grade | 10k | 2,800 | 560 | 280 | 140 | 8.3 | 0.8 |
| §3i-grade | 100k | 28,003 | 5,601 | 2,800 | 1,400 | 83 | 8.3 |
| §3i-grade | 1M | 280,027 | 56,005 | 28,003 | 14,001 | 833 | 83 |
| AlphaZero-style | 10k | 91 | 18 | 9 | 5 | 0.3 | 0.0 |
| AlphaZero-style | 100k | 908 | 182 | 91 | 45 | 2.7 | 0.3 |
| AlphaZero-style | 1M | 9,082 | 1,816 | 908 | 454 | 27 | 2.7 |

§3i needed ~370 playouts per *branch*, so about 740 per interventional pair. A pair-based label
doubles every §3i row.

**Reading:**

- A §3i-grade 4p label set is thousands of core-hours even at 10x, from 10k positions up.
- At 1x, only the AlphaZero-style rows at ≤100k positions (2p) or ≤10k (4p) fit in days on 14
  cores.
- If playouts ran on `playoutChoice` instead (0.029 s), a §3i-grade 10k-position 4p set would cost
  ~30 core-hours **in today's TS**. That is an estimate (37M × 0.029 s), not a run.

**The cost is the policy inside the rollout, not the engine.**

## 4. TS representation rewrite of `Tracker` (measured)

`packages/engine/src/tracker.ts`, behind the same interface:

- **Dense ids.** Entity and location strings are interned to integers in a `Space`. The space is
  append-only and shared by every tracker descended from one `emptyTracker()`.
- **Per-tracker storage.** Each tracker holds an `Int32Array` entity → location, and an array of
  per-location lists.
- **Copy-on-write.** A change copies the typed array and the outer array, and replaces only the
  touched lists.
- **Object identity.** Every change makes a new object (a no-op `move` still returns the same
  object), so every identity-keyed cache stays valid.
- **Map views.** `at`, `contents` and `rules` are built as `Map`s on first read, for the callers
  and tests that read them directly.
- **Hand-built trackers.** A hand-built `{ at, contents, rules }` object is converted once
  (`WeakMap`). This includes a spread tracker with no `rules`, which is how the tests write it.

**Acceptance:**

- `npm run golden`: 26/26 games identical, run twice (before and after the last one-line fix for
  spread-built trackers).
- Full `npm test`: **95 files, 1339/1339 pass** (run as `vitest run --pool=forks` with 2 forks, to
  keep to 2 cores).

**Whole game, A = `feat/weekend-lab` tracker, B = dense.** Bundled, CPU per process, interleaved,
and both played identically (same decisions, same `advance` count):

| game | rounds | A median (range) | B median (range) | A/B per round: median (range) |
| --- | --- | --- | --- | --- |
| 4p `normal` s201 | 6 | 15.55 s (14.90-32.35) | 15.27 s (14.35-32.23) | **1.018x** (1.004-1.039) |
| 4p `hard` s201 | 4 | 74.57 s (57.75-79.98) | 73.20 s (56.41-77.87) | **1.023x** (1.016-1.027) |

**~2%.** This matches §25's persistent-map result: the tracker's 15% is mostly `contentsOf`
reads, and a dense representation does not remove them. Callers still pass string locations, so
every read still hashes a string (freshly concatenated, usually). The copies were never the cost.

A cheap follow-up was not measured: intern the `Location.*` / `CardLocation.*` builders so each
returns one canonical string object, whose hash V8 caches. The ~2x lookup gap above bounds it at
roughly half of `contentsOf`'s ~11%, so ≤ ~1.06x. That is an estimate.

## 5. Language multiplier on a fixed representation (measured)

**Setup:**

- **Tracker trace.** Every tracker call from `startGame` of the 4p `normal` s201 game was
  recorded, up to 1.5M ops (about the first tenth of the game): 1,494,904 `contentsOf`, 3,922
  `move`, 98 `register`, 11 `place`, 4 `emptyTracker`.
- **Recording.** An esbuild plugin swaps in `scripts/spike/tracker-traced.ts`, so the production
  code has no hooks.
- **Replay.** The trace was replayed through step 4's TS tracker and through its Rust port
  (`spike/rust/src/tracker.rs`, the same operations and representation). Trackers are dropped at
  last use, as in the game.
- **BFS.** `positionalUncached`'s BFS was extracted as a kernel (`scripts/spike/bfs-kernel.ts`)
  and checked equal to the engine function on all **10,388** recorded inputs (every 5th step of
  the 20 golden `normal` games, every faction). It was ported to `spike/rust/src/bfs.rs`: the same
  string ids, hash sets and maps, and a linear `includes` over the damaged list.
- **Build and timing.** Rust was built with `--release`, LTO and codegen-units 1. Hashing is
  FxHash (std SipHash would handicap Rust). Each run did 30 iterations, discarded the first 10,
  and excluded parsing from the timed region. There were 4 interleaved runs per language, on
  alternating cores.
- **Checks.** Every op result was checked against the trace, and every BFS output against the
  engine's (`f64::to_bits` in Rust). The checksums of all iterations were identical across TS and
  Rust (trace 537759771, BFS 2177022979).

| kernel | TS (per-run medians) | Rust | TS / Rust: median (range) |
| --- | --- | --- | --- |
| tracker trace, 1.5M ops | 45.1, 43.1, 43.6, 46.9 ms | 31.4, 31.6, 31.5, 31.6 ms | **1.41x** (1.37-1.48) |
| positional BFS, 10,388 cases | 76.0, 75.5, 75.0, 76.7 ms | 61.9, 64.8, 64.0, 65.8 ms | **1.17x** (1.17-1.23) |

Both kernels are dominated by hashing short string keys. V8 caches a string's hash in the string,
while Rust re-hashes the bytes on every lookup. So on the *same* representation the language is
worth ~1.2-1.4x. A Rust design with integer ids throughout would do better, but that is a
representation change, and it would help TS too. It was not measured here.

## 6. Projections (estimates, not measured)

**Full Rust port, whole-game speedup.**

| design | estimate | assumptions |
| --- | --- | --- |
| Same design | **~1.3x (1.2-1.5x)** | Step 5's 1.17-1.41x on the hottest kernels applies across rules and evaluator alike, plus the ~10-12% of GC that Rust would not pay. |
| Redesigned (integer ids everywhere, no string-keyed maps, no per-probe allocation) | **3-5x** | Typical for a data-oriented rewrite; unmeasured. Much of that gain would come from the redesign, which TS could also take in part. |

Neither design moves the budget much:

- **The playout policy is the evaluator.** Porting `featuresOf` is ruled out here, because a
  learned evaluator replaces it. A Rust engine without `featuresOf` accelerates only the 14-20%
  that is engine: **≤1.17-1.24x on a `normal` playout, even at infinite engine speed.**
- **Rust helps only with a cheap rollout policy.** Rust speeds up rollouts only if the rollout
  policy is cheap: `playoutChoice`, or a learned network. With `playoutChoice`, TS already does a
  full 4p playout in ~29 ms (step 2). With a network, inference cost replaces `featuresOf` as the
  dominant term.

**Full-port effort.**

- **Size.** The engine is ~18k lines of TS: `rules/` 9.1k, `ai/` 5.0k, core ~3.9k. There are 61
  test files.
- **Estimate: ~10-16 weeks** for one developer.
  - Rules and core: ~6-10 weeks, debugged against the golden journals.
  - Bots (minus `featuresOf`): 2-4 weeks.
  - WASM bindings and wiring into web and server: 1-2 weeks.
- **All-or-nothing.** Browser and server must make identical decisions, so a Rust/WASM engine
  would have to replace the TS one everywhere. Otherwise there are **two engines to maintain**,
  and every rules fix must land twice. Golden-journal replay would be the only cross-check.
- **An offline-only Rust trainer** avoids the WASM work, but not the lockstep problem: its labels
  are only as good as its agreement with the shipped TS rules.

## Recommendation: neither

1. **Keep today's `Tracker`.** The rewrite is correct, but +2% does not pay for 190 more lines and
   a second representation. It stays on this branch as evidence.
2. **Do not port to Rust, for training or otherwise.** The measured language multiplier is
   1.2-1.4x. The engine is ≤20% of a bot's time. The budget is set by the rollout policy and the
   label noise: §3i needs ~370 playouts per branch because one action's effect is ~0.5 power
   against ~9.6 of noise.
3. **The binding constraints are:**
   - the policy cost inside each rollout (~490x the engine);
   - the number of rollouts a noise-free label needs.

   Levers that address them: a much cheaper rollout policy that is still credible (§3d says
   `playoutChoice` is not); fewer, better-targeted labels (AlphaZero-style targets from search
   visit counts rather than 370-playout means); or training on outcomes from ordinary self-play
   games rather than per-position rollouts.

**What would change this:**

- **A learned policy cheap enough to make rollouts engine-bound.** It must be one inference per
  decision, not one per simulated candidate. A playout is several hundred decisions (~500 is an
  estimate; not counted). To stay near the `playoutChoice` 29 ms, inference must be about ≤50 µs
  per decision: 29 ms + 500 × 50 µs ≈ 55 ms. At 1 ms per decision a playout is ~530 ms: still
  ~27x cheaper than `normal`, but then the policy is the cost again. Once the policy is that
  cheap, the engine (plus `stepBot`/`observe`) becomes most of the cost, and a TS representation
  pass, followed by offline Rust if needed, starts to pay. Re-profile a `playoutChoice` playout
  first: its engine shares, not the `normal` bot's, would decide it. Whether such a policy is a
  credible simulator (§3d) is the prior question: measure its agreement with `hard` and its arena
  strength first.
- **A step 5-style kernel with integer ids at ≥5x over TS on the same ids.** That would make a
  redesigned Rust engine worth pricing again.
- **A TS pass (interned locations, fewer string-keyed maps) at ≥1.3x on a whole game.** That would
  be worth shipping for arena and lab throughput, whatever happens with training.
