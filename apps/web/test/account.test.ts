import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAccount, loadAccount, signInHref } from '../src/account.js'
import { rememberedSeats } from '../src/multiplayer/link.js'

function fakeStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('account', () => {
  it('loads the signed-in account from /me', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ account: { displayName: 'Brian', discordName: 'bri' }, enabled: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await loadAccount('')
    expect(getAccount()).toEqual({
      loaded: true,
      enabled: true,
      account: { displayName: 'Brian', discordName: 'bri' },
      signinFailed: false,
    })
  })

  it('treats a failed fetch as login disabled', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })
    await loadAccount('')
    expect(getAccount()).toEqual({ loaded: true, enabled: false, account: null, signinFailed: false })
  })

  it('builds the sign-in href with the return hash encoded', () => {
    expect(signInHref('', '#/g/a/s/b')).toBe('/auth/discord?return=%23%2Fg%2Fa%2Fs%2Fb')
  })
})

describe('rememberedSeats', () => {
  it('returns every stashed seat, ignoring unrelated keys', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({ 'arcs:seat:g1': 't1', 'arcs:settings': 'x', 'arcs:seat:g2': 't2' }),
    )
    expect(rememberedSeats()).toEqual([
      { gameId: 'g1', seatToken: 't1' },
      { gameId: 'g2', seatToken: 't2' },
    ])
  })
})
