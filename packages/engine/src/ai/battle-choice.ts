/**
 * Where to fight and whom to hit (spec 2026-09-23 family, C5 — docs/19 §23).
 *
 * The tie audit found both choices falling to offer order: 78% of `battle/system` and 81% of
 * `battle/target` decisions scored exactly level, because the evaluator's lookahead stops before
 * the dice and every option looks the same from there. Like `moveToward`, this only ranks options
 * within one ask (zero-sum), so it cannot make battling more or less attractive than anything else.
 *
 *   - **System:** our undamaged ships there minus every rival ship there, plus half a point per
 *     rival building (what a raid can take). Fight where the odds and the prize are best.
 *   - **Target:** the rival's power (a tenth of it) plus half a point per building of theirs in the
 *     system. Hit the leader — denial, which scoring every rival under one intent never sees.
 */
import { figuresOf } from '../figure-index.js'
import { projectedPower } from './value.js'
import type { Action } from '../action.js'
import type { ColorId, FactionId, SystemId } from '../ids.js'
import type { ObservedState } from '../observe.js'
import type { ChapterIntent } from './intent.js'

function count(observed: ObservedState, color: ColorId, piece: string, system: SystemId): number {
  return figuresOf(observed.figures, observed.board.systems, color, piece).filter((p) => p.system === system)
    .length
}

export function battleChoiceTerms(
  observed: ObservedState,
  self: FactionId,
  _intent: ChapterIntent,
  actions: readonly Action[],
): ReadonlyMap<Action, number> {
  const out = new Map<Action, number>()
  const rivals = observed.colors.filter((c) => c !== self)
  const buildings = (c: ColorId, s: SystemId): number => count(observed, c, 'City', s) + count(observed, c, 'Starport', s)

  const score = (a: Action): number | undefined => {
    if (a.type === 'battle/system') {
      const s = String(a['system'])
      const ours = figuresOf(observed.figures, observed.board.systems, self, 'Ship').filter(
        (p) => p.system === s && !observed.damaged.includes(p.id),
      ).length
      const theirs = rivals.reduce((n, c) => n + count(observed, c, 'Ship', s), 0)
      const prize = rivals.reduce((n, c) => n + buildings(c, s), 0)
      return ours - theirs + 0.5 * prize
    }
    if (a.type === 'battle/target') {
      const e = String(a['enemy']) as ColorId
      const power = observed.factions.includes(e as FactionId) ? projectedPower(observed, e as FactionId) : 0
      return power / 10 + 0.5 * buildings(e, String(a['system']))
    }
    return undefined
  }

  for (const type of ['battle/system', 'battle/target']) {
    const group = actions.filter((a) => a.type === type)
    if (group.length === 0) continue
    const raw = group.map((a) => score(a)!)
    const mean = raw.reduce((n, v) => n + v, 0) / raw.length
    group.forEach((a, i) => out.set(a, raw[i]! - mean))
  }
  return out
}
