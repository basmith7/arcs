/**
 * The weekend lab's three action-level terms (docs/19 §24): each ranks options the evaluator scores
 * level, found by the coverage report and the tie audit.
 *   - garrison (C6): how many ships to move — keep enough home to face nearby rival ships.
 *   - takeMove (C7): at the pip menu, a small nudge toward Move when a fleet can close on a target.
 *   - guildUse (C8): a bonus for a guild Prelude ability, which the bot never used.
 */
import { describe, expect, it } from 'vitest'

import { defaultRegistry, intentFor, mobileBot, observe, startGame, stepBots } from '../src/index.js'
import { feasibility } from '../src/ai/feasibility.js'
import { garrisonTerms, guildUseTerms, takeMoveTerms } from '../src/ai/action-terms.js'
import { figuresOf } from '../src/figure-index.js'
import type { Action, FactionId, ObservedState } from '../src/index.js'

const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
const r = stepBots(startGame({ board: 'Board4MixUp1', factions: F, seed: 71, bots: F }, reg), F, mobileBot, 250, reg).result
const v: ObservedState = observe(r.state, 'red')
const intent = intentFor(v, 'red', feasibility)

describe('garrisonTerms', () => {
  it('is zero-sum over one fleet-size ask and leaves other actions out', () => {
    const home = figuresOf(v.figures, v.board.systems, 'red', 'Ship')[0]!.system
    const n = figuresOf(v.figures, v.board.systems, 'red', 'Ship').filter((p) => p.system === home).length
    const acts: Action[] = [...Array(n).keys()].map((i) => ({ type: 'action/move-ships', faction: 'red', from: home, to: 'x', count: n - i }))
    const t = garrisonTerms(v, 'red', intent, [...acts, { type: 'action/skip', faction: 'red' }])
    expect(t.size).toBe(n)
    expect(Math.abs([...t.values()].reduce((a, b) => a + b, 0))).toBeLessThan(1e-9)
  })

  it('never prefers moving more ships when a building at home faces rival ships', () => {
    // A synthetic threat: red's buildings' system, with a large yellow fleet claimed next door.
    const city = figuresOf(v.figures, v.board.systems, 'red', 'City')[0]!.system
    const acts: Action[] = [3, 2, 1].map((c) => ({ type: 'action/move-ships', faction: 'red', from: city, to: 'x', count: c }))
    const t = garrisonTerms(v, 'red', intent, acts, () => 5)
    const vals = acts.map((a) => t.get(a)!)
    expect(vals[0]!).toBeLessThanOrEqual(vals[1]!)
    expect(vals[1]!).toBeLessThanOrEqual(vals[2]!)
  })
})

describe('takeMoveTerms', () => {
  it('touches only the Move entry of a pip menu, and never negatively', () => {
    const menu: Action[] = ['Tax', 'Build', 'Move', 'Repair'].map((a) => ({ type: 'action/take', faction: 'red', action: a }))
    const t = takeMoveTerms(v, 'red', intent, menu)
    for (const [a, x] of t) {
      expect(a['action']).toBe('Move')
      expect(x).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('guildUseTerms', () => {
  it('gives each guild Prelude ability 1 and nothing else anything', () => {
    const acts: Action[] = [
      { type: 'turn/prelude-guild', faction: 'red', ability: 'ships', card: 'bc13' },
      { type: 'turn/prelude-done', faction: 'red' },
    ]
    const t = guildUseTerms(v, 'red', intent, acts)
    expect(t.get(acts[0]!)).toBe(1)
    expect(t.has(acts[1]!)).toBe(false)
  })
})

describe('the heuristic applies the lab terms', () => {
  it('with a dominant guildUse weight, takes a guild ability when one is offered', async () => {
    const { MOBILE_WEIGHTS, heuristicBotWith, stepBot } = await import('../src/index.js')
    const bot = heuristicBotWith({ ...MOBILE_WEIGHTS, guildUse: 1000 }, 'g', feasibility)
    for (const seed of [72, 73, 74, 75, 76, 77, 78, 79]) {
      let g = startGame({ board: 'Board4MixUp1', factions: F, seed, bots: F }, reg)
      for (let i = 0; i < 4000 && !g.state.isOver; i++) {
        const c = g.continue
        if (c.kind === 'ask' && c.actions.some((a) => a.type === 'turn/prelude-guild')) {
          expect(stepBot(g, bot, c.faction, reg).decision.action.type).toBe('turn/prelude-guild')
          return
        }
        g = stepBots(g, F, mobileBot, 1, reg).result
      }
    }
    throw new Error('fixture: no guild Prelude offered in eight games')
  }, 600_000)
})
