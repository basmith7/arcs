/**
 * Player preferences that outlive the tab — the audio ones and how the map is drawn.
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
  /**
   * How far to push the map plate towards a schematic, 0..1. Not a fade: the art goes through a
   * contrast curve that crushes its painted fills to black while leaving the printed line art —
   * planet outlines, resource symbols, sector numbers, slot markers — legible, which is the whole
   * reason a curve was worth having over a fade. Board.tsx turns it into CSS custom properties.
   */
  boardDim: number
  /**
   * Whether someone else's turn replaces the decision surfaces with the turn feed.
   *
   * On by default: playing against bots is the common case, and a menu that is about to answer
   * itself is not a thing to read. Off restores the older behaviour, where every surface is drawn
   * grayed and inert (`Watching`) — which is the better answer for learning the game by watching
   * one, and is why it is a preference rather than a rewrite.
   */
  watchTurns: boolean
  /** Whether the log drawer is a column of the layout rather than a panel over the board. */
  logPinned: boolean
  /**
   * What a phone held upright shows during a game: the phone layout (`phone.css`), or the desktop
   * table shrunk to fit and pinch-zoomed (`phone-canvas.ts`). A phone held sideways always gets the
   * latter — the desktop layout fits there.
   */
  phoneLayout: PhoneLayout
  /** The phone layout's hand: one scrolling row of full-size cards, or every card at once, smaller. */
  phoneHand: PhoneHand
}

export type PhoneLayout = 'mobile' | 'canvas'
export type PhoneHand = 'row' | 'grid'

export const DEFAULTS: Readonly<Settings> = {
  musicEnabled: true,
  // Background music under a game people talk over: audible, never the loudest thing in the room.
  musicVolume: 0.4,
  sfxVolume: 0.6,
  // Off: the board looks the way it was painted until someone asks for otherwise.
  boardDim: 0,
  watchTurns: true,
  // The board is the thing to look at; the log has to be asked for.
  logPinned: false,
  phoneLayout: 'mobile',
  phoneHand: 'row',
}

const KEY = 'arcs:settings'

let current: Settings = { ...DEFAULTS }
let loaded = false

type Listener = () => void
const listeners = new Set<Listener>()

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** A stored number is only a number if it is finite; NaN and Infinity are corruption. */
function unit(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(1, Math.max(0, v))
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback
}

function parse(json: string): Settings {
  const raw = JSON.parse(json) as Record<string, unknown>
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  return {
    musicEnabled: typeof raw['musicEnabled'] === 'boolean' ? raw['musicEnabled'] : DEFAULTS.musicEnabled,
    musicVolume: unit(raw['musicVolume'], DEFAULTS.musicVolume),
    sfxVolume: unit(raw['sfxVolume'], DEFAULTS.sfxVolume),
    boardDim: unit(raw['boardDim'], DEFAULTS.boardDim),
    watchTurns: bool(raw['watchTurns'], DEFAULTS.watchTurns),
    logPinned: bool(raw['logPinned'], DEFAULTS.logPinned),
    phoneLayout: oneOf(raw['phoneLayout'], ['mobile', 'canvas'], DEFAULTS.phoneLayout),
    phoneHand: oneOf(raw['phoneHand'], ['row', 'grid'], DEFAULTS.phoneHand),
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
    musicVolume: patch.musicVolume === undefined ? prev.musicVolume : unit(patch.musicVolume, prev.musicVolume),
    sfxVolume: patch.sfxVolume === undefined ? prev.sfxVolume : unit(patch.sfxVolume, prev.sfxVolume),
    boardDim: patch.boardDim === undefined ? prev.boardDim : unit(patch.boardDim, prev.boardDim),
    watchTurns: patch.watchTurns ?? prev.watchTurns,
    logPinned: patch.logPinned ?? prev.logPinned,
    phoneLayout: oneOf(patch.phoneLayout, ['mobile', 'canvas'], prev.phoneLayout),
    phoneHand: oneOf(patch.phoneHand, ['row', 'grid'], prev.phoneHand),
  }
  /*
   * The no-op guard, over the keys rather than one `&&` per field. It used to name every field,
   * which made adding one a three-place edit where the third place fails *silently*: a settings
   * field left out here still stores and still reads back, it just never notifies, so the app
   * keeps rendering the old value until something else re-renders it.
   */
  if ((Object.keys(DEFAULTS) as (keyof Settings)[]).every((k) => next[k] === prev[k])) return
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
