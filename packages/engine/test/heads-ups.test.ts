import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { FACTION_IDS, defaultRegistry, move, observe, replayGame, seatFacts, sinceLastTurn } from '../src/index.js'
import type { GameState, NewGameOptions } from '../src/index.js'

const live = JSON.parse(readFileSync(new URL('./fixtures/game-158107d8.json', import.meta.url), 'utf8')) as {
  options: NewGameOptions
  journal: string[]
}
const reg = defaultRegistry()
const at = (n: number): GameState => replayGame(live.options, live.journal.slice(0, n), reg).state

/** Move the first free token of a resource from the supply into a slot. */
function give(state: GameState, resource: string, slot: string): GameState {
  const id = state.resources.contents.get(`supply:${resource}`)![0]!
  return { ...state, resources: move(state.resources, id, slot) }
}

describe('sinceLastTurn', () => {
  it("is just after the faction's previous turn", () => {
    const j = live.journal.slice(0, 66)
    const lastRed = j.map((e, i) => (e.includes('faction="red"') ? i : -1)).filter((i) => i >= 0).at(-1)!
    expect(sinceLastTurn(j, 'red')).toBe(lastRed + 1)
  })
  it('skips the turn in progress', () => {
    expect(sinceLastTurn(live.journal.slice(0, 69), 'red')).toBe(sinceLastTurn(live.journal.slice(0, 66), 'red'))
  })
  it('is 0 for a seat that has not had a turn', () => {
    expect(sinceLastTurn(live.journal.slice(0, 5), 'yellow')).toBe(0)
  })
})

describe('heads-ups (red, at the start of its round-3 turn)', () => {
  const now = at(66)
  const before = at(sinceLastTurn(live.journal.slice(0, 66), 'red'))
  const facts = seatFacts(before, now, 'red', reg)
  const kinds = (f: { headsUps: readonly { kind: string }[] }, k: string) => f.headsUps.filter((h) => h.kind === k)

  it('rival-tax-base fires when a rival builds on your ambition’s world', () => {
    expect(facts.headsUps).toContainEqual({ kind: 'rival-tax-base', text: 'blue can now tax Relic — it counts toward Keeper.' })
  })
  it('rival-tax-base does not fire for an ambition you did not declare', () => {
    const y = seatFacts(at(sinceLastTurn(live.journal.slice(0, 66), 'yellow')), now, 'yellow', reg)
    expect(kinds(y, 'rival-tax-base')).toEqual([])
  })

  it('overtake-risk fires when a rival one Tax behind can tax your resource', () => {
    expect(facts.headsUps).toContainEqual({ kind: 'overtake-risk', text: 'blue is one Tax from tying you on Keeper.' })
  })
  it('overtake-risk does not fire when you do not lead', () => {
    const tied = give(now, 'Relic', 'cityslot:blue:1')
    expect(kinds(seatFacts(before, tied, 'red', reg), 'overtake-risk')).toEqual([])
  })

  it('outnumbered fires when a rival with a Weapon outships you', () => {
    const armed = give(now, 'Weapon', 'cityslot:white:0')
    expect(kinds(seatFacts(before, armed, 'red', reg), 'outnumbered')).toEqual([
      { kind: 'outnumbered', text: 'white has 4 ships to your 2 in 1-Arrow.' },
    ])
  })
  it('outnumbered does not fire against an unarmed rival', () => {
    expect(kinds(facts, 'outnumbered')).toEqual([])
  })

  it('first-place fires when you take or lose the lead', () => {
    const tied = give(now, 'Relic', 'cityslot:blue:1')
    expect(kinds(seatFacts(tied, now, 'red', reg), 'first-place')).toEqual([{ kind: 'first-place', text: 'You now lead Keeper.' }])
    expect(kinds(seatFacts(now, tied, 'red', reg), 'first-place')).toEqual([{ kind: 'first-place', text: 'You no longer lead Keeper.' }])
  })
  it('first-place does not fire when the lead is unchanged', () => {
    expect(kinds(seatFacts(now, now, 'red', reg), 'first-place')).toEqual([])
  })

  it('hand fires on your last card, and on no Aggression when outnumbered', () => {
    const hand = now.cards.contents.get('hand:red')!
    let one: GameState = now
    for (const id of hand.slice(1)) one = { ...one, cards: move(one.cards, id, 'deck') }
    expect(kinds(seatFacts(before, one, 'red', reg), 'hand')).toContainEqual({ kind: 'hand', text: 'This is your last card this chapter.' })
    const armed = give(now, 'Weapon', 'cityslot:white:0')
    expect(hand.some((c) => c.startsWith('Aggression-'))).toBe(false)
    expect(kinds(seatFacts(before, armed, 'red', reg), 'hand')).toEqual([{ kind: 'hand', text: 'You hold no Aggression card.' }])
  })
  it('hand does not fire with several cards and no threat', () => {
    expect(kinds(facts, 'hand')).toEqual([])
  })

  it("never contains another seat's hand", () => {
    const text = JSON.stringify(facts)
    for (const f of FACTION_IDS.filter((x) => x !== 'red' && now.factions.includes(x))) {
      for (const card of now.cards.contents.get(`hand:${f}`) ?? []) expect(text).not.toContain(card)
    }
    expect(facts.hand).toEqual(observe(now, 'red').hand)
  })
  it('lists the log since the last turn', () => {
    expect(facts.since[0]).toBe(now.log[before.log.length])
    expect(facts.since.length).toBe(now.log.length - before.log.length)
  })
})
