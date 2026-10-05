/**
 * The turn catch-up's page-side rules (spec 2026-10-04-scoreboard-catchup-design.md): who gets the
 * card, and remembering that it was dismissed. The dismissal lives under its own localStorage key,
 * not in Settings — it is a fact about one turn of one game, not a preference — and holds one
 * turn start per game and seat, so the next turn's card shows again by itself.
 */

import type { Continue } from '@arcs/engine'

import type { SeatView } from './multiplayer/seat.js'

const KEY = 'arcs:catchup-dismissed'

function read(): Record<string, number> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function write(all: Record<string, number>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* private mode or full: the card just comes back on reload */
  }
}

const seatKey = (gameId: string, faction: string): string => `${gameId}:${faction}`

export function catchupDismissed(gameId: string, faction: string, turn: number): boolean {
  return read()[seatKey(gameId, faction)] === turn
}

export function dismissCatchup(gameId: string, faction: string, turn: number): void {
  write({ ...read(), [seatKey(gameId, faction)]: turn })
}

export function reopenCatchup(gameId: string, faction: string): void {
  const { [seatKey(gameId, faction)]: _, ...rest } = read()
  write(rest)
}

/** The card is for a seated player, on their own turn — never a spectator or a hot-seat table. */
export function shouldShowCatchup(view: SeatView, cont: Continue): boolean {
  return view.kind === 'seat' && cont.kind === 'ask' && cont.faction === view.faction
}
