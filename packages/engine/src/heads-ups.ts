/**
 * One seat's catch-up facts: the public `gameFacts`, that seat's own hand, the log since its
 * previous turn, and the heads-ups code picks out for it (spec 2026-10-04-scoreboard-catchup).
 *
 * Heads-ups state facts — "X happened / X is true" — and never suggest a move. Texts use faction
 * ids; the page and the server substitute player names. The hand is read only through `observe`,
 * so another seat's hand is out of reach here, as it is for the bots.
 */

import type { RuleRegistry } from './dispatch.js'
import { gameFacts, piecesIn } from './facts.js'
import type { FactionFacts, GameFacts } from './facts.js'
import { CourtPile, courtCard } from './court.js'
import { Location, parseFigureId } from './ids.js'
import type { FactionId, SystemId } from './ids.js'
import { observe } from './observe.js'
import type { Resource } from './resources.js'
import { metric } from './rules/ambitions.js'
import type { Ambition, GameState } from './state.js'
import { contentsOf } from './tracker.js'

export type HeadsUpKind = 'rival-tax-base' | 'overtake-risk' | 'outnumbered' | 'first-place' | 'hand'

export interface HeadsUp {
  readonly kind: HeadsUpKind
  readonly text: string
}

export interface SeatFacts extends GameFacts {
  readonly self: FactionId
  /** This seat's own hand only, via `observe`. */
  readonly hand: readonly string[]
  /** Log lines since this seat's previous turn. */
  readonly since: readonly string[]
  readonly headsUps: readonly HeadsUp[]
}

const MAX_HEADS_UPS = 4

/** The resources that score an ambition; Tyrant and Warlord score captives and trophies. */
const SCORES: Readonly<Record<Ambition, readonly Resource[]>> = {
  Tycoon: ['Material', 'Fuel'],
  Keeper: ['Relic'],
  Empath: ['Psionic'],
  Tyrant: [],
  Warlord: [],
}

// Every journal entry names its actor as a top-level `faction="…"` argument; nested `then` JSON
// writes `"faction":` and so never matches.
const factionOf = (encoded: string): string | undefined => /faction="([a-z]+)"/.exec(encoded)?.[1]

/** Journal index just after this faction's previous turn ended; 0 if it has not had one. */
export function sinceLastTurn(journal: readonly string[], faction: FactionId): number {
  let i = journal.length - 1
  while (i >= 0 && factionOf(journal[i]!) === faction) i-- // the turn in progress
  while (i >= 0 && factionOf(journal[i]!) !== faction) i-- // everyone else since
  return i + 1
}

/** The strict leader of an ambition, or undefined on a tie or when nobody holds any. */
function leader(state: GameState, ambition: Ambition): FactionId | undefined {
  const rows = state.factions.map((f) => ({ f, v: metric(state, f, ambition) })).sort((a, b) => b.v - a.v)
  const [first, second] = rows
  if (first === undefined || first.v === 0 || (second !== undefined && second.v === first.v)) return undefined
  return first.f
}

/** Does `f` have strictly the most agents on a court card whose guild deals in one of `rs`? */
function canSecure(state: GameState, f: FactionId, rs: readonly Resource[]): boolean {
  for (const [loc, ids] of state.figures.contents) {
    if (!loc.startsWith('court:agents:')) continue
    const card = contentsOf(state.courtCards, CourtPile.slot(Number(loc.slice('court:agents:'.length))))[0]
    const suit = card === undefined ? undefined : courtCard(card).suit
    if (suit === undefined || !rs.includes(suit)) continue
    const by = new Map<string, number>()
    for (const id of ids) {
      const c = parseFigureId(id).color
      by.set(c, (by.get(c) ?? 0) + 1)
    }
    const mine = by.get(f) ?? 0
    if (mine > 0 && [...by].every(([c, n]) => c === f || n < mine)) return true
  }
  return false
}

