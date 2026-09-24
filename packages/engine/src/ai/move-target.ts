/**
 * Where ships should go, as a ranking of Move destinations (spec 2026-09-23 rev 3, section C1).
 *
 * The evaluator cannot see position, so every destination of a Move ask scored the same and the
 * earliest offer won. The obvious fix — a positional *pull* in the state evaluator — was built and
 * measured worse (`mobile.ts`): "purposeful-looking movement bought by pips that standard spends on
 * the economy". A state feature raises the value of *moving at all*.
 *
 * This is an action-level term instead, and a **zero-sum** one. At an ask offering Move
 * destinations, each destination scores the progress it makes toward the targets the chapter
 * intent names, and then the mean over the offered destinations is subtracted. The terms over any
 * ask sum to zero, so they can re-rank destinations but cannot make Move beat Build — the Move
 * destination is its own ask, after Move was already chosen at the pip menu.
 *
 * Targets by ambition, from what that ambition scores:
 *   - Tycoon, Keeper, Empath — a planet producing the resource, where this faction has no building
 *     yet (a city there is income for that ambition);
 *   - Tyrant — a system with a rival building (raiding a city takes captives);
 *   - Warlord — a system with any rival piece (destroyed pieces become trophies).
 * Each ambition's progress is weighted by how hard the intent pursues it.
 */

import { board as boardOf } from '../board.js'
import { planetResource } from '../control.js'
import { colorsIn, figuresOf } from '../figure-index.js'
import type { Action } from '../action.js'
import type { BoardVariant } from '../board.js'
import type { FactionId, SystemId } from '../ids.js'
import type { ObservedState } from '../observe.js'
import type { Resource } from '../resources.js'
import type { Ambition } from '../state.js'
import type { ChapterIntent } from './intent.js'

const DISTANCES = new Map<string, ReadonlyMap<SystemId, ReadonlyMap<SystemId, number>>>()

/** All-pairs gate distance (BFS over the board's adjacency), once per board. */
export function gateDistances(board: BoardVariant): ReadonlyMap<SystemId, ReadonlyMap<SystemId, number>> {
  const hit = DISTANCES.get(board.name)
  if (hit !== undefined) return hit
  const all = new Map<SystemId, ReadonlyMap<SystemId, number>>()
  for (const from of board.systems) {
    const d = new Map<SystemId, number>([[from, 0]])
    let frontier = [from]
    while (frontier.length > 0) {
      const next: SystemId[] = []
      for (const s of frontier) {
        for (const n of board.adjacency.get(s) ?? []) {
          if (d.has(n)) continue
          d.set(n, d.get(s)! + 1)
          next.push(n)
        }
      }
      frontier = next
    }
    all.set(from, d)
  }
  DISTANCES.set(board.name, all)
  return all
}

const PRODUCES: Readonly<Partial<Record<Ambition, readonly Resource[]>>> = {
  Tycoon: ['Material', 'Fuel'],
  Keeper: ['Relic'],
  Empath: ['Psionic'],
}

/** The systems each pursued ambition wants ships near. */
export function intentTargets(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
): ReadonlyMap<Ambition, readonly SystemId[]> {
  const systems = observed.board.systems
  const built = new Set<SystemId>([
    ...figuresOf(observed.figures, systems, self, 'City').map((p) => p.system),
    ...figuresOf(observed.figures, systems, self, 'Starport').map((p) => p.system),
  ])
  const rivals = observed.colors.filter((c) => c !== self)
  const rivalBuilt = new Set<SystemId>()
  for (const r of rivals) {
    for (const piece of ['City', 'Starport']) {
      for (const p of figuresOf(observed.figures, systems, r, piece)) rivalBuilt.add(p.system)
    }
  }
  const out = new Map<Ambition, readonly SystemId[]>()
  for (const [ambition, pull] of intent.pursuing) {
    if (pull <= 0) continue
    const produces = PRODUCES[ambition]
    let targets: SystemId[]
    if (produces !== undefined) {
      targets = systems.filter((s) => {
        const r = planetResource(observed, s)
        return r !== undefined && produces.includes(r) && !built.has(s)
      })
    } else if (ambition === 'Tyrant') {
      targets = systems.filter((s) => rivalBuilt.has(s))
    } else {
      targets = systems.filter((s) => {
        const colors = colorsIn(observed.figures, systems, s)
        return colors.size > (colors.has(self) ? 1 : 0)
      })
    }
    if (targets.length > 0) out.set(ambition, targets)
  }
  return out
}

/**
 * The zero-sum destination terms for one ask: absent for anything that is not a Move pick, and
 * summing to zero over the Move picks present.
 */
export function moveTowardTerms(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
  actions: readonly Action[],
): ReadonlyMap<Action, number> {
  const moves = actions.filter((a) => a.type === 'action/move-pick')
  const out = new Map<Action, number>()
  if (moves.length === 0) return out
  const d = gateDistances(boardOf(observed.board.name))
  const targets = intentTargets(observed, self, intent)
  const near = (s: SystemId, ts: readonly SystemId[]): number =>
    Math.min(...ts.map((t) => d.get(s)?.get(t) ?? 99))
  const raw = moves.map((a) => {
    let v = 0
    for (const [ambition, ts] of targets) {
      const pull = intent.pursuing.get(ambition) ?? 0
      v += pull * (near(String(a['from']), ts) - near(String(a['to']), ts))
    }
    return v
  })
  const mean = raw.reduce((n, v) => n + v, 0) / raw.length
  moves.forEach((a, i) => out.set(a, raw[i]! - mean))
  return out
}
