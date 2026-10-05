/**
 * The public facts of a game in progress, for the Scoreboard and the turn catch-up
 * (docs/superpowers/specs/2026-10-04-scoreboard-catchup-design.md). Pure and public: hand *sizes*
 * only — a seat's own hand is added by `seatFacts` through `observe`.
 */

import { buildChapterReport } from './chapter-report.js'
import type { ChapterReport } from './chapter-report.js'
import { planetResource, rules } from './control.js'
import { CourtPile, courtCard, securedCards } from './court.js'
import { perform } from './dispatch.js'
import type { RuleRegistry } from './dispatch.js'
import { CardLocation, Location, parseFigureId } from './ids.js'
import type { FactionId, SystemId } from './ids.js'
import { parseResourceToken } from './resources.js'
import type { Resource } from './resources.js'
import { ScoreAmbitions, metric } from './rules/ambitions.js'
import { AMBITIONS } from './state.js'
import type { Ambition, AmbitionMarker, GameState } from './state.js'
import { contentsOf } from './tracker.js'

/** Agents a faction has on one court card: what it is trying to win next. */
export interface CourtingFacts {
  readonly card: string
  readonly suit?: Resource
  readonly agents: number
}

export interface FactionFacts {
  readonly faction: FactionId
  readonly power: number
  readonly cities: number
  readonly starports: number
  readonly ships: number
  readonly rules: readonly SystemId[]
  readonly resources: readonly Resource[]
  /** Secured court card names. */
  readonly court: readonly string[]
  readonly handSize: number
  readonly declared: readonly Ambition[]
  /** Cities by planet resource: what Tax could bring in. */
  readonly taxBase: Readonly<Partial<Record<Resource, number>>>
  readonly courting: readonly CourtingFacts[]
}

export interface AmbitionFacts {
  readonly ambition: Ambition
  readonly markers: readonly AmbitionMarker[]
  /** Every faction, best first (seating order breaks ties). */
  readonly holdings: readonly { readonly faction: FactionId; readonly value: number }[]
}

export interface GameFacts {
  readonly chapter: number
  readonly round: number
  readonly factions: readonly FactionFacts[]
  readonly ambitions: readonly AmbitionFacts[]
  /** The real chapter-end scoring run on a copy; null when nothing is declared or the game is over. */
  readonly ifChapterEndedNow: ChapterReport | null
}

export function piecesIn(state: GameState, f: FactionId, system: SystemId, piece: string): number {
  return contentsOf(state.figures, Location.system(system)).filter((id) => {
    const p = parseFigureId(id)
    return p.color === f && p.piece === piece
  }).length
}

function factionFacts(state: GameState, f: FactionId): FactionFacts {
  const count = (piece: string): number => state.board.systems.reduce((n, s) => n + piecesIn(state, f, s, piece), 0)
  const resources = [...state.resources.contents.entries()]
    .filter(([loc]) => loc.startsWith(`cityslot:${f}:`) || loc.startsWith(`cardslot:${f}:`))
    .flatMap(([, ids]) => ids.map((id) => parseResourceToken(id).resource))
  const taxBase: Partial<Record<Resource, number>> = {}
  for (const s of state.board.systems) {
    const n = piecesIn(state, f, s, 'City')
    const r = n > 0 ? planetResource(state, s) : undefined
    if (r !== undefined) taxBase[r] = (taxBase[r] ?? 0) + n
  }
  const courting: CourtingFacts[] = []
  for (const [loc, ids] of state.figures.contents) {
    if (!loc.startsWith('court:agents:')) continue
    const agents = ids.filter((id) => parseFigureId(id).color === f).length
    const card = contentsOf(state.courtCards, CourtPile.slot(Number(loc.slice('court:agents:'.length))))[0]
    if (agents === 0 || card === undefined) continue
    const c = courtCard(card)
    courting.push({ card: c.name, ...(c.suit === undefined ? {} : { suit: c.suit }), agents })
  }
  return {
    faction: f,
    power: state.power[f] ?? 0,
    cities: count('City'),
    starports: count('Starport'),
    ships: count('Ship'),
    rules: state.board.systems.filter((s) => rules(state, f, s)),
    resources,
    court: securedCards(state, f).map((id) => courtCard(id).name),
    handSize: contentsOf(state.cards, CardLocation.hand(f)).length,
    declared: state.declared.filter((d) => d.by === f).map((d) => d.ambition),
    taxBase,
    courting,
  }
}

/** `registry` is a parameter because importing `defaultRegistry` from `./index.js` is a cycle. */
export function gameFacts(state: GameState, registry: RuleRegistry): GameFacts {
  const ambitions: AmbitionFacts[] = AMBITIONS.map((ambition) => ({
    ambition,
    markers: state.declared.filter((d) => d.ambition === ambition).map((d) => d.marker),
    holdings: state.factions
      .map((faction) => ({ faction, value: metric(state, faction, ambition) }))
      .sort((a, b) => b.value - a.value),
  }))
  const ifChapterEndedNow =
    state.declared.length === 0 || state.isOver
      ? null
      : buildChapterReport(state, perform(state, ScoreAmbitions(), registry).state)
  return {
    chapter: state.chapter,
    round: state.round,
    factions: state.factions.map((f) => factionFacts(state, f)),
    ambitions,
    ifChapterEndedNow,
  }
}
