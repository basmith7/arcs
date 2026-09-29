/**
 * The pip menu tie (docs/19 §2j, regressed): every sub-ask inside a pip carries the remaining pips in
 * its continuation, so `settle` stopped at it and Battle, Move and Secure all scored the same.
 * `Bot.settleSubflows` restores §2j's resolution, opt-in.
 */
import { describe, expect, it } from 'vitest'

import { NO_ASKS, botToAct, defaultRegistry, mobileBot, startGame, stepBot } from '../src/index.js'
import type { AskedThisTurn, FactionId, RuleResult } from '../src/index.js'

const reg = defaultRegistry()
const F: FactionId[] = ['red', 'yellow', 'blue', 'white']

/** The first pip menu offering at least two standard actions, reached by `normal` play. */
function firstPipMenu(): { at: RuleResult; asked: AskedThisTurn; faction: FactionId } {
  let r: RuleResult = startGame({ board: 'Board4MixUp1', factions: F, seed: 93001, bots: F }, reg)
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < 400; i++) {
    const f = botToAct(r, F)!
    if (r.continue.kind === 'ask' && r.continue.actions.filter((a) => a.type === 'action/take').length >= 2) {
      return { at: r, asked, faction: f }
    }
    const s = stepBot(r, mobileBot, f, reg, asked)
    r = s.result
    asked = s.asked
  }
  throw new Error('no pip menu reached')
}

const takeScores = (bot: typeof mobileBot): number[] => {
  const { at, asked, faction } = firstPipMenu()
  const d = stepBot(at, bot, faction, reg, asked).decision
  return (d.considered ?? []).filter((c) => c.action.type === 'action/take').map((c) => c.score)
}

describe('settleSubflows', () => {
  it('by default every pip-menu option ties — the regression, pinned so a fix to the default is noticed', () => {
    const scores = takeScores(mobileBot)
    expect(scores.length).toBeGreaterThanOrEqual(2)
    expect(new Set(scores).size).toBe(1)
  })

  it('with it on, the options are scored by what their sub-flow does', () => {
    const scores = takeScores({ ...mobileBot, settleSubflows: true })
    expect(new Set(scores).size).toBeGreaterThan(1)
  })
})
