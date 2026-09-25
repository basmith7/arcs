/**
 * `battleChoice` (C5): where to battle and whom to hit were chosen by offer order — 78% and 81% of
 * those decisions were exact ties in the tie audit. Zero-sum per ask, like `moveToward`.
 */
import { describe, expect, it } from 'vitest'

import { MOBILE_WEIGHTS, defaultRegistry, heuristicBotWith, intentFor, mobileBot, observe, startGame, stepBot, stepBots } from '../src/index.js'
import { feasibility } from '../src/ai/feasibility.js'
import { battleChoiceTerms } from '../src/ai/battle-choice.js'
import type { Action, FactionId, ObservedState } from '../src/index.js'

const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()

describe('battleChoiceTerms', () => {
  // A real position; the terms only read the board, so hand-built actions over it are enough.
  const r = stepBots(startGame({ board: 'Board4MixUp1', factions: F, seed: 51, bots: F }, reg), F, mobileBot, 200, reg).result
  const v: ObservedState = observe(r.state, 'red')
  const intent = intentFor(v, 'red', feasibility)
  const sys = (s: string): Action => ({ type: 'battle/system', faction: 'red', system: s })
  const tgt = (e: string): Action => ({ type: 'battle/target', faction: 'red', system: v.board.systems[0]!, enemy: e })

  it('sums to zero within each kind of ask and ignores everything else', () => {
    const acts = [...v.board.systems.slice(0, 4).map(sys), { type: 'action/skip', faction: 'red' } as Action]
    const t = battleChoiceTerms(v, 'red', intent, acts)
    expect(t.size).toBe(4)
    expect(Math.abs([...t.values()].reduce((a, b) => a + b, 0))).toBeLessThan(1e-9)
    const u = battleChoiceTerms(v, 'red', intent, [tgt('yellow'), tgt('blue'), tgt('white')])
    expect(Math.abs([...u.values()].reduce((a, b) => a + b, 0))).toBeLessThan(1e-9)
  })

  it('prefers hitting the rival with the most power', () => {
    const rich: ObservedState = { ...v, power: { red: 0, yellow: 2, blue: 20, white: 5 } }
    const u = battleChoiceTerms(rich, 'red', intent, [tgt('yellow'), tgt('blue'), tgt('white')])
    const best = [...u].sort((a, b) => b[1] - a[1])[0]![0]
    expect(best['enemy']).toBe('blue')
  })
})

describe('battleChoice in the heuristic loop', () => {
  it('with a dominant weight, battles where the term ranks first — even against the default pick', () => {
    const bot = heuristicBotWith({ ...MOBILE_WEIGHTS, battleChoice: 1000 }, 'bc', feasibility)
    let checked = 0
    for (const seed of [52, 53, 54, 55, 56, 57]) {
      let r = startGame({ board: 'Board4MixUp1', factions: F, seed, bots: F }, reg)
      for (let i = 0; i < 6000 && !r.state.isOver; i++) {
        const c = r.continue
        if (c.kind === 'ask' && c.actions.filter((a) => a.type === 'battle/system').length >= 2) {
          const view = observe(r.state, c.faction)
          const terms = [...battleChoiceTerms(view, c.faction, intentFor(view, c.faction, feasibility), c.actions)].sort(
            (a, b) => b[1] - a[1],
          )
          const plain = stepBot(r, mobileBot, c.faction, reg).decision.action
          if (terms[0]![1] > terms[1]![1] && plain !== terms[0]![0]) {
            expect(stepBot(r, bot, c.faction, reg).decision.action).toEqual(terms[0]![0])
            checked++
            if (checked >= 2) return
          }
        }
        r = stepBots(r, F, mobileBot, 1, reg).result
      }
    }
    expect(checked).toBeGreaterThan(0)
  }, 600_000)
})
