# Experiment: do committed strategies beat adaptive `hard`? (2026-09-26)

Branch `exp/strategies` (from `feat/weekend-lab` d90a0ea; merged 2026-09-29, worktree removed).
This is an experiment, not a feature. The output is an answer with measurements, plus the profiles
if anything wins.

**Part 1, the protocol, was committed before the first experimental game.** Parts 2 onward are
the results, added afterwards. Any number not measured here is marked as an estimate.

---

# Part 1 — Protocol (pre-registered)

## Questions

1. Does any committed strategy beat adaptive `hard` at 4p?
2. Do different strategies win from different setups (seat, board, leader, opening hand)? If so,
   "choose a plan per chapter from the setup" would be worth building.
3. Is strength transitive here? A strategy can beat `hard` head-to-head and still lose in a mixed
   field.

## The profiles (`packages/engine/src/ai/strategy.ts`)

Each strategy is `hard`, unchanged: the reply search `search-v4(3x14,r1x1)` with `HARD_WEIGHTS`. On
top of that it gets two things:

- **a weight overlay** on `HARD_WEIGHTS`, each weight at most 1.5x `hard`'s;
- **a committed intent** (`committedIntent`), which replaces `intentFor` through a new `intent`
  option on `searchBot` and `heuristicBotWith`. That option is unset in every shipped bot.

| strategy | plan (ambitions) | overlay on `HARD_WEIGHTS` |
| --- | --- | --- |
| `strat:warlord` | Warlord, Tyrant | trophies 0.3→0.45, captives 0.3→0.45, shipsFresh 0.35→0.5, battleUnlocked 0.6→0.9 |
| `strat:builder` | Tycoon | cities 2.0→2.5, starports 1.2→1.5, incomeDeclared 0.9→1.2, incomeUndeclared 0.22→0.33 |
| `strat:court` | Keeper, Empath | courtSecured 1→1.5, courtClaimAhead 0.25→0.4, courtClaimLevel 0.12→0.18, courtClaimBehind 0.05→0.08 |
| control | `hard` | — |

**How the intent is fixed.**

- The plan's *live* ambitions share 0.85 of the intent evenly. The other ambitions share the
  remaining 0.15 evenly.
- An ambition is live if it is declared, or if any marker is still left to declare into.
- `intentFor` pursues each ambition in proportion to how much it wants it. The evaluator uses
  that intent through `bias` = 0.5 + 1.5 × pursuit (`value.ts`). It also reaches
  `declareReady`, `seizeReady` and `moveToward`.

**Fallback.**

- If none of the plan's ambitions is live, the plan cannot score this chapter. The bot then uses
  `hard`'s own adaptive intent (`intentFor(·, feasibility)`) until the chapter ends.
- If only part of the plan is live, the whole 0.85 goes to the live part.

**Why these refinements.** I made these choices after reading the code and before any game:

- **Hard already opens as a warlord.** On Board4MixUp1's opening position, `hard`'s own intent is
  already 55-68% Warlord/Tyrant, because every faction's ships feed that fitness. It is 9-23%
  Tycoon and 18-36% Keeper/Empath. So the Warlord profile commits harder to something `hard`
  already leans toward, while Builder and Court are real departures.
- **An intent override, not a fitness tilt.** The first version multiplied `feasibility` by 4 for
  the plan's ambitions and divided it by 4 for the rest. The fitness was fixed, but the intent
  was not: over 4 diagnostic 4p games (seed 4242, `scripts/strategy-flap.ts`, counting real
  decisions only), it moved between two of the bot's own same-turn decisions in 7-9% of pairs.
  That is as often as `hard`'s own intent (9%). The causes were ships lost, cities built, trophies
  and declarations — all things the bot's own pips change.

  The override reads only which plan ambitions are live, so it moves only when a marker is placed.
  On the same 4 games it moved in **13 of 2,176 same-turn pairs (0.6%)**, against `hard`'s 48 of
  675 (7.1%). Seven of the 13 were the marker case. The other six happened while the fallback was
  active, that is, while it was playing `hard`'s own intent.
- **Pure function of the observation.** The plan is configuration (like the weights), not
  memory. Tests: `packages/engine/test/strategy.test.ts`.
- **Evenly split, not adaptive within the plan.** Warlord and Tyrant get equal weight, as do
  Keeper and Empath. Splitting by feasibility would bring back the within-turn movement.

