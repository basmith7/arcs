import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { FACTION_IDS, defaultRegistry, move, observe, replayGame, seatFacts, seatTurn, turnWindow } from '../src/index.js'
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

describe('seatTurn: where a seat\'s turn began, and what happened since its last one', () => {
  const turn = (n: number, f: string) => seatTurn(live.options, live.journal.slice(0, n), f as never, reg)
  const lastRedBefore66 = live.journal.slice(0, 66).map((e, i) => (e.includes('faction="red"') ? i : -1)).filter((i) => i >= 0).at(-1)!

  it('at the hand-off: the turn starts now, since runs from the end of its previous turn', () => {
    expect(turn(66, 'red')).toEqual({ inTurn: true, start: 66, since: lastRedBefore66 + 1 })
  })
  it('mid-turn: the same window, so the story and dismissal hold for the whole turn', () => {
    expect(turn(69, 'red')).toEqual(turn(66, 'red'))
  })
  it('not that seat\'s turn: no window', () => {
    expect(turn(66, 'yellow').inTurn).toBe(false)
  })
  it('a seat on its first turn ever: since is 0', () => {
    const first = live.journal.findIndex((e) => e.includes('faction="yellow"'))
    expect(turn(first, 'yellow')).toEqual({ inTurn: true, start: first, since: 0 })
  })
})

describe('turnWindow (pure): a turn starts where the seat is asked to open one', () => {
  // asks[i]: what red was asked before entry i; the last one is what it is asked now.
  it('splits adjacent turns: red ends one round and leads the next', () => {
    const journal = [
      'turn/lead(card="A-1",faction="blue")',
      'action/x(faction="blue")',
      'turn/surpass(card="A-7",faction="red")',
      'action/x(faction="red")',
      'turn/lead(card="B-2",faction="red")',
      'action/x(faction="red")',
    ]
    const asks = ['none', 'none', 'opener', 'other', 'opener', 'other', 'other'] as const
    expect(turnWindow(journal, asks, 'red')).toEqual({ inTurn: true, start: 4, since: 4 })
    expect(turnWindow(journal.slice(0, 4), asks.slice(0, 5), 'red')).toEqual({ inTurn: true, start: 4, since: 4 })
  })
  it('a pass is a turn of its own, even though the engine keeps the round number', () => {
    const journal = ['turn/pass(faction="red")', 'turn/lead(card="A-1",faction="blue")', 'action/x(faction="blue")']
    const asks = ['opener', 'none', 'none', 'opener'] as const
    expect(turnWindow(journal, asks, 'red')).toEqual({ inTurn: true, start: 3, since: 1 })
  })
  it('a chapter ending on a pass hands the next lead straight back: a new turn', () => {
    const journal = ['turn/pass(faction="red")']
    expect(turnWindow(journal, ['opener', 'opener'], 'red')).toEqual({ inTurn: true, start: 1, since: 1 })
  })
  it('a turn never spans a chapter: a 2-player mulligan after your last play is not your turn', () => {
    const journal = ['turn/lead(card="A-1",faction="red")']
    expect(turnWindow(journal, ['opener', 'other'], 'red', [1, 2]).inTurn).toBe(false)
    expect(turnWindow(journal, ['opener', 'other'], 'red', [1, 1]).inTurn).toBe(true)
  })
  it('a response asked outside its own turn is no turn', () => {
    const journal = ['turn/lead(card="A-1",faction="blue")', 'action/x(faction="blue")']
    expect(turnWindow(journal, ['none', 'none', 'other'], 'red').inTurn).toBe(false)
  })
})

describe('heads-ups (red, at the start of its round-3 turn)', () => {
  const now = at(66)
  const before = at(seatTurn(live.options, live.journal.slice(0, 66), 'red', reg).since)
  const facts = seatFacts(before, now, 'red', reg)
  const kinds = (f: { headsUps: readonly { kind: string }[] }, k: string) => f.headsUps.filter((h) => h.kind === k)

  it('rival-tax-base fires when a rival builds on your ambition’s world', () => {
    expect(facts.headsUps).toContainEqual({ kind: 'rival-tax-base', text: 'blue can now tax Relic — it counts toward Keeper.' })
  })
  it('rival-tax-base does not fire for an ambition you did not declare', () => {
    const y = seatFacts(at(seatTurn(live.options, live.journal.slice(0, 66), 'yellow', reg).since), now, 'yellow', reg)
    expect(kinds(y, 'rival-tax-base')).toEqual([])
  })

  it('overtake-risk fires when a rival one Tax behind can tax your resource', () => {
    expect(facts.headsUps).toContainEqual({ kind: 'overtake-risk', text: 'blue is one Tax from tying you on Keeper.' })
  })
  it('overtake-risk does not fire when the supply has none of the resource to tax', () => {
    const contents = new Map([...now.resources.contents].map(([k, v]) => [k, k === 'supply:Relic' ? [] : v]))
    const dry: GameState = { ...now, resources: { ...now.resources, contents } }
    expect(kinds(seatFacts(before, dry, 'red', reg), 'overtake-risk')).toEqual([])
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
