/**
 * A remote player's actions, narrated on the board the same way a bot's are.
 *
 * The store already turned every bot step into a `TurnEvent` (`turn-events.ts`), and the map, the
 * court rail, the played-card row and the ambition track all draw off that one list. A joined game
 * had none of it: `botsAvailable()` is false in a session, so a rival's turn moved the pieces with
 * no pulse, no arrow and no caption — the turn feed's rows were the whole story. `applyRemote` is
 * the exact mirror of `stepBotOnce` (one action, one state step, one slice of new log lines), so
 * this is that same record from the other source.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { store } from '../src/store.js'
import { STAGGER_MS } from '../src/turn-events.js'
import type { Action } from '@arcs/engine'

afterEach(() => store.reset())

/** A three-handed game with nobody botting — the shape of a joined one. */
function start(): void {
  store.start({ board: 'Board3Frontiers', factions: ['red', 'yellow', 'blue'], seed: 5, bots: [] })
}

/** The first action the engine will accept right now. */
function offered(): Action {
  const cont = store.getSnapshot()?.continue
  if (cont?.kind !== 'ask') throw new Error('not an ask')
  return cont.actions[0]!
}

describe('actions arriving from another player', () => {
  it('records one event per action, with the actor the ask named', () => {
    start()
    const cont = store.getSnapshot()!.continue
    const actor = cont.kind === 'ask' ? cont.faction : undefined
    store.applyRemote(offered())
    expect(store.turnEvents).toHaveLength(1)
    expect(store.turnEvents[0]!.faction).toBe(actor)
  })

  it('carries the log lines that action wrote, which is what the caption reads', () => {
    start()
    const before = store.getSnapshot()!.state.log.length
    store.applyRemote(offered())
    const after = store.getSnapshot()!.state.log
    expect(store.turnEvents[0]!.lines).toEqual(after.slice(before))
  })

  /*
   * The catch-up case: `session.ts` loops a whole tail into `applyRemote` in one pass after the
   * socket opens or reopens, and on the polling fallback. Same instant, so without the stagger
   * every caption in the burst lands on top of the others.
   */
  it('spaces a burst so the captions play as a sequence', () => {
    start()
    for (let i = 0; i < 3; i++) store.applyRemote(offered())
    const at = store.turnEvents.map((e) => e.at)
    expect(at).toHaveLength(3)
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(STAGGER_MS)
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(STAGGER_MS)
  })

  it('bumps the presentation snapshot, since an event never moves the position on its own', () => {
    start()
    const before = store.getTurnUiSnapshot()
    store.applyRemote(offered())
    expect(store.getTurnUiSnapshot()).not.toBe(before)
  })

  it('records nothing when there is no game to apply against', () => {
    store.reset()
    store.applyRemote({ type: 'action/build', faction: 'red', system: '1-Hex' } as Action)
    expect(store.turnEvents).toEqual([])
  })
})
