/**
 * `createThinker`: a bot decision from plain data (options + journal), so it can run in a worker
 * thread. The main thread applies the returned action itself, so it must be exactly `stepBot`'s.
 */
import { describe, expect, it } from 'vitest'

import {
  NO_ASKS,
  applyExternal,
  botForLevel,
  botToAct,
  createThinker,
  decodeAction,
  defaultRegistry,
  encodeAction,
  startGame,
  stepBot,
} from '../src/index.js'
import type { AskedThisTurn, FactionId, NewGameOptions, RuleResult } from '../src/index.js'

const reg = defaultRegistry()
const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const options: NewGameOptions = { board: 'Board4MixUp1', factions: F, seed: 4242, bots: F, botLevel: 'normal' }

describe('createThinker', () => {
  it('answers what stepBot would, step after step, with the asked-history round-tripped', () => {
    const think = createThinker()
    let r: RuleResult = startGame(options, reg)
    let asked: AskedThisTurn = NO_ASKS
    let thoughtAsked: AskedThisTurn = NO_ASKS
    for (let i = 0; i < 60; i++) {
      const faction = botToAct(r, F)!
      const expected = stepBot(r, botForLevel('normal'), faction, reg, asked)
      const reply = think({ options, journal: r.state.journal, faction, level: 'normal', asked: thoughtAsked })
      expect(reply.action).toBe(encodeAction(expected.decision.action))
      expect(reply.asked).toEqual(expected.asked)
      const applied = applyExternal(r, decodeAction(reply.action), reg)
      expect(applied.state.journal).toEqual(expected.result.state.journal)
      r = expected.result
      asked = expected.asked
      thoughtAsked = reply.asked
    }
  })

  it('replays from scratch when the journal is not an extension of the cached one (an undo)', () => {
    const think = createThinker()
    let r: RuleResult = startGame(options, reg)
    let asked: AskedThisTurn = NO_ASKS
    const positions: RuleResult[] = []
    for (let i = 0; i < 20; i++) {
      positions.push(r)
      const s = stepBot(r, botForLevel('normal'), botToAct(r, F)!, reg, asked)
      think({ options, journal: r.state.journal, faction: botToAct(r, F)!, level: 'normal', asked: NO_ASKS })
      r = s.result
      asked = s.asked
    }
    const back = positions[5]!
    const faction = botToAct(back, F)!
    const fresh = stepBot(back, botForLevel('normal'), faction, reg, NO_ASKS)
    expect(think({ options, journal: back.state.journal, faction, level: 'normal', asked: NO_ASKS }).action).toBe(
      encodeAction(fresh.decision.action),
    )
  })
})
