import { describe, expect, it } from 'vitest'

import { applyExternal, defaultRegistry, replayGame } from '../src/index.js'
import { locationOf } from '../src/tracker.js'
import { refundPip } from '../src/rules/standard-actions.js'
import { RESOURCES, TOKENS_PER_RESOURCE, resourceToken } from '../src/resources.js'
import type { Action, NewGameOptions, RuleResult } from '../src/index.js'

/**
 * Cancel hands the pip back.
 *
 * The opening `Cancel` of an action (the Influence card picker, Move's first pick, and so on)
 * returned to `then`, which the pip menu had already built as `done + 1`. So backing out of a
 * picker cost the pip: "Dammit it canceled my last pip" (live game 158107d8, 2026-09-26, blue's
 * third Mobilization pip). A player who opens a picker only to look at it and then cancels hasn't
 * acted, so the pip should come back.
 *
 * Old journals keep their meaning. A Cancel recorded before this fix has no `refund` field and
 * still spends the pip, so games already in the database replay exactly as they were played.
 */
const OPTIONS = {
  board: 'Board4MixUp1',
  factions: ['red', 'yellow', 'blue', 'white'],
  seed: 505863826,
} as unknown as NewGameOptions

// The live game up to blue's pip menu on "action 3 of 3".
const JOURNAL = [
  'turn/lead(card="Mobilization-7",faction="red",suit="Mobilization")',
  'ambition/declare(ambition="Keeper",faction="red",pips=1,suit="Mobilization")',
  'turn/prelude-spend(action="Influence",faction="red",pips=1,resource="Psionic",suit="Mobilization")',
  'action/influence(faction="red",slot=3,then={"type":"turn/prelude","faction":"red","suit":"Mobilization","pips":1})',
  'turn/prelude-spend(action="Secure",faction="red",pips=1,resource="Relic",suit="Mobilization")',
  'action/secure(faction="red",slot=3,then={"type":"turn/prelude","faction":"red","suit":"Mobilization","pips":1})',
  'action/take(action="Move",faction="red",then={"type":"turn/pips","faction":"red","suit":"Mobilization","done":1,"total":1})',
  'action/move-pick(faction="red",from="1-Gate",then={"type":"turn/pips","faction":"red","suit":"Mobilization","done":1,"total":1},to="1-Arrow")',
  'action/move-ships(count=2,faction="red",from="1-Gate",then={"type":"turn/pips","faction":"red","suit":"Mobilization","done":1,"total":1},to="1-Arrow")',
  'turn/surpass(card="Mobilization-2",faction="yellow")',
  'turn/seize(card="Construction-6",faction="yellow",pips=4,suit="Mobilization")',
  'turn/prelude-done(faction="yellow",pips=4,suit="Mobilization")',
  'action/take(action="Move",faction="yellow",then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":1,"total":4})',
  'action/move-pick(faction="yellow",from="6-Gate",then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":1,"total":4},to="6-Crescent")',
  'action/move-ships(count=2,faction="yellow",from="6-Gate",then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":1,"total":4},to="6-Crescent")',
  'action/take(action="Influence",faction="yellow",then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":2,"total":4})',
  'action/skip(faction="yellow",then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":2,"total":4})',
  'action/take(action="Influence",faction="yellow",then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":3,"total":4})',
  'action/influence(faction="yellow",slot=4,then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":3,"total":4})',
  'action/take(action="Influence",faction="yellow",then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":4,"total":4})',
  'action/influence(faction="yellow",slot=4,then={"type":"turn/pips","faction":"yellow","suit":"Mobilization","done":4,"total":4})',
  'turn/surpass(card="Mobilization-3",faction="blue")',
  'turn/prelude-arrange(faction="blue",pips=3,suit="Mobilization")',
  'resources/arrange-done(faction="blue",then={"type":"turn/prelude","faction":"blue","suit":"Mobilization","pips":3})',
  'turn/prelude-done(faction="blue",pips=3,suit="Mobilization")',
  'action/take(action="Move",faction="blue",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":1,"total":3})',
  'action/move-pick(faction="blue",from="4-Gate",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":1,"total":3},to="2-Gate")',
  'action/move-ships(count=2,faction="blue",from="4-Gate",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":1,"total":3},to="2-Gate")',
  'action/take(action="Move",faction="blue",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":2,"total":3})',
  'action/move-pick(faction="blue",from="2-Gate",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":2,"total":3},to="2-Hex")',
  'action/move-ships(count=2,faction="blue",from="2-Gate",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":2,"total":3},to="2-Hex")',
]


// Tim's turn in the same game: white surpasses and spends a Material in the Prelude to Build.
const TO_PRELUDE_BUILD = [
  ...JOURNAL,
  'action/take(action="Influence",faction="blue",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":3,"total":3})',
  'action/influence(faction="blue",slot=1,then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":3,"total":3})',
  'turn/surpass(card="Mobilization-4",faction="white")',
  'turn/prelude-arrange(faction="white",pips=3,suit="Mobilization")',
  'resources/arrange-done(faction="white",then={"type":"turn/prelude","faction":"white","suit":"Mobilization","pips":3})',
  'turn/prelude-spend(action="Build",faction="white",pips=3,resource="Material",suit="Mobilization")',
]

const registry = defaultRegistry()

