import { describe, expect, it, vi } from 'vitest'

import { Session } from '../src/multiplayer/session.js'
import type { PublicSeat } from '../src/multiplayer/client.js'

describe('Session seats', () => {
  it('hands seats to the host on resync and on a seats push', async () => {
    const seen: (readonly PublicSeat[])[] = []
    const tail = {
      options: { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 7 },
      entries: [],
      length: 0,
      yourFaction: 'red',
      seats: [{ faction: 'red', isBot: false }, { faction: 'yellow', name: 'Sam', isBot: false }, { faction: 'blue', isBot: true }],
    }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(tail), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('WebSocket', undefined)
    const session = new Session('', { gameId: 'g', seatToken: 't' }, {
      current: () => null,
      adopt: () => {},
      applyRemote: () => {},
      seats: (s) => seen.push(s),
    })
    await session.resync()
    expect(seen[0]).toEqual(tail.seats)
    // A seats-only push (name claim) updates without touching the journal.
    ;(session as unknown as { applyPush: (raw: string) => void }).applyPush(
      JSON.stringify({ from: 0, entries: [], seats: [{ faction: 'red', name: 'Brian', isBot: false }] }),
    )
    expect(seen[1]).toEqual([{ faction: 'red', name: 'Brian', isBot: false }])
    session.leave()
    vi.unstubAllGlobals()
  })
})
