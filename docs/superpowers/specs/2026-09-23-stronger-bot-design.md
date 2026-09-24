# A stronger Arcs bot, and an advisor — design

Date: 2026-09-23. Branch `feat/stronger-bot`. Base game only (no Leaders & Lore, no campaign).

## 1. Goal and success criteria

Brian wants two things from one piece of work:

1. **A stronger opponent** — a `brutal` rung above `hard` for bot seats.
2. **An advisor** — "what should red do?" for a seat a human is playing in a live game, with the
   alternatives and their odds, allowed to think for a minute or two.

"Better" is measured, never argued. The instrument is the existing arena (`npm run arena`) with its
twin noise floor (`--noise`), per docs/19 section 0.

- **Ship gate for `brutal`:** beats `hard` in a 4-player arena of ≥ 600 games **and** a 2-player
  arena of ≥ 600 games, each by more than that run's own twin gap, on both win rate and mean
  power. 4-player is the primary target because that is the game Brian plays.
- **Latency gate for `brutal`:** median card-play decision ≤ 3 s and p95 ≤ 10 s on one core of
  Brian's desktop, measured over a 4-player game; non-card-play decisions no slower than `hard`.
- **Advisor gate:** on a replayed position it returns within 3 minutes at its default budget, its
  top pick agrees with itself across two runs (determinism), and its budget is strictly a
  superset of `brutal`'s (so the advisor is never weaker than the opponent).
- **Every intermediate idea** (sections 4-6) ships only if it clears its own arena gate; a null is
  recorded in docs/19 section 0 and the code is left at weight zero / off, the repo's convention.

"Knowing all parts of the base game" is interpreted as: every base-game decision the engine can ask
is reachable by the bot's search or rollouts, and the two base-game blind spots in the evaluator
that docs/19 records as open — **court card text** and **ship position** — each get a measured
attempt. Coverage is audited in section 7.

## 2. What exists, and the fact that reshapes the plan

The bots are a hand-weighted linear evaluator (`value.ts`) with chapter intent (`intent.ts`);
`normal` is a one-ply search over it, `hard` adds a whole-turn beam at the card play plus one
sampled rival reply (`search.ts`, `levels.ts`). docs/19 section 0 lists ~20 measured attempts to beat
that; the only large win was the reply search. Section 17 found that **full-game rollouts are a
better judge of card plays than the evaluator** (the bot's own runner-up was better by ~5% win
probability per decision in lost games, z ≈ 4.3) but called it unshippable at ~70 s per decision.

**New measurement (this session):** a 4-player game between `normal` bots takes **105 s and 1,034
decisions — ~100 ms a decision, not the ~4 ms docs/19 records.** The CPU profile:

| inclusive | where |
| --- | --- |
| 88% | `featuresOf` — the evaluator, not the rules |
| 44.5% self | `parseFigureId` — re-parsing interned figure strings |
| 40% | `metric` / `rivalHoldings` (ambition standings, recomputed per probe) |
| 28% | `slotsOf` / `citiesInReserve` scans |
| 16% self | `Tracker.contentsOf` |

The rules engine is cheap; the bot's scoring is where every playout's time goes. That makes speed
the first lever, and it is a lever the register never pulled: every earlier rollout experiment
(sections 3a-3e) was forced onto trivial playout policies *because* a real policy was too slow, and
section 3e's verdict was "short lookahead with a good policy beats long lookahead with a bad one."
A 10x cheaper evaluator makes a good policy affordable inside a rollout.

## 3. Step 1 — make the evaluator cheap (pure engineering)

Behaviour-preserving optimisation of the hot path, in profile order, re-profiling after each:

1. **Memoise `parseFigureId`** — a module-level `Map<string, Figure>`; figure ids are a small closed
   set (~300 in a 4p game), the function is pure, results are frozen.
2. **Per-observation caches** for quantities `featuresOf` recomputes per term: ambition metrics per
   faction (`metric`, `rivalHoldings`), slot/reserve counts, own pieces by system. Cached on the
   `ObservedState` object via a `WeakMap`, so nothing about the immutable-state contract changes.
3. Only then, if still dominant, `Tracker` internals.

