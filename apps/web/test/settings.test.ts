/**
 * The settings store: audio preferences that outlive the tab.
 *
 * The same shape as `persist.test.ts` — vitest's node environment has no localStorage, so the
 * module's capability guard makes it a silent no-op there, and these tests stub a Map-backed
 * storage to exercise the real path. The interesting cases are all *bad* stored values: a
 * settings blob is user-writable and survives across versions, so every read is clamped and
 * type-checked rather than trusted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULTS, getSettings, reloadSettings, setSettings, subscribe } from '../src/settings.js'

const KEY = 'arcs:settings'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
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

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
  reloadSettings()
})
afterEach(() => {
  vi.unstubAllGlobals()
  // The next test's `reloadSettings` reads its own storage; leave nothing cached from this one.
  reloadSettings()
})

describe('the settings store', () => {
  it('starts at the defaults when nothing is stored', () => {
    expect(getSettings()).toEqual(DEFAULTS)
  })

  it('round-trips a change through storage', () => {
    setSettings({ musicVolume: 0.25, musicEnabled: false })
    expect(getSettings().musicVolume).toBe(0.25)
    expect(getSettings().musicEnabled).toBe(false)
    // The "refresh": a fresh read with only the storage surviving.
    reloadSettings()
    expect(getSettings()).toEqual({ ...DEFAULTS, musicVolume: 0.25, musicEnabled: false })
  })

  it('leaves untouched fields alone', () => {
    setSettings({ sfxVolume: 0.1 })
    expect(getSettings().musicVolume).toBe(DEFAULTS.musicVolume)
    expect(getSettings().sfxVolume).toBe(0.1)
  })

  it('clamps volumes to 0..1, whichever end they came off', () => {
    setSettings({ musicVolume: 4, sfxVolume: -2 })
    expect(getSettings().musicVolume).toBe(1)
    expect(getSettings().sfxVolume).toBe(0)
    localStorage.setItem(KEY, JSON.stringify({ musicVolume: 99, sfxVolume: -99 }))
    reloadSettings()
    expect(getSettings().musicVolume).toBe(1)
    expect(getSettings().sfxVolume).toBe(0)
  })

  it('falls back to the defaults for values of the wrong type, field by field', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ musicEnabled: 'yes', musicVolume: null, sfxVolume: 0.3, extra: 1 }),
    )
    reloadSettings()
    // The one good field survives; the two bad ones are replaced rather than poisoning the rest.
    expect(getSettings()).toEqual({ ...DEFAULTS, sfxVolume: 0.3 })
  })

  it('treats NaN as a bad value, not a number', () => {
    localStorage.setItem(KEY, JSON.stringify({ musicVolume: Number.NaN }))
    reloadSettings()
    expect(getSettings().musicVolume).toBe(DEFAULTS.musicVolume)
  })

  it('a corrupt blob costs the defaults, not a crash', () => {
    localStorage.setItem(KEY, '{not json')
    reloadSettings()
    expect(getSettings()).toEqual(DEFAULTS)
  })

  it('hands React a new snapshot on change and the same one otherwise', () => {
    const before = getSettings()
    expect(getSettings()).toBe(before)
    setSettings({ musicVolume: 0.9 })
    expect(getSettings()).not.toBe(before)
    const after = getSettings()
    // A write that changes nothing must not churn the snapshot — it would re-render the app.
    setSettings({ musicVolume: 0.9 })
    expect(getSettings()).toBe(after)
  })

  it('notifies subscribers, once per real change', () => {
    let calls = 0
    const off = subscribe(() => void calls++)
    setSettings({ musicEnabled: false })
    expect(calls).toBe(1)
    setSettings({ musicEnabled: false })
    expect(calls).toBe(1)
    off()
    setSettings({ musicEnabled: true })
    expect(calls).toBe(1)
  })

  it('works with no storage at all — the preference just does not outlive the tab', () => {
    vi.unstubAllGlobals()
    reloadSettings()
    expect(getSettings()).toEqual(DEFAULTS)
    setSettings({ musicVolume: 0.2 })
    expect(getSettings().musicVolume).toBe(0.2)
  })
})
