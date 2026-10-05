/**
 * Committed strategies (`strategy.ts`, docs/spikes/2026-09-strategies.md): a fixed plan that still
 * obeys docs/19 §2b — derived from the observation, never remembered — and moves only when a marker
 * is placed.
 */
import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  Location,
  STRATEGIES,
  committedIntent,
  contentsOf,
  defaultRegistry,
  feasibility,
  intentFor,
  move,
  observe,
  startGame,
  strategyBot,
} from '../src/index.js'
import type { Ambition, FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const FOUR: readonly FactionId[] = ['red', 'yellow', 'blue', 'white']
const fresh = (): GameState =>
  startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed: 7 }, registry).state

const planShare = (state: GameState, plan: readonly Ambition[]): number => {
  const intent = committedIntent(plan)(observe(state, 'red'), 'red')
  return plan.reduce((n, a) => n + (intent.pursuing.get(a) ?? 0), 0)
}

describe('committed strategies', () => {
  it('holds the plan at its commitment while the plan can score, more than hard does', () => {
    const s = fresh()
    for (const { plan } of Object.values(STRATEGIES)) {
      const adaptive = intentFor(observe(s, 'red'), 'red', feasibility)
      const hardShare = plan.reduce((n, a) => n + (adaptive.pursuing.get(a) ?? 0), 0)
      expect(planShare(s, plan)).toBeCloseTo(0.85, 10)
      expect(planShare(s, plan)).toBeGreaterThan(hardShare)
    }
  })

  it('does not move when the bot builds, fights, spends or discards', () => {
    const base = fresh()
    const plan: Ambition[] = ['Warlord', 'Tyrant']
    const before = committedIntent(plan)(observe(base, 'red'), 'red')
    let s = base
    // Spend every resource, discard three cards, lose every ship to a rival's trophies.
    for (let i = 0; i < 6; i++) {
      for (const token of contentsOf(s.resources, `cityslot:red:${i}`)) {
        s = { ...s, resources: move(s.resources, token, `supply:${token.slice(0, token.indexOf('#'))}`) }
      }
    }
    for (const card of contentsOf(s.cards, CardLocation.hand('red')).slice(0, 3)) {
      s = { ...s, cards: move(s.cards, card, CardLocation.discard()) }
    }
    for (const sys of s.board.systems) {
      for (const id of contentsOf(s.figures, Location.system(sys)).filter((f) => f.startsWith('red') && f.includes('Ship'))) {
        s = { ...s, figures: move(s.figures, id, Location.trophies('yellow')) }
      }
    }
    const after = committedIntent(plan)(observe(s, 'red'), 'red')
    expect([...after.pursuing]).toEqual([...before.pursuing])
    // hard's own intent does move on the lost fleet — the contrast the strict version exists for.
    const hardBefore = intentFor(observe(base, 'red'), 'red', feasibility)
    const hardAfter = intentFor(observe(s, 'red'), 'red', feasibility)
    expect(hardAfter.pursuing.get('Warlord')).not.toBeCloseTo(hardBefore.pursuing.get('Warlord')!, 6)
  })

  it('puts the whole plan on the half that can still score', () => {
    const s: GameState = {
      ...fresh(),
      ambitionable: [],
      declared: [{ ambition: 'Keeper', marker: { high: 5, low: 3 }, round: 1, by: 'red' as const }],
    }
    const intent = committedIntent(['Keeper', 'Empath'])(observe(s, 'red'), 'red')
    expect(intent.pursuing.get('Keeper')).toBeCloseTo(0.85, 10)
    expect(intent.pursuing.get('Empath')).toBeCloseTo(0.0375, 10)
  })

  it("falls back to hard's own intent once the plan cannot score this chapter", () => {
    const s: GameState = {
      ...fresh(),
      ambitionable: [],
      declared: [{ ambition: 'Tycoon', marker: { high: 5, low: 3 }, round: 1, by: 'red' as const }],
    }
    const o = observe(s, 'red')
    const intent = committedIntent(['Warlord', 'Tyrant'])(o, 'red')
    expect([...intent.pursuing]).toEqual([...intentFor(o, 'red', feasibility).pursuing])
    expect(intent.leading).toBe('Tycoon')
  })

  it('builds a bot for every strategy, and refuses an unknown one', () => {
    for (const name of Object.keys(STRATEGIES)) expect(strategyBot(name).id).toBe(`strat-${name}`)
    expect(strategyBot('warlord', 0.95).id).toBe('strat-warlord-c0.95')
    expect(() => strategyBot('pacifist')).toThrow(/no strategy/)
  })
})
