import { describe, expect, it } from 'vitest'

import { applyExternal, defaultRegistry, replayGame } from '../src/index.js'
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
