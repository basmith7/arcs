# Experiment: do committed strategies beat adaptive `hard`? (2026-09-26)

Branch `exp/strategies` (from `feat/weekend-lab` d90a0ea), worktree `~/Projects/arcs-strategies`.
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
