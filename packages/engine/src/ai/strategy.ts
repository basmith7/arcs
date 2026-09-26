/**
 * Committed strategies: `hard`'s search with a fixed plan instead of an adaptive one
 * (docs/spikes/2026-09-strategies.md).
 *
 * `hard` has one plan, re-derived at every decision by `intentFor` from what the board supports. A
 * strategy replaces that intent with a fixed one — most of the weight on the plan's ambitions, split
 * evenly — and leans the evaluator toward the pieces the plan is built from with a weight overlay
 * (ships and trophies, cities and income, court claims).
 *
 * ## Still derived, never remembered (docs/19 §2b)
 *
 * The plan is part of the bot's *configuration*, like its weights, not something it decided and
 * stored. `committedIntent` is a pure function of the observation, so a reloaded game and a second
 * multiplayer client compute the same intent.
 *
 * ## It does not move within a turn — stricter than `hard`
 *
 * A first version tilted `feasibility` instead (plan ambitions' fitness x4, the rest /4). Over four
 * 4p games that intent moved between two of the bot's own same-turn decisions in 7-9% of pairs —
 * as often as `hard`'s own (9%), because both read cities, ships and trophies, which the bot's own
 * pips change. So the plan reads only one thing: **which of its ambitions can still score this
 * chapter** — declared, or a marker still left to declare into. That changes only when a marker is
 * placed, at most once per declaration.
 *
 * ## Falling back when the plan is impossible
 *
 * If none of the plan's ambitions can score this chapter (all undeclared and no marker left), the
 * bot plays `hard`'s own adaptive intent for the rest of the chapter: it scores what can be scored.
 * If some can, the plan's weight goes to those alone.
 */
import { feasibility } from './feasibility.js'
import { intentFor } from './intent.js'
import { HARD_WEIGHTS } from './levels.js'
import { searchBot } from './search.js'
import { AMBITIONS } from '../state.js'
import type { Bot } from './bot.js'
import type { ChapterIntent, IntentFn } from './intent.js'
import type { Weights } from './value.js'
import type { Ambition } from '../state.js'

export interface Strategy {
  readonly name: string
  /** The ambitions this strategy plays for. */
  readonly plan: readonly Ambition[]
  /** Overrides on `HARD_WEIGHTS`. */
  readonly overlay: Partial<Weights>
}

/**
 * The three committed plans. Each overlay stays within 1.5x of `hard`'s weights: the point is a
 * distinct plan, not a broken evaluator.
 */
export const STRATEGIES: Readonly<Record<string, Strategy>> = {
  /** Fight early, capture and destroy: trophies and captives are the plan's resources. */
  warlord: {
    name: 'warlord',
    plan: ['Warlord', 'Tyrant'],
    overlay: { trophies: 0.45, captives: 0.45, shipsFresh: 0.5, battleUnlocked: 0.9 },
  },
  /** Cities on the right planets, taxed into Material and Fuel. */
  builder: {
    name: 'builder',
    plan: ['Tycoon'],
    overlay: { cities: 2.5, starports: 1.5, incomeDeclared: 1.2, incomeUndeclared: 0.33 },
  },
  /** Influence and secure court cards; Relics and Psionics. */
  court: {
    name: 'court',
    plan: ['Keeper', 'Empath'],
    overlay: { courtSecured: 1.5, courtClaimAhead: 0.4, courtClaimLevel: 0.18, courtClaimBehind: 0.08 },
  },
}

/** Share of the intent the plan holds while it can still score. The rest is spread evenly. */
export const DEFAULT_COMMITMENT = 0.85

export function committedIntent(plan: readonly Ambition[], commitment = DEFAULT_COMMITMENT): IntentFn {
  return (observed, self): ChapterIntent => {
    const declared = new Set(observed.declared.map((d) => d.ambition))
    const open = observed.ambitionable.length > 0
    const live = plan.filter((a) => open || declared.has(a))
    if (live.length === 0) return intentFor(observed, self, feasibility)
    const rest = AMBITIONS.filter((a) => !live.includes(a))
    const pursuing = new Map<Ambition, number>()
    for (const a of AMBITIONS) {
      pursuing.set(a, live.includes(a) ? commitment / live.length : (1 - commitment) / rest.length)
    }
    const leading = live[0]!
    return {
      pursuing,
      leading,
      summary: `committed to ${live.join(' and ')} (${declared.has(leading) ? 'declared' : 'undeclared'})`,
    }
  }
}

/** `hard` exactly as `levels.ts` builds it, playing a committed strategy. */
export function strategyBot(name: string, commitment = DEFAULT_COMMITMENT): Bot {
  const s = STRATEGIES[name]
  if (s === undefined) throw new Error(`no strategy named ${name} (have: ${Object.keys(STRATEGIES).join(', ')})`)
  const bot = searchBot({
    width: 3,
    depth: 14,
    replies: { roots: 1, deals: 1 },
    weights: { ...HARD_WEIGHTS, ...s.overlay },
    intent: committedIntent(s.plan, commitment),
  })
  return { ...bot, id: `strat-${name}${commitment === DEFAULT_COMMITMENT ? '' : `-c${commitment}`}` }
}
