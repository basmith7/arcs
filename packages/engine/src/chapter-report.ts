/**
 * Chapter scoring, reconstructed for the interlude and game-over screens.
 *
 * The engine keeps no structured scoring record: `performScore` folds power into `state.power`,
 * narrates everything into `state.log`, and the same step wipes the declarations and the
 * trophy/captive piles it scored. The chapter transition never even surfaces as a continue —
 * `advance` swallows the milestone — so the only observable is a `state.chapter` bump between
 * two snapshots.
 *
 * This module turns that into data: the log lines appended between the snapshots are parsed
 * against the engine's exact formats (`rules/ambitions.ts`), and the *previous* snapshot supplies
 * the context the scoring destroyed — declared markers, holdings, power before. The regexes are
 * built from the closed FactionId/Ambition sets so the other lines sharing the delta (Lavish and
 * Cartel discards, Union draws, the next chapter's deal) can never false-match, and a line that
 * matches nothing is ignored: a format drift degrades a row to "no awards", never a crash.
 *
 * Presentation-only throughout: nothing here writes state or touches the journal.
 */

import { metric } from './rules/ambitions.js'
import { AMBITIONS } from './state.js'
import type { Ambition, GameState } from './state.js'
import { FACTION_IDS } from './ids.js'
import type { FactionId } from './ids.js'

/** One faction's outcome in one scored ambition. */
export interface AmbitionAward {
  readonly faction: FactionId
  readonly place: 'first' | 'second' | 'tied'
  readonly power: number
  /** The "(their leader)" suffix: a demotion (Just/Violent/Academic) or Proud's zero. */
  readonly demoted: boolean
}

export interface AmbitionResult {
  readonly ambition: Ambition
  /** The declared markers, for drawing `ambition-values-H-L.webp` per declaration. */
  readonly markers: readonly { high: number; low: number }[]
  readonly awards: readonly AmbitionAward[]
  /** Places the two-player out-of-play resources occupied. */
  readonly phantom: readonly ('first' | 'second' | 'tied')[]
  readonly noOneScored: boolean
  /** Pre-scoring holdings, `metric` per faction, zeros dropped. */
  readonly holdings: readonly { faction: FactionId; value: number }[]
}

export interface ChapterReport {
  /** The chapter that just ended. */
  readonly chapter: number
  /** Declared ambitions only, in the engine's fixed order. */
  readonly results: readonly AmbitionResult[]
  readonly cleanup: { readonly trophies: boolean; readonly captives: boolean }
  readonly power: readonly { faction: FactionId; before: number; after: number }[]
  readonly factions: readonly FactionId[]
}

/** A chapter boundary between two snapshots. */
export function chapterEnded(prev: GameState, next: GameState): boolean {
  return next.chapter > prev.chapter
}

const F = `(${FACTION_IDS.join('|')})`
const A = `(${AMBITIONS.join('|')})`

/* The scoring lines, verbatim from rules/ambitions.ts. */
const WON = new RegExp(`^${F} won ${A} for (\\d+) power$`)
const WON_DEMOTED = new RegExp(`^${F} won ${A} but takes only (\\d+) power \\(their leader\\)$`)
const SECOND = new RegExp(`^${F} placed second in ${A} for (\\d+) power$`)
const SECOND_DEMOTED = new RegExp(`^${F} placed second in ${A} but takes no power \\(their leader\\)$`)
const TIED = new RegExp(`^${F} tied ${A} for (\\d+) power$`)
const TIED_DEMOTED = new RegExp(`^${F} tied ${A} but takes no power \\(their leader\\)$`)
const NO_ONE = new RegExp(`^No one scored ${A}$`)
const PHANTOM_FIRST = new RegExp(`^the out-of-play resources lead ${A}; no one takes first$`)
const PHANTOM_SECOND = new RegExp(`^the out-of-play resources place second in ${A}$`)
const PHANTOM_TIE = new RegExp(`^the out-of-play resources tie ${A}$`)
const CLEANUP = /^Chapter cleanup: all (trophies|captives|trophies and captives) returned$/
const DEAL = /^Chapter \d+: dealt \d+ cards each$/