**Correctness gate (hard requirement):** a golden test plays N seeded games (2p and 4p, `normal`
and `hard`) before and after, and asserts the **identical journal** and final power. Any float
reassociation that changes a tie-break is a failure, not a rounding note. The existing test suite
must pass unchanged.

**Target:** ≥ 5x on a `normal` 4-player game. Recorded in docs/19 alongside the stale 4 ms figure.

## 4. Step 2 — the rollout re-rank (`oracle` bot)

A new bot, `oracleBot(options)`, in `ai/oracle.ts`:

- At a **card play** only (`isCardPlay`, the trigger `search.ts` and `rollout.ts` already share),
  run `hard`'s search to rank the roots. Take the top `k` distinct roots (default 3) plus `Pass`
  when the engine offers it and it is not already included — the section 18/20 blunders were a
  missing Pass.
- For each candidate, play the game forward `m` times (default 8) under a **real policy**
  (`normal` for every seat, including our own, after the candidate), to one of two horizons:
  `game` (the end; score = 1 for a win, 0.5 split for a tied win, 0 otherwise, plus a small
  power-margin term to break ties among lost lines) or `chapter` (chapter end, then score with
  `valueOf` — cheaper, used by the opponent rung if `game` cannot meet the latency gate).
- **Hidden information:** each playout redeals the unknown cards — rivals' hands and the deck —
  consistently with what `self` can see, the same determinisation `foresee` already does for
  replies. The bot must never read a rival's actual hand; a test pins this by running the bot on
  two states that differ only in a rival's hidden hand and asserting the same decision.
- **Common random numbers:** playout `j` uses the same derived seed for every candidate, so the
  comparison is paired and the variance of the *difference* is what matters.
- **Determinism:** seeds derive from the game's RNG state and the decision's turn key, never from
  the clock, so two clients compute the same move (docs/03 section 9a).
- **Decision rule:** the candidate with the best mean score; ties keep `hard`'s order. With the
  paired design, a candidate that does not beat `hard`'s own choice by a margin (default: one
  standard error of the paired difference) does not displace it — this keeps rollout noise from
  overriding a good evaluator pick.
- Everything that is not a card play delegates to `hard`.

Budget knobs `k`, `m`, horizon and playout policy are in the options and in the arena `BotSpec`, so
every configuration is an arena one-liner.

**Why this is not a repeat of sections 3a-3e:** those used trivial or `playoutChoice` policies
from 2 turns to chapter end, forced by cost; this uses the shipped `normal` policy, re-ranks only
`hard`'s shortlist (so the rollouts adjudicate close calls rather than generate plays), and is
motivated by section 17's direct evidence that exactly this adjudication finds better moves. If it
measures null anyway, that is recorded and step 3-4 still stand on their own.

**Gates:** (a) the oracle at advisor budget (`game` horizon, k=3, m=16) beats `hard` in a 2-player
arena of 300 games past its twin floor — the go/no-go for the idea; (b) a budget meeting the
latency gate clears the section 1 ship gate. If (a) passes and (b) cannot, the oracle ships as the
advisor only.

## 5. Step 3 — court cards by what they do

`courtWorth` prices a card by suit and keys; no card text is read. Fix it with a **measured
per-card table** instead of hand-written numbers:

- An offline script, `scripts/card-values.ts`, estimates for each of the 31 base court cards the
  value of *holding* it: from sampled mid-game positions (drawn from arena games), compare rollouts
  where `self` secures the card against rollouts where it does not, paired, under the `normal`
  policy. Output: `ai/court-values.json`, card id → power-equivalent bonus, with its standard error.
- `value.ts` gains a `courtText` feature: the table's bonus for each secured card (and a discounted
  share for a card `self` is ahead on influencing), weight 0 in `WEIGHTS`, switched on by a
  `CARD_WEIGHTS` set — the frozen-baseline convention.
- Cards whose estimate is inside its own standard error get 0, so noise is not baked in.

**Gate:** `hard`-with-`CARD_WEIGHTS` beats `hard` at 4p past the twin floor. If it passes it is
folded into `brutal`; either way the table and the method are recorded.

