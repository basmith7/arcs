/**
 * `nearWin` (spec 2026-09-23 rev 3, C3): power is priced linearly straight through the win
 * threshold, so neither "I am one scoring from winning" nor "they are" registered. The feature is
 * zero far from the line and rises sharply inside the last six points of it — for self positively,
 * for the best rival negatively.
 */
import { describe, expect, it } from 'vitest'

import { defaultRegistry, featuresOf, intentFor, mobileBot, observe, startGame, stepBots } from '../src/index.js'
import { feasibility } from '../src/ai/feasibility.js'
import { projectedPower } from '../src/ai/value.js'
import type { FactionId, ObservedState } from '../src/index.js'

const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
const r = stepBots(startGame({ board: 'Board4MixUp1', factions: F, seed: 23, bots: F }, reg), F, mobileBot, 120, reg).result
const base = observe(r.state, 'red')
const withPower = (p: Partial<Record<FactionId, number>>): ObservedState => ({ ...base, power: { ...base.power, ...p } })
const near = (v: ObservedState): number => featuresOf(v, 'red', intentFor(v, 'red', feasibility)).nearWin

describe('nearWin', () => {
  // Four players: threshold 39 - 12 = 27, so the ramp starts at 21.
  it('is zero while everyone is far from the threshold', () => {
    expect(near(withPower({ red: 5, yellow: 5, blue: 5, white: 5 }))).toBe(0)
  })

  it('rises as self nears the threshold, and is capped by nothing but the square', () => {
    const a = near(withPower({ red: 23, yellow: 0, blue: 0, white: 0 }))
    const b = near(withPower({ red: 26, yellow: 0, blue: 0, white: 0 }))
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })

  it('goes negative when the best rival is the one near it', () => {
    expect(near(withPower({ red: 0, yellow: 25, blue: 0, white: 0 }))).toBeLessThan(0)
  })

  it('counts declared standing toward projected power', () => {
    const v = withPower({ red: 10 })
    expect(projectedPower(v, 'red')).toBeGreaterThanOrEqual(10)
  })
})
