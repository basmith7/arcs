import { describe, expect, it } from 'vitest'

import { applyExternal, defaultRegistry, startGame, takeBackBlock } from '../src/index.js'
import type { Action, RuleResult } from '../src/index.js'

/**
 * What a player may take back in an online game.
 *
 * Their own last action, while nobody has acted since, and only if it revealed nothing: no dice
 * rolled (the RNG moved), no card drawn from a deck or taken out of a rival's hand, and not a look
 * at a rival's hand. Anything else would let a player peek and then rewind.
 */
const registry = defaultRegistry()
const options = { board: 'Board2Frontiers', factions: ['red', 'yellow'], seed: 5 } as const

function ask(r: RuleResult): { faction: string; prompt: string; actions: readonly Action[] } {
  const c = r.continue as { kind: string; faction: string; prompt: string; actions: readonly Action[] }
  expect(c.kind).toBe('ask')
  return c
}

/** Play the first offer until `pred` holds for the next ask, returning the state just before. */
function until(pred: (r: RuleResult) => boolean, cap = 400): RuleResult {
  let r = startGame(options, registry)
  for (let i = 0; i < cap; i++) {
    if (pred(r)) return r
    const offer = ask(r).actions.find((a) => a.type !== 'turn/mulligan') ?? ask(r).actions[0]!
    r = applyExternal(r, offer, registry)
  }
  throw new Error('never reached')
}

describe('takeBackBlock', () => {
  it('allows taking back a card lead: it is your own card, and nothing hidden came out', () => {
    const before = until((r) => ask(r).actions.some((a) => a.type === 'turn/lead'))
    const lead = ask(before).actions.find((a) => a.type === 'turn/lead')!
    const after = applyExternal(before, lead, registry)
    expect(takeBackBlock(before, after, lead)).toBeUndefined()
  })

  it('refuses when the action rolled dice or shuffled', () => {
    const before = startGame(options, registry)
    const moved = { ...before, state: { ...before.state, rng: { seed: before.state.rng.seed + 1 } } }
    expect(takeBackBlock(before, moved, { type: 'x', faction: 'red' })).toMatch(/dice/)
  })

  it('refuses when a card came out of a deck', () => {
    // The court deck: at two players the action deck is fully dealt at setup.
    const before = startGame(options, registry)
    const [card] = [...before.state.courtCards.at].find(([, loc]) => loc === 'court:deck')!
    const at = new Map(before.state.courtCards.at)
    at.set(card, 'court:slot:1')
    const drawn = { ...before, state: { ...before.state, courtCards: { ...before.state.courtCards, at } } }
    expect(takeBackBlock(before, drawn, { type: 'x', faction: 'red' })).toMatch(/drawn|revealed/)
  })

  it("refuses when a card left a rival's hand, but not your own", () => {
    const before = startGame(options, registry)
    const [yellows] = [...before.state.cards.at].find(([, loc]) => loc === 'hand:yellow')!
    const [reds] = [...before.state.cards.at].find(([, loc]) => loc === 'hand:red')!
    const move = (id: string, to: string): RuleResult => {
      const at = new Map(before.state.cards.at)
      at.set(id, to)
      return { ...before, state: { ...before.state, cards: { ...before.state.cards, at } } }
    }
    expect(takeBackBlock(before, move(yellows, 'hand:red'), { type: 'x', faction: 'red' })).toMatch(/hand/)
    expect(takeBackBlock(before, move(reds, 'played:red'), { type: 'x', faction: 'red' })).toBeUndefined()
  })

  it("refuses a Farseers look at a rival's hand, which changes nothing but what you know", () => {
    const before = startGame(options, registry)
    expect(takeBackBlock(before, before, { type: 'ambition/farseers-look', faction: 'red' })).toMatch(/hand/)
  })
})