export function seatFacts(before: GameState, now: GameState, faction: FactionId, registry: RuleRegistry): SeatFacts {
  const facts = gameFacts(now, registry)
  const was = gameFacts(before, registry)
  const of = (fs: GameFacts, f: FactionId): FactionFacts | undefined => fs.factions.find((x) => x.faction === f)
  const rivals = now.factions.filter((f) => f !== faction)
  const declared = [...new Set(now.declared.map((d) => d.ambition))]
  const hand = observe(now, faction).hand
  const list: HeadsUp[] = []

  // 1. A rival gained tax base in a resource an ambition you declared scores.
  const mine = new Set(now.declared.filter((d) => d.by === faction).map((d) => d.ambition))
  for (const a of mine) {
    for (const r of SCORES[a]) {
      for (const rival of rivals) {
        if ((of(facts, rival)?.taxBase[r] ?? 0) > (of(was, rival)?.taxBase[r] ?? 0)) {
          list.push({ kind: 'rival-tax-base', text: `${rival} can now tax ${r} — it counts toward ${a}.` })
        }
      }
    }
  }

  // 2. A rival one Tax or one Secure from tying (or passing) you on a declared ambition you lead.
  for (const a of declared) {
    const rs = SCORES[a]
    if (rs.length === 0 || leader(now, a) !== faction) continue
    const lead = metric(now, faction, a)
    for (const rival of rivals) {
      const theirs = metric(now, rival, a)
      if (theirs < lead - 1) continue
      const how = rs.some((r) => (of(facts, rival)?.taxBase[r] ?? 0) > 0)
        ? 'Tax'
        : canSecure(now, rival, rs)
          ? 'Secure'
          : undefined
      if (how === undefined) continue
      list.push({ kind: 'overtake-risk', text: `${rival} is one ${how} from ${theirs + 1 > lead ? 'overtaking' : 'tying'} you on ${a}.` })
    }
  }

  // 3. A rival with more ships where you have pieces, armed: a Weapon held or Aggression played this chapter.
  let chapterStart = now.log.length - 1
  while (chapterStart > 0 && !/^Chapter \d+:/.test(now.log[chapterStart]!)) chapterStart--
  const thisChapter = now.log.slice(Math.max(0, chapterStart))
  const armed = (rival: FactionId): boolean =>
    (of(facts, rival)?.resources.includes('Weapon') ?? false) ||
    thisChapter.some((l) => new RegExp(`^${rival} (led|surpassed|pivoted) with Aggression-`).test(l))
  let outnumbered = false
  for (const s of now.board.systems as readonly SystemId[]) {
    const present = contentsOf(now.figures, Location.system(s)).some((id) => parseFigureId(id).color === faction)
    if (!present) continue
    const m = piecesIn(now, faction, s, 'Ship')
    for (const rival of rivals) {
      const n = piecesIn(now, rival, s, 'Ship')
      if (n <= m || !armed(rival)) continue
      outnumbered = true
      list.push({ kind: 'outnumbered', text: `${rival} has ${n} ships to your ${m} in ${s}.` })
    }
  }

  // 4. First place on a declared ambition changed hands to or from you.
  for (const a of declared) {
    const then = leader(before, a)
    const nowLead = leader(now, a)
    if (then === faction && nowLead !== faction) list.push({ kind: 'first-place', text: `You no longer lead ${a}.` })
    if (nowLead === faction && then !== faction) list.push({ kind: 'first-place', text: `You now lead ${a}.` })
  }

  // 5. Your hand.
  if (hand.length === 1) list.push({ kind: 'hand', text: 'This is your last card this chapter.' })
  if (outnumbered && !hand.some((c) => c.startsWith('Aggression-'))) {
    list.push({ kind: 'hand', text: 'You hold no Aggression card.' })
  }

  return {
    ...facts,
    self: faction,
    hand,
    since: now.log.slice(before.log.length),
    headsUps: list.slice(0, MAX_HEADS_UPS),
  }
}