/**
 * The report for the boundary between `prev` (the state before the action that ended the
 * chapter) and `next` (after it — scoring, cleanup and the next deal have all happened).
 */
export function buildChapterReport(prev: GameState, next: GameState): ChapterReport {
  const awards = new Map<Ambition, AmbitionAward[]>()
  const phantom = new Map<Ambition, ('first' | 'second' | 'tied')[]>()
  const noOne = new Set<Ambition>()
  const cleanup = { trophies: false, captives: false }

  const award = (m: RegExpMatchArray, place: AmbitionAward['place'], demoted: boolean): void => {
    const ambition = m[2] as Ambition
    const list = awards.get(ambition) ?? []
    list.push({
      faction: m[1] as FactionId,
      place,
      power: demoted && m[3] === undefined ? 0 : Number(m[3] ?? 0),
      demoted,
    })
    awards.set(ambition, list)
  }
  const occupy = (m: RegExpMatchArray, place: 'first' | 'second' | 'tied'): void => {
    const ambition = m[1] as Ambition
    phantom.set(ambition, [...(phantom.get(ambition) ?? []), place])
  }

  for (const line of next.log.slice(prev.log.length)) {
    // The deal opens the next chapter; nothing after it belongs to this one.
    if (DEAL.test(line)) break
    let m: RegExpMatchArray | null
    if ((m = line.match(WON)) !== null) award(m, 'first', false)
    else if ((m = line.match(WON_DEMOTED)) !== null) award(m, 'first', true)
    else if ((m = line.match(SECOND)) !== null) award(m, 'second', false)
    else if ((m = line.match(SECOND_DEMOTED)) !== null) award(m, 'second', true)
    else if ((m = line.match(TIED)) !== null) award(m, 'tied', false)
    else if ((m = line.match(TIED_DEMOTED)) !== null) award(m, 'tied', true)
    else if ((m = line.match(NO_ONE)) !== null) noOne.add(m[1] as Ambition)
    else if ((m = line.match(PHANTOM_FIRST)) !== null) occupy(m, 'first')
    else if ((m = line.match(PHANTOM_SECOND)) !== null) occupy(m, 'second')
    else if ((m = line.match(PHANTOM_TIE)) !== null) occupy(m, 'tied')
    else if ((m = line.match(CLEANUP)) !== null) {
      cleanup.trophies ||= m[1]!.includes('trophies')
      cleanup.captives ||= m[1]!.includes('captives')
    }
    // Anything else in the delta (spends, Union draws, ordinary play) is not scoring.
  }

  const results: AmbitionResult[] = []
  for (const ambition of AMBITIONS) {
    const markers = prev.declared.filter((d) => d.ambition === ambition).map((d) => d.marker)
    if (markers.length === 0 && !awards.has(ambition) && !noOne.has(ambition)) continue
    results.push({
      ambition,
      markers,
      awards: awards.get(ambition) ?? [],
      phantom: phantom.get(ambition) ?? [],
      noOneScored: noOne.has(ambition),
      holdings: prev.factions
        .map((faction) => ({ faction, value: metric(prev, faction, ambition) }))
        .filter((h) => h.value > 0),
    })
  }

  return {
    chapter: prev.chapter,
    results,
    cleanup,
    power: prev.factions.map((faction) => ({
      faction,
      before: prev.power[faction] ?? 0,
      after: next.power[faction] ?? 0,
    })),
    factions: prev.factions,
  }
}

/**
 * The last chapter's scoring, which never bumps the chapter counter — the game ends instead.
 * `null` when the boundary between the snapshots is not the game's end.
 */
export function finalChapterReport(prev: GameState, next: GameState): ChapterReport | null {
  if (!next.isOver || prev.isOver) return null
  return buildChapterReport(prev, next)
}
