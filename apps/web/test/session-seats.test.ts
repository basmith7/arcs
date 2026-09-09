import { describe, expect, it, vi } from 'vitest'

import { Session } from '../src/multiplayer/session.js'
import type { PublicSeat } from '../src/multiplayer/client.js'
import { store } from '../src/store.js'

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

  it('a name claimed while a poll is in flight beats the stale poll response', async () => {
    const seen: (readonly PublicSeat[])[] = []
    const staleSeats: PublicSeat[] = [{ faction: 'red', isBot: false }]
    const claimedSeats: PublicSeat[] = [{ faction: 'red', name: 'Brian', isBot: false }]
    let resolveGet: (() => void) | null = null

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') {
        return new Response(JSON.stringify({ seats: claimedSeats }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // The poll's GET does not resolve until the test says so, simulating it finishing after the claim.
      return new Promise<Response>((resolve) => {
        resolveGet = () =>
          resolve(
            new Response(
              JSON.stringify({ options: {}, entries: [], length: 0, yourFaction: 'red', seats: staleSeats }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          )
      })
    })
    vi.stubGlobal('WebSocket', undefined)

    const session = new Session('', { gameId: 'g', seatToken: 't' }, {
      current: () => null,
      adopt: () => {},
      applyRemote: () => {},
      seats: (s) => seen.push(s),
    })

    const pollPromise = session.poll()
    const claimPromise = session.claimName('Brian')
    expect(resolveGet).not.toBeNull()
    resolveGet?.()
    await pollPromise
    await claimPromise

    expect(seen.at(-1)).toEqual(claimedSeats)
    session.leave()
    vi.unstubAllGlobals()
  })

  it('sends discordId in the claim body and threads discordLinked back into seats', async () => {
    const claimedSeats: PublicSeat[] = [{ faction: 'red', name: 'Brian', isBot: false, discordLinked: true }]
    let capturedBody: unknown
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ seats: claimedSeats }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({ options: {}, entries: [], length: 0, yourFaction: 'red', seats: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('WebSocket', undefined)

    const seen: (readonly PublicSeat[])[] = []
    const session = new Session('', { gameId: 'g', seatToken: 't' }, {
      current: () => null,
      adopt: () => {},
      applyRemote: () => {},
      seats: (s) => seen.push(s),
    })
    await session.claimName('Brian', '<@123456789012345678>')
    expect((capturedBody as { discordId?: string }).discordId).toBe('<@123456789012345678>')
    expect(seen.at(-1)).toEqual(claimedSeats)
    session.leave()
    vi.unstubAllGlobals()
  })

  it('bumps the store seats snapshot on a seats push, so useSyncExternalStore sees a claim', async () => {
    const tail = {
      options: { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 7 },
      entries: [],
      length: 0,
      yourFaction: 'red',
      seats: [{ faction: 'red', isBot: false }],
    }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(tail), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('WebSocket', undefined)

    const before = store.getSeatsSnapshot()
    await store.joinSession('', { gameId: 'g', seatToken: 't' })
    // The join's resync already delivers a seats list, moving the snapshot without moving `result`.
    expect(store.getSeatsSnapshot()).not.toBe(before)
    const afterJoin = store.getSeatsSnapshot()

    // A claim response (a fresh seats push) must bump it again, even though it does not touch the
    // position at all — this is exactly what the "stuck on Saving…" bug depended on: `useGame`'s
    // snapshot is `result`, which a name claim never changes.
    await store.claimName('Brian')
    expect(store.getSeatsSnapshot()).not.toBe(afterJoin)

    store.leaveSession()
    vi.unstubAllGlobals()
  })
})
