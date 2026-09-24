/**
 * The speed work's caches (docs/19 section 21). Each must be invisible: the same answers as the
 * uncached computation, for every faction, and no way for a caller to corrupt a shared result.
 */

import { describe, expect, it } from 'vitest'

import { AMBITIONS, defaultRegistry, mobileBot, observe, startGame, stepBots } from '../src/index.js'
import { Location, parseFigureId } from '../src/ids.js'
import { contentsOf } from '../src/tracker.js'
import { colorsIn, figuresOf } from '../src/figure-index.js'
import { metric, metricUncached } from '../src/rules/ambitions.js'
import { slotsOf, slotsOfUncached } from '../src/control.js'
import { featuresOf, featuresOfUncached, positionalUncached } from '../src/ai/value.js'
import { intentFor } from '../src/ai/intent.js'
import { feasibility } from '../src/ai/feasibility.js'
import type { FactionId } from '../src/index.js'

describe('parseFigureId memo', () => {
  it('returns one shared, frozen result per id', () => {
    const a = parseFigureId('red/Ship/3')
    expect(a).toEqual({ color: 'red', piece: 'Ship', index: 3 })
    expect(parseFigureId('red/Ship/3')).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('still rejects a malformed id, every time', () => {
    expect(() => parseFigureId('red/Ship')).toThrow(/malformed/)
    expect(() => parseFigureId('red/Ship')).toThrow(/malformed/)
  })
})

describe('per-state caches', () => {
  const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
  const reg = defaultRegistry()
  const r = stepBots(startGame({ board: 'Board4MixUp1', factions: F, seed: 4, bots: F }, reg), F, mobileBot, 250, reg).result

  it('metric agrees with the uncached computation for every faction and ambition, both views', () => {
    for (const view of [r.state, observe(r.state, 'red')]) {
      for (const f of F) {
        for (const a of AMBITIONS) {
          // Twice: the second read is the cached one.
          expect(metric(view, f, a)).toBe(metricUncached(view, f, a))
          expect(metric(view, f, a)).toBe(metricUncached(view, f, a))
        }
      }
    }
  })

  it('slotsOf agrees per faction, and a caller cannot corrupt the cached list', () => {
    for (const f of F) {
      expect(slotsOf(r.state, f)).toEqual(slotsOfUncached(r.state, f))
      expect(Object.isFrozen(slotsOf(r.state, f))).toBe(true)
    }
    expect(slotsOf(r.state, 'red')).not.toEqual(slotsOf(r.state, 'yellow'))
  })
})

describe('featuresOf cache', () => {
  const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
  const reg = defaultRegistry()
  const r = stepBots(startGame({ board: 'Board4MixUp1', factions: F, seed: 6, bots: F }, reg), F, mobileBot, 300, reg).result
  const view = observe(r.state, 'red')

  it('agrees with the uncached features per faction and per intent object', () => {
    const intents = F.map((f) => intentFor(view, f, feasibility))
    for (const f of F) {
      for (const intent of intents) {
        expect(featuresOf(view, f, intent)).toEqual(featuresOfUncached(view, f, intent))
        expect(featuresOf(view, f, intent)).toEqual(featuresOfUncached(view, f, intent))
      }
    }
  })

  it('hands out frozen feature records', () => {
    const intent = intentFor(view, 'red', feasibility)
    expect(Object.isFrozen(featuresOf(view, 'red', intent))).toBe(true)
  })
})

describe('figure index', () => {
  const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
  const reg = defaultRegistry()
  const r = stepBots(startGame({ board: 'Board4MixUp1', factions: F, seed: 8, bots: F }, reg), F, mobileBot, 300, reg).result

  it('lists each faction’s pieces in board order, exactly as a scan of every system does', () => {
    for (const f of F) {
      for (const piece of ['Ship', 'City', 'Starport'] as const) {
        const scan: { id: string; system: string }[] = []
        for (const system of r.state.board.systems) {
          for (const id of contentsOf(r.state.figures, Location.system(system))) {
            const p = parseFigureId(id)
            if (p.color === f && p.piece === piece) scan.push({ id, system })
          }
        }
        expect(figuresOf(r.state.figures, r.state.board.systems, f, piece)).toEqual(scan)
      }
    }
  })
  it('names the colours present in each system', () => {
    for (const system of r.state.board.systems) {
      const scan = new Set(contentsOf(r.state.figures, Location.system(system)).map((id) => parseFigureId(id).color))
      expect(colorsIn(r.state.figures, r.state.board.systems, system)).toEqual(scan)
    }
  })
})

describe('positional cache', () => {
  it('gatesHeld and fleetThreat match a fresh computation across a whole game', () => {
    const F: FactionId[] = ['red', 'yellow']
    const reg = defaultRegistry()
    let r = startGame({ board: 'Board2Frontiers', factions: F, seed: 17, bots: F }, reg)
    let checked = 0
    for (let i = 0; i < 400 && !r.state.isOver; i += 10) {
      for (const f of F) {
        const view = observe(r.state, f)
        const x = featuresOf(view, f, intentFor(view, f, feasibility))
        const fresh = positionalUncached(view, f)
        expect(x.gatesHeld).toBe(fresh.gatesHeld)
        expect(x.fleetThreat).toBe(fresh.fleetThreat)
        checked++
      }
      r = stepBots(r, F, mobileBot, 10, reg).result
    }
    expect(checked).toBeGreaterThan(20)
  })
})
