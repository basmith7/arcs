/**
 * What bots are offered and what they take — the coverage report's and the probe criteria's
 * instrument (spec 2026-09-23 rev 3, sections 6 and C1).
 *
 * Keys: the action `type`; the pip menu broken out by action (`take:Move`); guild Prelude abilities
 * by ability (`guild:<kind>`). A key is counted as *offered* once per decision whose menu contains it,
 * and *taken* when chosen — so taken/offered is a take rate, not a share of menu items.
 */
import type { Action, FactionId } from '@arcs/engine'

export interface Tally {
  offered: Record<string, number>
  taken: Record<string, number>
  /** Move legs that exactly undo the same faction's previous leg within one card play. */
  reversals: number
  decisions: number
}

export const emptyTally = (): Tally => ({ offered: {}, taken: {}, reversals: 0, decisions: 0 })

const keyOf = (a: Action): string =>
  a.type === 'action/take'
    ? `take:${String(a['action'])}`
    : a.type === 'turn/prelude-guild'
      ? `guild:${String(a['ability'])}`
      : a.type

const CARD_PLAYS = new Set(['turn/lead', 'turn/surpass', 'turn/pivot', 'turn/copy', 'turn/pass', 'turn/seize'])

/** A recorder feeding per-bot tallies; `botOf` maps a faction to the bot id in its seat. */
export function recorder(
  tallies: Map<string, Tally>,
  botOf: (f: FactionId) => string,
): (faction: FactionId, offered: readonly Action[], taken: Action) => void {
  const lastLeg = new Map<FactionId, { from: string; to: string }>()
  return (faction, offered, taken) => {
    const id = botOf(faction)
    let t = tallies.get(id)
    if (t === undefined) tallies.set(id, (t = emptyTally()))
    t.decisions++
    for (const k of new Set(offered.map(keyOf))) t.offered[k] = (t.offered[k] ?? 0) + 1
    const k = keyOf(taken)
    t.taken[k] = (t.taken[k] ?? 0) + 1
    if (CARD_PLAYS.has(taken.type)) lastLeg.delete(faction)
    if (taken.type === 'action/move-pick') {
      const leg = { from: String(taken['from']), to: String(taken['to']) }
      const prev = lastLeg.get(faction)
      if (prev !== undefined && prev.from === leg.to && prev.to === leg.from) t.reversals++
      lastLeg.set(faction, leg)
    }
  }
}

export function merge(into: Tally, t: Tally): void {
  for (const [k, v] of Object.entries(t.offered)) into.offered[k] = (into.offered[k] ?? 0) + v
  for (const [k, v] of Object.entries(t.taken)) into.taken[k] = (into.taken[k] ?? 0) + v
  into.reversals += t.reversals
  into.decisions += t.decisions
}

/** Share of pip-menu choices that were Move. */
export function moveShare(t: Tally): number {
  const takes = Object.entries(t.taken).filter(([k]) => k.startsWith('take:'))
  const all = takes.reduce((n, [, v]) => n + v, 0)
  return all === 0 ? 0 : (t.taken['take:Move'] ?? 0) / all
}
