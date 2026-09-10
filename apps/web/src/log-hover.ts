/**
 * Which systems the log is pointing at right now.
 *
 * ## Why a store and not a prop
 *
 * The log and the map are not near each other in the tree — the drawer is a sibling of the whole
 * board column, and the same rows are also drawn as the turn feed *over* the map (`LogPanel`'s
 * `only="last-turn"`). Threading a callback from `App` down both paths would put a second copy of
 * the rule in the feed, which is precisely the split that `surfaces.ts` documents at length: one
 * behaviour expressed in two places is one behaviour that will disagree with itself. A module
 * store is what makes both mounts the same mount as far as the map is concerned.
 *
 * ## Why it holds systems rather than the row
 *
 * The map only ever needs to know where to point. Keeping the answer as a list of system ids means
 * `Board` never learns what a log row is, and a future caller — a battle window, a player board —
 * can light the same reticles without going through the log at all.
 *
 * Hover only, deliberately: nothing here is pinned or persisted, so there is no state to get stuck
 * in and nothing to clean up when the drawer closes. The snapshot follows `settings.ts`'s contract
 * for `useSyncExternalStore` — identity *is* the change signal, so a no-op write must return the
 * very same array or the map re-renders on every mouse move across a row.
 */

import { useSyncExternalStore } from 'react'

const NONE: readonly string[] = []

let current: readonly string[] = NONE
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Exported for the hook below, and so the no-op contract above can be tested without a DOM. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Point the map at these systems. An identical set is a no-op, down to the array's identity. */
export function hoverSystems(systems: readonly string[]): void {
  if (systems.length === current.length && systems.every((s, i) => s === current[i])) return
  current = systems.length === 0 ? NONE : [...systems]
  emit()
}

/** Stop pointing. Separate from `hoverSystems([])` only in that it reads as what it means. */
export function clearHover(): void {
  hoverSystems(NONE)
}

export function hoveredSystems(): readonly string[] {
  return current
}

/** Subscribe the map to the log's pointing. */
export function useHoveredSystems(): readonly string[] {
  return useSyncExternalStore(subscribe, hoveredSystems, hoveredSystems)
}
