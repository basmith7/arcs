/**
 * Who is being watched — the question that decides whether the decision surfaces draw at all.
 *
 * `canAct` already answers "may I press this", and for a joined game that is nearly the same
 * question. It is *not* the same question in hotseat, where `canAct` is unconditionally true
 * because one browser plays every seat — and a bot's seat is not one of the browser's players.
 * That gap is the whole reason this predicate exists rather than reusing the negation of `canAct`:
 * playing against bots is the common case, and it is the case `canAct` cannot see.
 */

import { describe, expect, it } from 'vitest'

import { hushed, watchedActor } from '../src/multiplayer/seat.js'
import type { SeatView } from '../src/multiplayer/seat.js'
import type { Ask, Continue } from '@arcs/engine'

const HOTSEAT: SeatView = { kind: 'hotseat' }
const ask = (faction: 'red' | 'yellow' | 'blue' | 'white'): Ask => ({ kind: 'ask', faction, actions: [] })

describe('watchedActor in hotseat', () => {
  it('names a bot that is being asked — its turn is a show, not a decision', () => {
    expect(watchedActor(ask('yellow'), HOTSEAT, ['yellow', 'blue'])).toBe('yellow')
  })

  it('is null for a human seat, because this browser plays it', () => {
    expect(watchedActor(ask('red'), HOTSEAT, ['yellow', 'blue'])).toBeNull()
  })

  it('is null with no bots at all — hotseat between people is nobody watching', () => {
    expect(watchedActor(ask('yellow'), HOTSEAT, [])).toBeNull()
  })
})

describe('watchedActor in a joined game', () => {
  const seat: SeatView = { kind: 'seat', faction: 'red' }

  it('names a rival who is being asked', () => {
    expect(watchedActor(ask('blue'), seat, [])).toBe('blue')
  })

  /*
   * The ask, not `state.current`, is what this reads — which is the same call for "my turn" and
   * for a decision handed to me during blue's turn (the defender assigning hits). Both must draw
   * their surface, and one assertion covers both because the engine addresses the ask to me.
   */
  it('is null when the ask is mine, whoever is mid-turn', () => {
    expect(watchedActor(ask('red'), seat, [])).toBeNull()
  })

  it('names whoever acts, for a spectator, who never acts', () => {
    expect(watchedActor(ask('blue'), { kind: 'spectator' }, [])).toBe('blue')
    expect(watchedActor(ask('red'), { kind: 'spectator' }, [])).toBe('red')
  })
})

describe('watchedActor outside an ask', () => {
  it('is null at game over, so the summary band draws for everyone', () => {
    const over: Continue = { kind: 'gameOver', winners: ['red'], reason: 'power' }
    expect(watchedActor(over, { kind: 'spectator' }, [])).toBeNull()
  })

  it('is null on a simultaneous ask, which has no single actor to narrate', () => {
    const multi: Continue = { kind: 'multiAsk', asks: [ask('red'), ask('blue')] }
    expect(watchedActor(multi, { kind: 'seat', faction: 'red' }, [])).toBeNull()
  })
})

/**
 * The other half of watch mode: what the *board* is allowed to offer while somebody else acts.
 *
 * `App` stands the tray, the strip and the Prelude down by not mounting them, which the surfaces
 * above decide. The map cannot be stood down that way — it is the thing being watched — so it is
 * hushed instead: the same ask, with nothing to click. Every affordance `Board` draws is derived
 * from `cont.actions`, so emptying that one field is what takes the hint bar and every reticle
 * with it, including affordances nobody has written yet.
 */
describe('hushed', () => {
  const offer: Ask = {
    kind: 'ask',
    faction: 'yellow',
    actions: [{ type: 'action/move-pick', faction: 'yellow', from: '1-Gate', to: '1-Arrow' }],
  }

  it('empties the actions, which is what silences the board hint', () => {
    const out = hushed(offer)
    expect(out).toMatchObject({ kind: 'ask', faction: 'yellow', actions: [] })
  })

  it('keeps the actor, so the board still colours whose move it is', () => {
    expect((hushed(offer) as Ask).faction).toBe('yellow')
  })

  it('leaves a non-ask alone — game over is nobody’s decision to hush', () => {
    const over: Continue = { kind: 'gameOver', winners: ['red'], reason: 'power' }
    expect(hushed(over)).toBe(over)
  })

  it('empties every ask in a simultaneous one rather than passing them through', () => {
    const multi: Continue = { kind: 'multiAsk', asks: [offer, { ...offer, faction: 'blue' }] }
    const out = hushed(multi) as { kind: 'multiAsk'; asks: readonly Ask[] }
    expect(out.asks.every((a) => a.actions.length === 0)).toBe(true)
  })
})
