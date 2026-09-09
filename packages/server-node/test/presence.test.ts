import { describe, expect, it, vi } from 'vitest'

import { Presence } from '../src/presence.js'

const OPEN = 1
const CLOSED = 3

function fakeSocket(readyState = OPEN) {
  return {
    readyState,
    OPEN,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data)
    },
  }
}

describe('Presence', () => {
  it('is active right after connect, inactive after activeMs with no touch, active again after touch', () => {
    let clock = 0
    const presence = new Presence({ now: () => clock, activeMs: 1000 })
    const socket = fakeSocket()
    presence.connect('g1', 's1', socket)
    expect(presence.isActive('g1', 's1')).toBe(true)
    clock += 1001
    expect(presence.isActive('g1', 's1')).toBe(false)
    presence.touch('g1', 's1')
    expect(presence.isActive('g1', 's1')).toBe(true)
  })

  it('is inactive with no sockets even if recently active', () => {
    let clock = 0
    const presence = new Presence({ now: () => clock, activeMs: 1000 })
    const socket = fakeSocket()
    const unregister = presence.connect('g1', 's1', socket)
    unregister()
    expect(presence.isActive('g1', 's1')).toBe(false)
  })

  it('send counts only OPEN sockets', () => {
    const presence = new Presence()
    const a = fakeSocket(OPEN)
    const b = fakeSocket(CLOSED)
    presence.connect('g1', 's1', a)
    presence.connect('g1', 's1', b)
    const count = presence.send('g1', 's1', { hello: 1 })
    expect(count).toBe(1)
    expect(a.sent).toHaveLength(1)
    expect(JSON.parse(a.sent[0]!)).toEqual({ hello: 1 })
    expect(b.sent).toHaveLength(0)
  })

  it('onLeave fires once when the last socket unregisters, not when one of two does', () => {
    const presence = new Presence()
    const left: string[] = []
    presence.onLeave((gameId, seatToken) => left.push(`${gameId}/${seatToken}`))
    const a = fakeSocket()
    const b = fakeSocket()
    const unA = presence.connect('g1', 's1', a)
    const unB = presence.connect('g1', 's1', b)
    unA()
    expect(left).toHaveLength(0)
    unB()
    expect(left).toEqual(['g1/s1'])
  })

  it('touch on an unknown seat does not create an entry', () => {
    const presence = new Presence()
    presence.touch('g1', 'unknown')
    expect(presence.isActive('g1', 'unknown')).toBe(false)
    expect(presence.send('g1', 'unknown', { x: 1 })).toBe(0)
  })

  it('unregistering twice does not double-fire onLeave', () => {
    const presence = new Presence()
    const listener = vi.fn()
    presence.onLeave(listener)
    const a = fakeSocket()
    const un = presence.connect('g1', 's1', a)
    un()
    un()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