**Acceptance for the engine change**:
- `npm run golden`: all 26 journals identical (verified: 26/26 ok);
- `npm test` with at most 14 workers.

`normal` and `hard` cannot change: the new option defaults to unset.

## Runs, in order

All runs are local, with 14 shards (`--jobs 14`, bundled shards). Tower is not used. The board is
Board4MixUp1, base game, with no leaders or lore, unless stated otherwise.

**1. Probe.** One per strategy.
- 100 games, seats `A=hard,B=strat:X,B=strat:X,A=hard` (`npm run coverage`), seed 91000.
- To pass, the probe needs all three of:
  - (a) **every game finishes**;
  - (b) **declarations match the plan**: the share of the strategy's declarations naming a plan
    ambition is at least 15 points above `hard`'s share for the same ambitions in the same
    games. Declarations are counted by ambition using new additive `declare:<Ambition>` tally
    keys;
  - (c) **battles match the plan**: for Warlord, the take rate of Battle from the pip menu
    (`take:Battle`) is at least 5 points above `hard`'s. For Builder and Court it is no more than
    2 points above `hard`'s.
- If (b) fails, the probe is retried once with commitment 0.95 (`strat:X:0.95`). If that also
  fails, or if (a) or (c) fails, the strategy gets **no gate**. It is then reported as
  "not distinct as built".

