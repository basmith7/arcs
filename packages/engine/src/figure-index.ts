/**
 * Where each faction's pieces stand, indexed once per figures tracker.
 *
 * The evaluator asked "which cities/ships/starports does this faction have, and where" by scanning
 * every system's contents and parsing every figure id — for every faction, at every probe. That
 * scan was the largest remaining cost after the parse memo (docs/19 §21). Trackers are immutable
 * and shared structurally, so one index per tracker object serves every observation of the same
 * board, and it can never go stale.
 *
 * Order is part of the contract: pieces come in board-system order, then in each system's own
 * order — exactly what the scan it replaces produced, so no tie-break downstream can move.
 */

import { Location, parseFigureId } from './ids.js'
import { contentsOf } from './tracker.js'
import type { ColorId, SystemId } from './ids.js'
import type { Tracker } from './tracker.js'

export interface PlacedFigure {
  readonly id: string
  readonly system: SystemId
}

const EMPTY: readonly PlacedFigure[] = Object.freeze([])
const INDEX = new WeakMap<Tracker, Map<string, readonly PlacedFigure[]>>()

function build(figures: Tracker, systems: readonly SystemId[]): Map<string, readonly PlacedFigure[]> {
  const out = new Map<string, PlacedFigure[]>()
  for (const system of systems) {
    for (const id of contentsOf(figures, Location.system(system))) {
      const f = parseFigureId(id)
      const key = `${f.color}/${f.piece}`
      let list = out.get(key)
      if (list === undefined) out.set(key, (list = []))
      list.push(Object.freeze({ id, system }))
    }
  }
  for (const list of out.values()) Object.freeze(list)
  return out
}

/** `color`'s pieces of kind `piece` on the board, in board-system order. */
export function figuresOf(
  figures: Tracker,
  systems: readonly SystemId[],
  color: ColorId,
  piece: string,
): readonly PlacedFigure[] {
  let index = INDEX.get(figures)
  if (index === undefined) INDEX.set(figures, (index = build(figures, systems)))
  return index.get(`${color}/${piece}`) ?? EMPTY
}

const COLORS = new WeakMap<Tracker, Map<SystemId, ReadonlySet<ColorId>>>()

/** The colours with any figure in `system` — indexed once per tracker, like `figuresOf`. */
export function colorsIn(figures: Tracker, systems: readonly SystemId[], system: SystemId): ReadonlySet<ColorId> {
  let index = COLORS.get(figures)
  if (index === undefined) {
    index = new Map()
    for (const s of systems) {
      index.set(s, new Set(contentsOf(figures, Location.system(s)).map((id) => parseFigureId(id).color)))
    }
    COLORS.set(figures, index)
  }
  return index.get(system) ?? new Set()
}
