/**
 * Three action-level terms for the weekend lab (docs/19 §24), each aimed at a choice the coverage
 * report or the tie audit showed the evaluator cannot separate. All weight 0 in every shipped set.
 *
 *   - `garrisonTerms` (C6) — fleet size. 100% of fleet-size decisions tied, so the bot always moved
 *     every ship and left home empty. Keep as many ships at a system with our buildings as there are
 *     rival ships within one gate of it; zero-sum over one fleet-size ask.
 *   - `takeMoveTerms` (C7) — the pip menu, 78% tied. A small nudge toward Move when some fleet can
 *     close on an intent target (the `moveToward` notion of progress). Not zero-sum: meant to run at
 *     a weight low enough to act only on near-ties.
 *   - `guildUseTerms` (C8) — guild Prelude abilities, offered 483 times and never taken: the
 *     evaluator charges the discarded card at its full holding worth and prices the effect low.
 *     A flat bonus per ability, its size chosen by probe.
 */
import { board as boardOf } from '../board.js'
import { figuresOf } from '../figure-index.js'
import { gateDistances, intentTargets } from './move-target.js'
import type { Action } from '../action.js'
import type { FactionId, SystemId } from '../ids.js'
import type { ObservedState } from '../observe.js'
import type { ChapterIntent } from './intent.js'

/** Rival ships at `system` or one gate from it. */
function threatNear(observed: ObservedState, self: FactionId, system: SystemId): number {
  const d = gateDistances(boardOf(observed.board.name))
  let n = 0
  for (const c of observed.colors) {
    if (c === self) continue
    for (const p of figuresOf(observed.figures, observed.board.systems, c, 'Ship')) {
      if ((d.get(system)?.get(p.system) ?? 99) <= 1) n++
    }
  }
  return n
}

export function garrisonTerms(
  observed: ObservedState,
  self: FactionId,
  _intent: ChapterIntent,
  actions: readonly Action[],
  threatAt: (system: SystemId) => number = (s) => threatNear(observed, self, s),
): ReadonlyMap<Action, number> {
  const out = new Map<Action, number>()
  const moves = actions.filter((a) => a.type === 'action/move-ships')
  if (moves.length === 0) return out
  const from = String(moves[0]!['from'])
  const systems = observed.board.systems
  const here = figuresOf(observed.figures, systems, self, 'Ship').filter((p) => p.system === from).length
  const buildings =
    figuresOf(observed.figures, systems, self, 'City').filter((p) => p.system === from).length +
    figuresOf(observed.figures, systems, self, 'Starport').filter((p) => p.system === from).length
  const keep = buildings > 0 ? Math.min(here, threatAt(from)) : 0
  const raw = moves.map((a) => -Math.max(0, keep - (here - Number(a['count']))))
  const mean = raw.reduce((n, v) => n + v, 0) / raw.length
  moves.forEach((a, i) => out.set(a, raw[i]! - mean))
  return out
}

export function takeMoveTerms(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
  actions: readonly Action[],
): ReadonlyMap<Action, number> {
  const out = new Map<Action, number>()
  const move = actions.find((a) => a.type === 'action/take' && a['action'] === 'Move')
  if (move === undefined) return out
  const d = gateDistances(boardOf(observed.board.name))
  const targets = intentTargets(observed, self, intent)
  const near = (s: SystemId, ts: readonly SystemId[]): number => Math.min(...ts.map((t) => d.get(s)?.get(t) ?? 99))
  let best = 0
  const fleets = new Set(figuresOf(observed.figures, observed.board.systems, self, 'Ship').map((p) => p.system))
  for (const s of fleets) {
    for (const n of observed.board.adjacency.get(s) ?? []) {
      let v = 0
      for (const [ambition, ts] of targets) v += (intent.pursuing.get(ambition) ?? 0) * (near(s, ts) - near(n, ts))
      best = Math.max(best, v)
    }
  }
  out.set(move, best)
  return out
}

export function guildUseTerms(
  _observed: ObservedState,
  _self: FactionId,
  _intent: ChapterIntent,
  actions: readonly Action[],
): ReadonlyMap<Action, number> {
  const out = new Map<Action, number>()
  for (const a of actions) if (a.type === 'turn/prelude-guild') out.set(a, 1)
  return out
}
