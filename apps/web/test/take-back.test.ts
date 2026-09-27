/**
 * Undo in a joined game: the client asks the server to take back its seat's last action.
 *
 * Runs the client against the real server-node routes (`route` + `EngineGate` on an in-memory
 * SQLite), because the take-back lives only there: the Worker server has no `/undo`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyExternal, decodeAction, defaultRegistry } from '@arcs/engine'
import type { Action, NewGameOptions, RuleResult } from '@arcs/engine'

import { EngineGate } from '../../../packages/server-node/src/gate.js'
import { route } from '../../../packages/server-node/src/api.js'
import { SqliteStore } from '../../../packages/server-node/src/sqlite-store.js'
import { Session } from '../src/multiplayer/session.js'
import type { SessionHost } from '../src/multiplayer/session.js'

const registry = defaultRegistry()
const API = 'https://arcs.test'
const OPTIONS: NewGameOptions = { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 5 }

function host(): SessionHost & { result: RuleResult | null; adopted: number } {
  return {
    result: null,
    adopted: 0,
    current() {
      return this.result
    },
    adopt(_options, result) {
      this.result = result
      this.adopted += 1
    },
    applyRemote(action: Action) {
      this.result = this.result === null ? null : applyExternal(this.result, action, registry)
    },
    seats: () => {},
  }
}

async function table() {
  const store = new SqliteStore(':memory:')
  const api = { store, gate: new EngineGate(store, { pace: 0 }) }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await route(new Request(input as string, init), api)
    return res ?? new Response('not found', { status: 404 })
  })
  const game = await store.create(OPTIONS, OPTIONS.factions, { bots: [] })
  const token = (f: string) => game.seats.find((s) => s.faction === f)!.seatToken
  const join = async (f: string) => {
    const h = host()
    const s = new Session(API, { gameId: game.gameId, seatToken: token(f) }, h)
    await s.resync()
    return { h, s }
  }
  return { store, game, join }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('take-back from the client', () => {
  it('drops the action on the server, and a watching client reloads to match', async () => {
    const { store, game, join } = await table()
    const red = await join('red')
    const yellow = await join('yellow')

    const c = red.h.result!.continue as { actions: readonly Action[] }
    const lead = c.actions.find((a) => a.type === 'turn/lead')!
    red.h.result = applyExternal(red.h.result!, lead, registry)
    await red.s.publish(lead, 0)
    await yellow.s.poll()
    expect(yellow.h.result!.state.journal).toHaveLength(1)

    expect(await red.s.takeBack(1)).toBeUndefined()
    expect(store.journal(game.gameId)).toEqual([])

    // Shorter than it has, so the watcher replays rather than trusting its own copy.
    const before = yellow.h.adopted
    await yellow.s.poll()
    expect(yellow.h.adopted).toBe(before + 1)
    expect(yellow.h.result!.state.journal).toEqual([])
  })

  it("is refused for someone else's move, with the reason", async () => {
    const { store, game, join } = await table()
    const red = await join('red')
    const yellow = await join('yellow')
    const c = red.h.result!.continue as { actions: readonly Action[] }
    const lead = c.actions.find((a) => a.type === 'turn/lead')!
    await red.s.publish(lead, 0)
    expect(await yellow.s.takeBack(1)).toBe('not-yours')
    expect(store.journal(game.gameId).map((e) => decodeAction(e).type)).toEqual(['turn/lead'])
  })
})
