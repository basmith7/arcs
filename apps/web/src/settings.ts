/**
 * Player preferences that outlive the tab — today, the audio ones.
 *
 * The shelf is `persist.ts`'s: localStorage, capability-checked and try/caught, because a browser
 * that will not store a preference must cost the preference and never an error. What is different
 * is that the *game* is a single opaque blob while this is a small record of independent fields,
 * so a stored value that is missing, out of range or of the wrong type falls back **per field**.
 * A settings blob is user-writable and outlives the version that wrote it; one bad key should not
 * take the others with it.
 *
 * The snapshot is cached and replaced only when a value actually changes, which is what makes it
 * safe for `useSyncExternalStore` — the store's own contract (see the note on `seatsVersion` in
 * store.ts): identity is the change signal, so a no-op write must not re-render the app.
 */

import { useSyncExternalStore } from 'react'

export interface Settings {
  /** Whether the background music plays at all. Volume is remembered across a mute. */
  musicEnabled: boolean
  /** 0..1, straight onto `HTMLMediaElement.volume`. */
  musicVolume: number
  /** 0..1. Nothing emits sound effects yet; the preference is stored for when something does. */
  sfxVolume: number
}

export const DEFAULTS: Readonly<Settings> = {
  musicEnabled: true,
  // Background music under a game people talk over: audible, never the loudest thing in the room.
  musicVolume: 0.4,
  sfxVolume: 0.6,
}

const KEY = 'arcs:settings'

let current: Settings = { ...DEFAULTS }
let loaded = false

type Listener = () => void
const listeners = new Set<Listener>()

/** A stored number is only a number if it is finite; NaN and Infinity are corruption. */
function volume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(1, Math.max(0, v))
}

function parse(json: string): Settings {
  const raw = JSON.parse(json) as Record<string, unknown>
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  return {
    musicEnabled: typeof raw['musicEnabled'] === 'boolean' ? raw['musicEnabled'] : DEFAULTS.musicEnabled,
    musicVolume: volume(raw['musicVolume'], DEFAULTS.musicVolume),
    sfxVolume: volume(raw['sfxVolume'], DEFAULTS.sfxVolume),
  }
}

/**
 * Re-read storage, discarding the cached snapshot.
 *
 * Called once on first read, and directly by the tests — and it is the honest way to pick up a
 * change another tab made, should anything ever want to.
 */
export function reloadSettings(): void {
  loaded = true
  current = { ...DEFAULTS }
  if (typeof localStorage === 'undefined') return
  try {
    const json = localStorage.getItem(KEY)
    if (json !== null) current = parse(json)
  } catch {
    /* no storage, or a corrupt blob: the defaults, which is a working app */
  }
}

function write(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* no storage, no memory of the preference past this tab */
  }
}

export function getSettings(): Settings {
  if (!loaded) reloadSettings()
  return current
}

/** Change one or more fields. Values are clamped exactly as stored ones are. */
export function setSettings(patch: Partial<Settings>): void {
  const prev = getSettings()
  const next: Settings = {
    musicEnabled: patch.musicEnabled ?? prev.musicEnabled,
    musicVolume: patch.musicVolume === undefined ? prev.musicVolume : volume(patch.musicVolume, prev.musicVolume),
    sfxVolume: patch.sfxVolume === undefined ? prev.sfxVolume : volume(patch.sfxVolume, prev.sfxVolume),
  }
  if (
    next.musicEnabled === prev.musicEnabled &&
    next.musicVolume === prev.musicVolume &&
    next.sfxVolume === prev.sfxVolume
  ) {
    return
  }
  current = next
  write()
  for (const cb of listeners) cb()
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings)
}
