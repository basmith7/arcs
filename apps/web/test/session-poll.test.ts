import { describe, expect, it, vi } from 'vitest'
import { defaultRegistry, encodeAction, startGame } from '@arcs/engine'
import type { Action } from '@arcs/engine'

import { Session } from '../src/multiplayer/session.js'

describe('Session poll idempotency', () => {
  it('applies an entry once when two overlapping polls return it', async () => {
    const options = { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 7 }
    const first = (startGame(options as never, defaultRegistry()).continue as { actions: Action[] }).actions[0]!
    const entry = encodeAction(first)

    const gates: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          gates.push(() =>
            resolve(
              new Response(JSON.stringify({ options, entries: [entry], length: 1, yourFaction: 'red' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            ),
          )
        }),
    )
    vi.stubGlobal('WebSocket', undefined)

    // Two sessions into one store, as when "Who are you?" joins the seated session before the watcher leaves.
    let length = 0
    let applied = 0
    const host = {
      current: () => ({ state: { journal: { length } } }) as never,
      adopt: () => {},
      applyRemote: () => {
        applied++
        length++
      },
      seats: () => {},
    }
    const a = new Session('', { gameId: 'g', seatToken: 't' }, host)
    const b = new Session('', { gameId: 'g', seatToken: 't' }, host)
    const pa = a.poll()
    const pb = b.poll()
    expect(gates).toHaveLength(2)
    gates[0]!()
    gates[1]!()
    await Promise.all([pa, pb])

    expect(applied).toBe(1)
    a.leave()
    b.leave()
    vi.unstubAllGlobals()
  })
})
