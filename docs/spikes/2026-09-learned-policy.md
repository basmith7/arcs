# Spike: a learned playout policy — step A (2026-09-26)

Branch `spike/learned-policy` (kept on origin, not merged; this report copied to main 2026-09-29).
Follows docs/spikes/2026-09-engine-speed.md; plan revised after a Fable adversarial review (session
ff593673). Step A asks whether §3i's interventional-pair label, averaged over enough cheap
playouts, becomes learnable.

## Setup

- 42 4p games (Board4MixUp1, seeds 700000+), walked by `normal`.
- Every 40th decision with ≥2 offers: the first and last offered action (as §3i).
- Each branch was played to the end 370 times with `playoutFrom` under `playoutChoice`. Salt k
  redeals what the mover cannot see and fixes the dice; both branches share it (common random
  numbers).
- Label = mean over salts of (mover's margin over the best rival in branch A) minus (the same in
  branch B).
- Features are §3i's: the `featuresOf` difference between the two branches.
- 1,024 pairs, ~6 core-hours, 14 cores.
- **857 pairs were kept**: those with ≥300 salts where both branches finished. 167 were dropped
  for stalls, mostly `action/take` vs `turn/end`, which is `playoutChoice` livelocking.
- Code: `scripts/spike/pairs-collect.ts`, `pairs-fit.py`, `pairs-context.ts`, `pairs-within.py`.

## Pre-registered result (committed in d00023d before any row existed): INCONCLUSIVE

The pre-registered test was the held-out R² of a ridge fit of the averaged label on the feature
differences, split by game: signal ≥ 0.05, none < 0.01.

| playouts per branch | label SE (power) | held-out R², features | held-out R², action-type pair only |
| --- | --- | --- | --- |
| 1 (§3i) | 11.41 | 0.005 | 0.015 |
| 2 | 8.07 | 0.011 | 0.041 |
| 10 | 3.61 | 0.014 | 0.075 |
| 50 | 1.61 | 0.032 | 0.239 |
| 370 | 0.60 | **0.032** | 0.256 |

- **Reliability.** Split-half reliability of the 370-playout label is **0.976**, so averaging
  removes the noise §3i hit.
- **Features.** The evaluator's features explain 3% of it. In 38% of pairs the two branches have
  identical features (the action only opens a sub-ask).
- **Action type.** Most of what is predictable is the action-type pair, and that is mostly one
  fact. `turn/lead` vs `turn/pass` averages **+7.1** power (n=63). Every other common pair averages
  within ±0.6.

## Exploratory (not pre-registered): nothing within types

The question was whether position context predicts the label within an action-type pair.
Context: `featuresOf` at the position (39), chapter, round, power rank, gap to the best rival, and
menu size. Each is interacted with the 8 common pair types, alongside the feature differences.
Same split, and ridge was chosen by CV grouped by game.

| model | held-out R², all | all pairs except lead/pass |
| --- | --- | --- |
| type only | 0.249 | 0.013 |
| type × context | 0.260 | 0.000 |
| type × (context + feature diff) | 0.195 | 0.011 |

No pair type reaches a positive held-out R² above 0.08. The labels have reliable spread within
types: SD 1.4-4.2 against an SE of 0.6. None of it is linearly predictable from position context
at this size (604 training pairs).

## Reading

- **Cheap averaged playouts give clean labels, but the only learnable content found is "leading
  beats passing".** That is what a priority-list policy rewards, so it may be `playoutChoice`'s
  bias as much as the truth.
- **The within-type variation is real but unexplained.** It may be nonlinear, it may need far more
  data, or it may be idiosyncratic to `playoutChoice`.

This does not show that cheap labels are enough to train a learned evaluator. The case for a
better rollout policy (step B) stands, but step A gives it no positive evidence either.

## Limits

- The models are linear, with 604 training pairs.
- The candidate pairs are §3i's first-and-last-offered, which over-samples pass and skip.
- There was one walker (`normal`) and 4p only.
- The dropped stalled pairs are a selection effect, though mostly low-stakes choices.
