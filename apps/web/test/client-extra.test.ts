import { afterEach, describe, expect, it, vi } from 'vitest'

import { MultiplayerClient } from '../src/multiplayer/client.js'

const calls: { url: string; init?: RequestInit }[] = []
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
})

describe('MultiplayerClient extras', () => {
  it('sends bots and webhookUrl on create', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return reply({ gameId: 'g', seats: [] }, 201)
    })
    const c = new MultiplayerClient('')
    await c.create({ board: 'b' }, ['red', 'blue'], { bots: ['blue'], webhookUrl: 'https://discord.com/api/webhooks/1/x' })
    expect(calls[0]!.url).toBe('/games')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      options: { board: 'b' },
      factions: ['red', 'blue'],
      bots: ['blue'],
      webhookUrl: 'https://discord.com/api/webhooks/1/x',
    })
  })

  it('claims a name and returns the seats', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return reply({ seats: [{ faction: 'red', name: 'Brian', isBot: false }] })
    })
    const c = new MultiplayerClient('')
    const seats = await c.claimName('g', 'tok', 'Brian')
    expect(calls[0]!.url).toBe('/games/g/seat')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ seatToken: 'tok', name: 'Brian' })
    expect(seats[0]!.name).toBe('Brian')
  })
})