**2. Gate.** One per strategy that passes its probe (the lab's rules, `scripts/lab.ts`):
- 4p, seats `A=hard,B=strat:X,B=strat:X,A=hard` (A,B,B,A);
- chunks of 400 games (100 deals), chunk k on seeds `1_110_000 + 1000k`. All three strategies
  play the same deals;
- clustered by seed with `pairedGate`;
- after 800 games: futility stop if win-share z ≤ 0.5, early pass if z ≥ 3.54 with power
  z ≥ -2;
- after 1,600 games: pass if z ≥ 2.5 on win share and power z ≥ -2.

**3. Mixed field.**
- 1,600 games (400 deals), seats `W=strat:warlord,B=strat:builder,C=strat:court,H=hard`. The arena
  rotates them so each bot plays each seat once per deal. Seeds from 1,300,000.
- One look, no sequential stops.
- Reported: win share, outright wins, mean rank and mean power per bot. Also `pairedGate(W,H)`,
  `pairedGate(B,H)` and `pairedGate(C,H)`, with the same pass rule (z ≥ 2.5, power z ≥ -2).
- A strategy that failed its probe still sits in the mixed field (it is still a distinct
  opponent), but it has no test there.

**4. Setup-dependence** — *exploratory, no tests, not in the family.*
- For each strategy, win share and mean power are split by:
  - **seat**: red leads first on this board;
  - **opening hand**: dealt by `startGame` from the seed alone, so it is recomputed after the
    fact. The split is by the number of cards in the chapter-1 hand that can declare a plan
    ambition (strength 3/4/7 for Warlord, 2/7 for Builder, 5/6/7 for Court), and by the hand's
    majority suit;
  - **board**: extra mixed-field runs of 400 games each on Board4MixUp2, Board4Frontiers and
    Board4MixUp3, seed 1,400,000;
  - **leader**: one extra mixed-field run of 400 games with Leaders & Lore on (`--lore 1`,
    Board4MixUp1, seed 1,500,000). The bots draft their own leaders, so "leader" here is
    partly a choice, not pure setup.
- The seat and hand splits use the gate and mixed-field games. The board and leader runs happen
  only after runs 1-3.

## The family of tests (6, within §23's limit of 7)

| # | test | pass rule |
| --- | --- | --- |
| G1 | Warlord vs `hard`, 4p gate | as above |
| G2 | Builder vs `hard`, 4p gate | as above |
| G3 | Court vs `hard`, 4p gate | as above |
| M1 | Warlord vs `hard` in the mixed field | z ≥ 2.5, power z ≥ -2, at 1,600 games |
| M2 | Builder vs `hard` in the mixed field | same |
| M3 | Court vs `hard` in the mixed field | same |

z 2.5 one-sided holds the family-wise false-pass rate near 5% for up to 7 tests (Bonferroni,
0.05/7 ≈ z 2.45), as in §23. The probe retry at 0.95 replaces its strategy's config; it does not add
a test. Everything in run 4 is exploratory and is labelled that way wherever it appears.

## Decision rule for the recommendation (fixed now)

- **Ship a strategy into `hard`**: its gate passes, and in the mixed field it is not significantly
  behind `hard` (M z > -2).
- **Build "choose a plan per chapter"**: no strategy needs to pass. This needs one exploratory
  setup split where a strategy's win share is at least 10 points above its own overall share,
  in a cell of at least 200 seat-games, with the other strategies not showing the same lift.
  Different strategies also need to win in different cells. Even then, the recommendation is a
  *confirmatory follow-up* on fresh seeds, not a build.
- **Offer strategies as bot personalities**: no pass, but at least two strategies are distinct
  (their probes passed) and within 5 points of `hard`'s win share per seat in the mixed field.
- **Stop**: none of the above.

## Wall clock (estimates, not measured yet)

A 4p `hard` game costs ~45-58 CPU-s (docs/spikes/2026-09-engine-speed.md: 58 s profiled; golden
`h4-*` took 32-34 s of wall time each while 8 processes ran). At 14 shards that is ~1,000-1,100
games an hour. Estimates:

| run | games | wall time |
| --- | --- | --- |
| probes | 300 (up to 600 with retries) | ~20-35 min |
| gates | 2,400-4,800 | ~2.3-4.6 h |
| mixed field | 1,600 | ~1.5 h |
| exploratory boards and leaders | 1,600 | ~1.5 h |
| **total** | | **~6-8 h** |

Runs are resumable (`scripts/strategy-lab.ts`). Results are written into this file as each
stage completes.

---

# Part 2 — Results (2026-09-27)

## Answer

**No committed strategy beats adaptive `hard`; the two that were distinct lose clearly.** Builder
loses 12.5 points of win share per side, and Court loses 30.5. Both gates stopped for futility at
800 games. Warlord failed its probe: it was not distinct from `hard`, which already opens as a
warlord. The mixed field (M1-M3) and the exploratory board and leader runs **were not run**. The
machine was needed, and the pip-menu regression found in parallel (docs/spikes/2026-09-pip-menu.md)
took priority. So Q3, transitivity, is **unanswered**, and Q2 rests on the gate games only.

Wall clock was ~2.5x the protocol's estimate: a 100-game probe took 12.5-16 min at 14 shards, and a
400-game chunk took 42-55 min at 13 shards.

## Probes (100 4p games each, seed 91000)

| strategy | unfinished | declares per seat-game (strat / `hard`) | plan share of declares (strat / `hard`) | Battle take rate (strat / `hard`) | Influence take rate (strat / `hard`) | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Warlord | 0 | 2.11 / 2.60 | **59.7% / 33.8%** (met) | 64.4% / 62.4% (+2.0, needed +5: **missed**) | 7.9% / 8.9% | **fail**: no gate |
| Builder | 0 | 2.23 / 2.51 | **71.1% / 13.3%** (met) | 64.4% / 63.1% (met) | 6.5% / 6.4% | pass |
| Court | 0 | 2.19 / 2.88 | **71.3% / 34.8%** (met) | 59.0% / 59.9% (met) | 9.6% / 6.9% | pass |

Declarations by ambition (Tycoon / Tyrant / Warlord / Keeper / Empath):

| probe | strategy | `hard` in the same games |
| --- | --- | --- |
| Warlord | 51 / 117 / 135 / 97 / 22 | 133 / 60 / 116 / 170 / 41 |
| Builder | 318 / 29 / 23 / 74 / 3 | 67 / 91 / 120 / 185 / 39 |
| Court | 49 / 29 / 48 / 198 / 115 | 158 / 105 / 112 / 175 / 25 |

Reading:

- **The commitment works: declarations follow the plan.** Builder declares Tycoon 318 times where
  `hard` declares it 67 times.
- **What the plans cannot move is the pip choice.** Battle take rates stay within 2 points of
  `hard`'s for every strategy. The pip-menu investigation (docs/spikes/2026-09-pip-menu.md) found
  why: every pip-menu option scores identically, so offer order picks the action. The plan's
  intent cannot reach that choice, and no overlay could have lifted Warlord's battle rate.
- **Committed strategies declare less often** (2.1-2.2 per seat-game against 2.5-2.9). They pass
  up declarations off their plan.

## Gates (4p, A,B,B,A, clustered by deal)

**Builder**: not detected, futility at 800 (z -3.83).

| chunk | games (deals) | Builder / `hard` wins per seat | win share Δ per side | power Δ per seat |
| --- | --- | --- | --- | --- |
| 0 | 400 (100) | 21.3% / 28.7% | -15.0 ± 4.8 (z -3.10) | -2.46 ± 0.49 (z -5.07) |
| 1 | 400 (100) | 22.5% / 27.5% | -10.0 ± 4.4 (z -2.28) | -1.73 ± 0.52 (z -3.30) |
| **pooled** | **800 (200)** | 21.9% / 28.1% | **-12.5 ± 3.3 (z -3.83)** | **-2.10 ± 0.36 (z -5.87)** |

**Court**: not detected, futility at 800 (z -9.40).

| chunk | games (deals) | Court / `hard` wins per seat | win share Δ per side | power Δ per seat |
| --- | --- | --- | --- | --- |
| 0 | 400 (100) | 18.3% / 31.8% | -27.0 ± 4.9 (z -5.52) | -4.36 ± 0.56 (z -7.75) |
| 1 | 400 (100) | 16.5% / 33.5% | -34.0 ± 4.3 (z -7.99) | -5.76 ± 0.44 (z -13.13) |
| **pooled** | **800 (200)** | 17.4% / 32.6% | **-30.5 ± 3.2 (z -9.40)** | **-5.06 ± 0.36 (z -14.09)** |

## Mixed field

**Not run.** It was stopped part-way at the user's request, with no outcomes saved; the arena
writes its file at the end. M1-M3 are untested.

## Setup-dependence — EXPLORATORY (gate games only; no tests)

Win share per seat-game. Each strategy is shown beside `hard` in the same games.

| split | cell | Builder | `hard` | Court | `hard` |
| --- | --- | --- | --- | --- | --- |
| seat | red (leads first) | 47.5% | 54.8% | 40.3% | 51.7% |
| seat | yellow | 20.8% | 27.8% | 11.8% | 36.0% |
| seat | blue | 8.8% | 17.8% | 10.0% | 21.0% |
| seat | white | 10.5% | 12.3% | 7.5% | 21.8% |
| plan-declaring cards in the opening hand | 0 | 21.9% (178) | 28.7% | 10.5% (38) | 28.9% |
| | 1 | 20.0% (514) | 29.8% | 18.4% (212) | 33.0% |
| | 2 | 23.7% (562) | 28.6% | 17.8% (528) | 35.0% |
| | 3+ | 21.7% (346) | 24.6% | 17.2% (822) | 31.1% |
| majority suit of the opening hand | Administration | 22.0% | 27.1% | 12.6% | 27.1% |
| | Aggression | 27.7% | 26.2% | 18.0% | 36.4% |
| | Construction | 21.8% | 27.7% | 15.3% | 33.7% |
| | Mobilization | 24.3% | 31.7% | 19.8% | 31.7% |
| | tied | 19.7% | 28.1% | 18.4% | 33.1% |

Cells are 400 seat-games per seat, and 200-800 per hand cell, as shown.

Reading:

- **No setup rescues a strategy.** The only cell where a strategy is level with `hard` is Builder
  with an Aggression-majority hand (+1.5 points, 206 seat-games). That lifts Builder 5.8 points
  over its own overall share, short of the pre-registered 10.
- **Holding the cards to declare the plan does not help the plan.** Builder's win share is flat
  across 0 to 3+ Tycoon-declaring cards, and Court's is flat across 1 to 3+.
- **The seat effect dwarfs everything here.** Red, which leads first, wins ~48-55% of these
  games. That is a property of the game and of Board4MixUp1, not of the bots.

## Recommendation: **stop**

This follows the fixed rule:

- **Not "ship"**: no gate passed.
- **Not "choose a plan per chapter"**: no setup cell met the rule. The best cell lifted a strategy
  5.8 points, not 10, and no strategy led `hard` anywhere that had 200 or more seat-games.
- **"Personalities" is not established.** Its criterion is the mixed field, which was not run. The
  gates suggest Builder might qualify, at 6.2 points per seat behind `hard` (21.9% against 28.1%),
  against the rule's 5. Court would not, at 15.2 behind.

**What would change it.** A mixed-field run in which Builder lands within 5 points per seat of
`hard` would make Builder a candidate personality: a Tycoon-first opponent that plays visibly
differently at a modest strength cost. The cost is ~1,600 games, about 3.5 h at 8 shards
(estimate). And if the pip-menu fix ships, the strategies should be re-measured on top of it. The
probes show the plans could not reach the pip choice. With it resolved, a Warlord's overlay (ships,
trophies, battles) can finally change what it does with its pips.
