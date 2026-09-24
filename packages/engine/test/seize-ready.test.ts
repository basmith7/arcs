/**
 * `seizeReady` (C4): `declareReadiness` asks "do I lead next?" through `initiativeOrder`, which only
 * moves at round end — so a seize, which is *how* a follower takes the next lead, scored as a pure
 * card loss and `hard` never seized in 3,279 offers (docs/19 §22). This feature is the readiness the
 * seize buys: zero unless `self` holds the seize.
 */
import { describe, expect, it } from 'vitest'

import { defaultRegistry, featuresOf, intentFor, mobileBot, observe, startGame, stepBots } from '../src/index.js'
import { feasibility } from '../src/ai/feasibility.js'
import type { Ambition, ChapterIntent, FactionId, ObservedState } from '../src/index.js'

const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()

/** A mid-round position where red follows and holds a card that could declare. */
function following(): ObservedState {
  let r = startGame({ board: 'Board4MixUp1', factions: F, seed: 41, bots: F }, reg)
  for (let i = 0; i < 2000; i++) {
    const v = observe(r.state, 'red')
    if (v.lead !== undefined && v.initiativeOrder[0] !== 'red' && v.ambitionable.length > 0 && v.hand.length > 1) return v
    r = stepBots(r, F, mobileBot, 1, reg).result
  }
  throw new Error('fixture: no following position')
}

const wanting = (a: Ambition): ChapterIntent => ({ pursuing: new Map([[a, 1]]), leading: a, summary: a })

describe('seizeReady', () => {
  const v = following()
  const want = (['Tycoon', 'Tyrant', 'Warlord', 'Keeper', 'Empath'] as Ambition[]).find(
    (a) => featuresOf({ ...v, seized: 'red' }, 'red', wanting(a)).seizeReady > 0,
  )

  it('is zero when nobody has seized, or a rival has', () => {
    expect(featuresOf({ ...v, seized: undefined }, 'red', intentFor(v, 'red', feasibility)).seizeReady).toBe(0)
    expect(featuresOf({ ...v, seized: 'yellow' }, 'red', wanting(want ?? 'Tycoon')).seizeReady).toBe(0)
  })

  it('is positive once self holds the seize and has a card that declares what it wants', () => {
    expect(want).toBeDefined()
  })
})
