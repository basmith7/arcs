# The pip-menu tie: gating `exp:s1` (2026-09-27)

Branch `exp/strategies` (merged 2026-09-29; the worktree is gone). Found while the committed-strategies
experiment was running (docs/spikes/2026-09-strategies.md); it is a separate question with its own
family.

**Part 1 was committed before the first game.** Results are added below it afterwards.

---

# Part 1 — Protocol (pre-registered)

## What was found

`npm run coverage` on today's `hard`: 100 4p games, all four seats `hard`, seed 92000. `hard` took
Secure from the pip menu **0 times in 896 offers**. The tie audit (`scripts/tie-audit.ts`, seeds
93001-93004) found ~80% of pip-menu decisions (`action/take`) tied exactly for best.

Reading the scores (`scripts/secure-probe.ts`) shows every option on the menu scoring the same.
Battle, Move and Secure each score, for example, 0.5144, so offer order chooses the action.

This is docs/19 §2j's blind spot, which §2j fixed on 2026-08-01: `settle` resolves a pip's
sub-flow before the options are scored. The fix no longer applies:

- Every sub-ask inside a pip now carries the remaining pips in its continuation (checked: Battle,
  Move and Secure sub-asks all report `1/2` pips ahead).
- `settle` treats "pips ahead" as its horizon, so it stops at the sub-ask before the board has
  moved.

## The candidate

`exp:s1` is today's `hard` with `Bot.settleSubflows: true`. With the flag set, only the pip menu
itself (an ask that offers `action/take`) is `settle`'s horizon, so a sub-flow is resolved as §2j
intended.

- It is off for every shipped bot. Golden: 26/26 journals identical. `npm test`: 1346/1346.
- In the probe game, `s1`'s pip-menu scores separate. It took Secure when Secure scored 0.8-1.5
  above the next option.

## Runs (local, 8 shards, Board4MixUp1, base game)

1. **Probe.**
   - Setup: 100 games, `A=hard,B=exp:s1,B=exp:s1,A=hard`, seed 91000.
   - Criteria:
     - (a) every game finishes;
     - (b) `take:Secure` is taken in at least 5% of its offers (`hard`: 0%).
   - It is not retried: there is no weight to move.
   - Reported, not criteria: Battle, Move and Influence take rates against `hard`, and CPU per
     game.
2. **Gate.** Only if the probe passes. The lab's rules (`scripts/lab.ts`, docs/19 §23):
   - 4p, A,B,B,A;
   - chunks of 400 games (100 deals) on seeds `1_210_000 + 1000k`;
   - clustered by deal (`pairedGate`);
   - after 800 games: futility stop if win-share z ≤ 0.5, early pass if z ≥ 3.54 with power
     z ≥ -2;
   - after 1,600 games: pass if z ≥ 2.5 with power z ≥ -2.

## Family

One test, at z 2.5. It is separate from the strategies family (G1-G3, M1-M3), which it does not
share games or hypotheses with.

## Decision rule (fixed now)

- **Pass**: recommend shipping the flag in `hard`:
  - re-record the six golden `hard` journals, leaving `normal` untouched;
  - measure `hard`'s CPU per decision first, and report whether UI pacing needs attention if it
    rose more than 2x.
  - Whether `normal` and `easy` should get it is a separate gate, not part of this one.
- **Not detected**: the tie stays a known blind spot, recorded in docs/19. §2j's own mirror
  measurement already found action choice worth little when every seat plays alike; that is the
  result that would explain a null here.

## Wall clock (estimate)

These estimates come from the strategies runs at 13 shards: ~16 min per 100-game probe, and ~45 min
per 400-game chunk.

- At 8 shards: ~25 min for the probe, and ~75 min per chunk.
- §2j measured the fix at ~3.5x per pip decision, which may raise this.
- Total: **~3-4 h to a futility or early-pass verdict at 800 games, ~6-7 h if it runs to 1,600.**

---

# Part 2 — Results (2026-09-27; shipped 2026-09-29)

## Answer

**Pass. `settleSubflows` makes `hard` stronger, and it ships as `hard` in v0.11.0.** Against today's
`hard`, 4p, 1,600 games / 400 deals: **+6.3 ± 2.4 pts win share per side (z 2.68)** against the
2.5 bar, and **+2.11 ± 0.25 power (z 8.34)**.

## Probe (100 4p games, seed 91000): pass

| | `exp:s1` | `hard` |
| --- | --- | --- |
| unfinished | 0 | 0 |
| `take:Secure` take rate (criterion ≥ 5%) | **79.1%** | 4.8% |
| Battle | 52.0% | 63.5% |
| Move | 9.6% | 58.1% |
| Influence | 70.0% | 8.9% |

With the options scored apart, s1 plays a very different game: it Secures and Influences where `hard`
Moves. Offer order had been choosing Move. (`hard`'s 4.8% Secure here, against 0 of 896 in the
coverage report, comes from different games and a different count: take rate per offer, where
coverage counted pip-menu decisions.)

## Gate (4p, A,B,B,A, clustered by deal, 100-game chunks)

| after | win share Δ per side | power Δ per seat |
| --- | --- | --- |
| 400 games (100 deals) | +9.5 ± 4.9 (z 1.94) | +2.26 ± 0.51 (z 4.44) |
| 800 | +5.8 ± 3.4 (z 1.69): neither futility nor early pass | +1.94 ± 0.35 (z 5.57) |
| 1,200 | +4.5 ± 2.7 (z 1.65) | +1.89 ± 0.29 (z 6.54) |
| **1,600 (400 deals)** | **+6.3 ± 2.4 (z 2.68): pass** | **+2.11 ± 0.25 (z 8.34)** |

Run log: `runs/strategies/summary.md` in the old `exp/strategies` worktree, archived in
`runs/archive-2026-09.tar.xz`.

## CPU (the decision rule's check), measured 2026-09-29

Three all-`hard` 4p games (Board4MixUp1, seeds 9300-9302), desktop, every bot decision timed:

| | decisions | mean | p99 | p99.9 | worst | > 1 s | > 3 s | > 5 s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hard` (before) | 33,842 | 3.8 ms | 51 ms | 662 ms | 3.4 s | 19 | 3 | 0 |
| `exp:s1` | 34,069 | 4.5 ms | 20 ms | 440 ms | **12.9 s** | 21 | 7 | **5** |

The mean rose 1.2x, below the rule's 2x. The worst case rose 3.7x. The slow decisions are card plays
(lead, copy, surpass: 2-12 s) and one battle-dice choice with 190 options (8 s). Both the server
and the page decided on their main thread, so a 13 s decision froze the tab and, online, stalled
every game on the server. Brian chose to fix that before shipping. v0.11.0 therefore also moves bot
thinking into a worker (`createThinker`, `packages/server-node/src/thinker.ts`,
`apps/web/src/bot-worker.ts`). Measured on the built server playing an all-`hard` game at pace 0 for
90 s, with `/healthz` polled every 20 ms: the longest response was **11 ms** with the worker, and
**2.6 s** (11 over 500 ms) in-process.

## Shipping

- `hard` = `{ ...searchBot(...), settleSubflows: true }` (`levels.ts`); `exp:s1` is now identical to it.
- The six golden `hard` journals were re-recorded; the twenty `normal` ones replay unchanged.
- `normal` and `easy` do not get the flag. That would be a separate gate.
