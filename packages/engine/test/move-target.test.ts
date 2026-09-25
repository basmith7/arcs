/**
 * `moveToward` (spec 2026-09-23 rev 3, C1): Move destinations ranked by progress toward what the
 * chapter intent wants — and **only ranked**. The terms over one Move ask sum to zero, so the
 * feature can never make Move look better or worse than Build or Tax; that is the difference from
 * the positional pull `mobile.ts` records as measured worse.
 */

import { describe, expect, it } from 'vitest'

import { MOBILE_WEIGHTS, board, defaultRegistry, heuristicBotWith, intentFor, mobileBot, observe, startGame, stepBot, stepBots } from '../src/index.js'
import { feasibility } from '../src/ai/feasibility.js'
import { gateDistances, intentTargets, moveTowardTerms } from '../src/ai/move-target.js'
import type { Action, Ambition, ChapterIntent, FactionId, RuleResult } from '../src/index.js'

const reg = defaultRegistry()
const F: FactionId[] = ['red', 'yellow', 'blue', 'white']

const intentOf = (a: Ambition): ChapterIntent => ({
  pursuing: new Map<Ambition, number>([[a, 1]]),
  leading: a,
  summary: a,
})

/** Play normal bots until some faction faces a Move destination ask. */
function moveAsk(seed: number): RuleResult {
  let r = startGame({ board: 'Board4MixUp1', factions: F, seed, bots: F }, reg)
  for (let i = 0; i < 400; i++) {
    const c = r.continue
    if (c.kind === 'ask' && c.actions.filter((a) => a.type === 'action/move-pick').length >= 3) return r
    r = stepBots(r, F, mobileBot, 1, reg).result
  }
  throw new Error('no move ask reached')
}

describe('gateDistances', () => {
  const d = gateDistances(board('Board4MixUp1'))
  it('is zero on the diagonal and symmetric', () => {
    for (const [a, row] of d) {
      expect(row.get(a)).toBe(0)
      for (const [b, n] of row) expect(d.get(b)!.get(a)).toBe(n)
    }
  })
  it('is one between connected systems', () => {
    const b = board('Board4MixUp1')
    for (const s of b.systems) for (const n of b.adjacency.get(s) ?? []) expect(d.get(s)!.get(n)).toBe(1)
  })
})

describe('moveTowardTerms', () => {
  const r = moveAsk(12)
  const c = r.continue as { faction: FactionId; actions: readonly Action[] }
  const view = observe(r.state, c.faction)

  it('sums to zero over the Move destinations, and leaves every other action out', () => {
    for (const a of ['Tycoon', 'Keeper', 'Empath', 'Tyrant', 'Warlord'] as Ambition[]) {
      const terms = moveTowardTerms(view, c.faction, intentOf(a), c.actions)
      let sum = 0
      for (const [action, v] of terms) {
        expect(action.type).toBe('action/move-pick')
        sum += v
      }
      expect(Math.abs(sum)).toBeLessThan(1e-9)
      expect(terms.size).toBe(c.actions.filter((x) => x.type === 'action/move-pick').length)
    }
  })

  it('prefers the destination that closes on a target', () => {
    const d = gateDistances(view.board)
    const intent = intentOf('Tyrant')
    const targets = intentTargets(view, c.faction, intent).get('Tyrant') ?? []
    expect(targets.length).toBeGreaterThan(0)
    const terms = moveTowardTerms(view, c.faction, intent, c.actions)
    const near = (s: string): number => Math.min(...targets.map((t) => d.get(s)!.get(t) ?? 99))
    const ranked = [...terms].sort((a, b) => b[1] - a[1])
    const best = ranked[0]![0]
    const worst = ranked[ranked.length - 1]![0]
    const progress = (a: Action): number => near(String(a['from'])) - near(String(a['to']))
    expect(progress(best)).toBeGreaterThanOrEqual(progress(worst))
  })
})

describe('moveToward in the heuristic loop', () => {
  it('with a dominant weight, picks the destination the term ranks first', () => {
    const r = moveAsk(12)
    const c = r.continue as { faction: FactionId; actions: readonly Action[] }
    const view = observe(r.state, c.faction)
    const intent = intentFor(view, c.faction, feasibility)
    const terms = [...moveTowardTerms(view, c.faction, intent, c.actions)].sort((a, b) => b[1] - a[1])
    expect(terms[0]![1]).toBeGreaterThan(terms[terms.length - 1]![1])
    const bot = heuristicBotWith({ ...MOBILE_WEIGHTS, moveToward: 1000 }, 'toward', feasibility)
    const step = stepBot(r, bot, c.faction, reg)
    expect(step.decision.action).toEqual(terms[0]![0])
  })
})

describe('moveToward never pays for undoing a move', () => {
  it('gives a reversing leg no positive pull, however far it closes on a target', () => {
    const r = moveAsk(12)
    const c = r.continue as { faction: FactionId; actions: readonly Action[] }
    const view = observe(r.state, c.faction)
    const intent = intentFor(view, c.faction, feasibility)
    // Mark the leg the term likes best as the one that undoes a move.
    const plain = [...moveTowardTerms(view, c.faction, intent, c.actions)].sort((a, b) => b[1] - a[1])
    const [best, bestTerm] = plain[0]!
    expect(bestTerm).toBeGreaterThan(0)
    const terms = moveTowardTerms(view, c.faction, intent, c.actions, (a) => a === best)
    expect(terms.get(best)!).toBeLessThanOrEqual(0)
  })
})
