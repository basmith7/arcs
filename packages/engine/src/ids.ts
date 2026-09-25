/**
 * Colors own pieces. Factions are the subset of colors that players and bots control.
 *
 * The campaign adds Empire, Blights and Free — they hold pieces on the board but are
 * driven by rules, never by a player or a bot. Keeping the two types distinct from the
 * first commit is the cheapest phase-1 constraint to honour and by far the most expensive
 * to retrofit. See docs/04-scope-and-phasing.md section 2.1.
 */

export const FACTION_IDS = ['red', 'yellow', 'blue', 'white'] as const
export type FactionId = (typeof FACTION_IDS)[number]

/** Rules-driven, campaign only. Never a player, never a bot. */
export const NPC_COLOR_IDS = ['empire', 'blights', 'free'] as const
export type NpcColorId = (typeof NPC_COLOR_IDS)[number]

export type ColorId = FactionId | NpcColorId

export const COLOR_IDS: readonly ColorId[] = [...FACTION_IDS, ...NPC_COLOR_IDS]

export function isFaction(color: ColorId): color is FactionId {
  return (FACTION_IDS as readonly string[]).includes(color)
}

/** Narrow a color to a faction, or throw. Use where the rules guarantee a player. */
export function asFaction(color: ColorId): FactionId {
  if (!isFaction(color)) throw new Error(`not a player faction: ${color}`)
  return color
}

// --- Board -----------------------------------------------------------------

export const SYMBOLS = ['Gate', 'Arrow', 'Crescent', 'Hex'] as const
export type Symbol_ = (typeof SYMBOLS)[number]

/** e.g. "3-Hex". Matches the ids in the board topology data. */
export type SystemId = string

export function systemId(cluster: number, symbol: Symbol_): SystemId {
  return `${cluster}-${symbol}`
}

// --- Pieces ----------------------------------------------------------------

export const PIECES = ['Ship', 'City', 'Starport', 'Agent'] as const
export type Piece = (typeof PIECES)[number]

/**
 * Figures are value objects, but JS has no structural equality, so every figure is
 * interned to a string and maps are keyed by that. This is also the journal encoding —
 * one function gives us identity and serialization. See docs/02 section 1.1.
 */
export type FigureId = string

export function figureId(color: ColorId, piece: Piece, index: number): FigureId {
  return `${color}/${piece}/${index}`
}

export type ParsedFigure = Readonly<{ color: ColorId; piece: Piece; index: number }>

/**
 * Parsed ids, shared. Figure ids are a small closed set (~300 in a four-player game) and parsing
 * one is pure, yet re-splitting them was 44% of a `normal` game's CPU — the evaluator parses every
 * figure in every system for every probe (docs/19 section 21). Results are frozen, so one caller
 * cannot corrupt another's.
 */
const PARSED = new Map<FigureId, ParsedFigure>()

export function parseFigureId(id: FigureId): ParsedFigure {
  const hit = PARSED.get(id)
  if (hit !== undefined) return hit
  const parts = id.split('/')
  const [color, piece, index] = parts
  if (parts.length !== 3 || color === undefined || piece === undefined || index === undefined) {
    throw new Error(`malformed figure id: ${id}`)
  }
  const parsed: ParsedFigure = Object.freeze({
    color: color as ColorId,
    piece: piece as Piece,
    index: Number(index),
  })
  PARSED.set(id, parsed)
  return parsed
}

// --- Locations -------------------------------------------------------------

/**
 * Open union, deliberately. The campaign adds FatePieces, Exchange, ImperialTrust and
 * others; code must not be required to match exhaustively on location kind or every
 * phase-2 addition breaks every switch. See docs/04 section 2.3.
 */
export type LocationId = string

export const Location = {
  system: (s: SystemId): LocationId => `system:${s}`,
  reserve: (c: ColorId): LocationId => `reserve:${c}`,
  trophies: (f: FactionId): LocationId => `trophies:${f}`,
  captives: (f: FactionId): LocationId => `captives:${f}`,
  /** Agents standing on court slot `n` (the cards themselves live in `CourtPile`). */
  court: (n: number): LocationId => `court:agents:${n}`,
  scrap: (): LocationId => 'scrap',
} as const

/** Card locations, open union like the rest. See cards.ts. */
export const CardLocation = {
  deck: (): LocationId => 'deck',
  hand: (f: FactionId): LocationId => `hand:${f}`,
  played: (f: FactionId): LocationId => `played:${f}`,
  /**
   * A Union's taken card, waiting out the round (docs/20 B1): "When the round ends, draw that
   * card into your hand." Officially ruled — collected "at the end of the round, after all
   * players have finished their turns" — so it cannot fund a seize or a discard this round.
   */
  pending: (f: FactionId): LocationId => `pending:${f}`,
  discard: (): LocationId => 'discard',
} as const