function ask(r: RuleResult): { faction: string; prompt: string; actions: readonly Action[] } {
  const c = r.continue as { kind: string; faction: string; prompt: string; actions: readonly Action[] }
  expect(c.kind).toBe('ask')
  return c
}

function pick(r: RuleResult, pred: (a: Action) => boolean): Action {
  const found = ask(r).actions.find(pred)
  expect(found, `no such action in ${ask(r).prompt}`).toBeDefined()
  return found!
}

const menu = replayGame(OPTIONS, JOURNAL, registry)

describe('Cancel hands the pip back', () => {
  it('starts on blue\'s third pip', () => {
    expect(ask(menu).prompt).toBe('blue — action 3 of 3 (Mobilization)')
  })

  for (const which of ['Influence', 'Move'] as const) {
    it(`cancelling the ${which} picker returns to the same pip`, () => {
      const opened = applyExternal(menu, pick(menu, (a) => a.type === 'action/take' && a['action'] === which), registry)
      const cancel = pick(opened, (a) => a['label'] === 'Cancel')
      const back = applyExternal(opened, cancel, registry)
      expect(ask(back).faction).toBe('blue')
      expect(ask(back).prompt).toBe('blue — action 3 of 3 (Mobilization)')
    })
  }

  it('still influences after a cancel', () => {
    const take = (r: RuleResult) =>
      applyExternal(r, pick(r, (a) => a.type === 'action/take' && a['action'] === 'Influence'), registry)
    const opened = take(menu)
    const back = applyExternal(opened, pick(opened, (a) => a['label'] === 'Cancel'), registry)
    const again = take(back)
    const done = applyExternal(again, pick(again, (a) => a['label'] === 'Influence Prison Wardens'), registry)
    expect(done.state.log.at(-1)).toBe('blue influenced Prison Wardens')
    expect(ask(done).faction).toBe('white')
  })

  it('a Cancel journaled before the fix still spends the pip', () => {
    const old = replayGame(
      OPTIONS,
      [
        ...JOURNAL,
        'action/take(action="Influence",faction="blue",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":3,"total":3})',
        'action/skip(faction="blue",then={"type":"turn/pips","faction":"blue","suit":"Mobilization","done":3,"total":3})',
      ],
      registry,
    )
    expect(ask(old).faction).toBe('white')
  })
})

/**
 * The same trap, paid in resources. A Prelude spend pays the token before the action opens, so
 * cancelling the Build picker it bought kept the Material spent (live game 158107d8, 2026-09-26:
 * "I built a city and it never spawned"). The Cancel now puts the token back in its slot.
 */
describe('Cancel hands a Prelude resource back', () => {
  // Each held token with the slot it sits in, so a refund to the wrong slot fails too.
  const held = (r: RuleResult, faction: string): string[] =>
    RESOURCES.flatMap((res) =>
      Array.from({ length: TOKENS_PER_RESOURCE }, (_, i) => resourceToken(res, i)),
    )
      .map((t) => `${t}@${String(locationOf(r.state.resources, t))}`)
      .filter((s) => s.includes(`slot:${faction}:`))
      .sort()

  it('returns the Material to white and reopens the Prelude', () => {
    const before = replayGame(OPTIONS, TO_PRELUDE_BUILD.slice(0, -1), registry)
    const opened = replayGame(OPTIONS, TO_PRELUDE_BUILD, registry)
    expect(ask(opened).prompt).toBe('Build')
    const back = applyExternal(opened, pick(opened, (a) => a['label'] === 'Cancel'), registry)
    expect(ask(back).prompt).toBe('white — Prelude')
    expect(ask(back).actions.map((a) => a['label'])).toContain('Material: Build')
    expect(held(back, 'white')).toEqual(held(before, 'white'))
    expect(held(back, 'white').some((s) => s.includes('Material'))).toBe(true)
  })

  it('a Prelude Cancel journaled before the fix still spends the resource', () => {
    const old = replayGame(
      OPTIONS,
      [
        ...TO_PRELUDE_BUILD,
        'action/skip(faction="white",refund=true,then={"type":"turn/prelude","faction":"white","suit":"Mobilization","pips":3})',
      ],
      registry,
    )
    expect(ask(old).actions.map((a) => a['label'])).not.toContain('Material: Build')
  })
})

/**
 * Tactical and Charismatic pair two actions on one pip. Cancelling the first half gives the whole
 * pip back; cancelling the second does not, because the first half has already resolved.
 */
describe('refundPip with a leader follow-up', () => {
  const pips = { type: 'turn/pips', faction: 'red', suit: 'Aggression', done: 2, total: 3 }
  const cancel = (then: Action): Action => ({ type: 'action/skip', faction: 'red', then, refund: true })

  it('refunds the pip when the first half is cancelled', () => {
    const follow = { type: 'leaders/must-follow', faction: 'red', act: 'Battle', then: pips }
    expect(refundPip(cancel(follow))).toEqual({ ...pips, done: 1 })
  })

  it('keeps the pip spent when the follow-up is cancelled', () => {
    const followed = { ...pips, followed: true }
    expect(refundPip(cancel(followed))).toEqual(followed)
  })

  it('refunds nothing without the flag', () => {
    expect(refundPip({ type: 'action/skip', faction: 'red', then: pips })).toEqual(pips)
  })
})