Jev (TypeSafe) is **not** used: the rollout table measures what each card does in this engine,
which a language model reading the card text can only guess at, and it keeps the engine free of
network calls. Noted as an alternative, not pursued.

## 6. Step 4 — ships that go somewhere

`gatesHeld`/`fleetThreat` exist at weight 0; a general "pull" toward everything measured worse
(mobile.ts). The new attempt is **goal-directed and tactical**, as one feature family, off by
default:

- `targetDistance`: for each ambition `intent` pursues, the gate-distance from `self`'s nearest
  fleet to the nearest system that would advance it — an unruled planet of a needed resource
  (Tycoon/Keeper/Empath), a rival city or starport to raid for captives/trophies (Tyrant/Warlord).
  Priced as the negative of distance, weighted by the pursuit strength, capped at 3 gates.
- `battleEdge`: for each adjacent-or-same system with rival pieces, the expected hits
  differential of attacking with the ships there at the dice we can roll — only when we hold or
  can play Aggression, so it is a real option, not a daydream.

Built behind `SHIP_WEIGHTS`, the move-probe peek that `mobile.ts` records as needed (a Move pick
does not move ships until the fleet-size step) is reinstated **only inside this feature's probe**,
so it cannot leak into `battleUnlocked` the way the earlier attempt did.

**Gate:** `normal`-with-`SHIP_WEIGHTS` beats `normal` at 4p past the twin floor, no unfinished-game
regression, and move reversals stay at zero. Then re-measured inside `hard`.

## 7. Step 5 — assemble `brutal`, coverage audit, and the advisor

**`brutal`** = `oracleBot` over a `hard` that uses whichever of `CARD_WEIGHTS` / `SHIP_WEIGHTS`
passed, at the largest budget meeting the latency gate. Added to `BOT_LEVELS` only if it clears the
ship gate. Because the server runs bots on its event loop (`gate.ts` `runBots`), a `brutal` seat
runs `stepBot` in a `worker_threads` worker there, so a 3 s think does not stall other games; the
web client already runs bots off the render path via its pacing loop, and a brutal game in the
browser is acceptable at this latency. If the ship gate fails, `BOT_LEVELS` is untouched.

**Coverage audit:** a test walks every `Action['type']` the base game's rule modules can ask
(enumerated from the modules' `Continue.ask` sites) and asserts each is exercised by at least one
arena game under `brutal` — a bot that never takes an action type (e.g. never Repairs, never
battles) is a blind spot made visible. Gaps found are recorded in docs/19, not necessarily fixed.

**Advisor** — `scripts/advise.ts`, `npm run advise -- <gameId|save.json> <faction> [--budget]`:

- Source: a save file, or a live game id fetched read-only over `ssh tower sqlite3` (options +
  journal, `-readonly`). No writes to the prod DB, no network calls from the engine.
- Replays, checks it is `faction`'s decision, and if it is a card play runs `oracleBot` at advisor
  budget; otherwise `hard`. Then continues the recommended line through the rest of the turn with
  the same bot, printing each step.
- Output: the recommended line; every candidate card play with its oracle win rate ± se and `hard`'s
  score; the intent summary. Plain text, readable in a terminal.
- If it is not `faction`'s turn it says whose it is and exits 0.

## 8. Out of scope

Leaders & Lore and campaign tuning (the bot must still *run* there — tests keep it working — but
nothing is measured there); a learned/neural evaluator (docs/19's remaining big idea; the oracle's
output is logged in a form a later distillation can train on, and that is all); UI for the advisor;
changing `normal`/`easy`/`hard` behaviour except via a feature that passed its gate.

## 9. Risks

- **The oracle measures null** like every other rollout. Then the advisor still ships (it is at
  worst `hard` with a second opinion attached) and steps 3-4 carry `brutal`.
- **Speedups change behaviour** via float order or iteration order. Mitigated by the golden-journal
  gate in step 1.
- **Arena compute.** Oracle games are expensive; 600 4p games at advisor budget may be days.
  Mitigated by measuring the idea at 2p first (gate 4a) and the opponent budget at 4p, with
  `--jobs 14` on the 16-core desktop.
- **Determinism across clients** — rollouts are a new source of hidden state; pinned by tests
  (same state ⇒ same move; hidden-hand independence).
