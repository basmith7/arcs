/**
 * The game log, read back into structure.
 *
 * ## Why parse prose the engine already wrote
 *
 * `state.log` is `readonly string[]` — around eighty hand-written sentences spread across
 * `packages/engine/src/rules/*`, each one beginning with the actor's faction id. That prefix is
 * data wearing prose's clothes: every line of a turn repeats the same word, so a chapter of play
 * reads as a wall with the interesting part (what happened) pushed right by the boring part (who,
 * again). Turning the log into `{ faction, verb }` records at the source would be the cleaner
 * answer and is a different, much larger job — it touches every one of those eighty sites and the
 * engine tests that assert on their wording. This module buys the same legibility for the price of
 * one regex table, on the web side, where the styling lives anyway.
 *
 * The trade it makes is explicit: **the parser can drift from the engine's phrasing and nothing
 * will crash.** A line whose verb no rule matches loses its glyph and keeps its text, which is why
 * the fallbacks below are all "leave it alone" rather than "guess". `test/log-format.test.ts` pins
 * the classification against lines lifted verbatim from a played game, so drift shows up there
 * rather than as a slowly emptying column of icons nobody notices.
 *
 * ## Turns, not lines
 *
 * Grouping is by **actor change**, not by finding the action that starts a turn. Card plays are
 * only one of several ways a turn can open (the Prelude, a leader's free action, setup placement),
 * and a rule that hunted for openers would silently mis-group every case it had not been taught.
 * A change of prefix is a turn boundary in every case the engine can produce, and when the first
 * line of a group *is* a card play it is folded into the head — so the common case reads
 * "blue · led with Construction-3" and the uncommon one reads "blue" and loses nothing.
 *
 * ## Names, so a row can be more than a sentence
 *
 * The same prose names things the app can already show you — an action card, a court/lore/leader
 * card, a system on the map — so `tokenize` cuts each line into runs of plain text and runs that
 * are one of those three. The panel turns them into a card that opens on hover and a system that
 * lights on the map; this module only says *where the names are*, which is the same job as
 * everything else here and belongs in the same test file.
 *
 * The risk is the mirror of the tone table's. A verb pattern that stops matching costs a glyph; a
 * *name* pattern that matches too eagerly costs a wrong link on a common word, which is worse
 * because it looks deliberate. So the table is built from the engine's own card data rather than
 * written out, matched longest-name-first, and holds nothing that is not a card.
 */

import { BASE_COURT, FACTION_IDS, LEADERS, LORE, SUITS } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'

/**
 * One rendered row.
 *
 * `head` opens a turn and carries the card play when there was one; `entry` is a thing that
 * happened, indented under the head above it; `divider` is a rule across the panel and belongs to
 * nobody.
 */
export type LogItem =
  | {
      readonly kind: 'head'
      readonly faction: FactionId
      readonly text: string
      /** `text` cut into prose and the names it holds — see `tokenize`. */
      readonly parts: readonly LogPart[]
    }
  | {
      readonly kind: 'entry'
      readonly faction: FactionId | null
      readonly text: string
      /** `text` cut into prose and the names it holds — see `tokenize`. */
      readonly parts: readonly LogPart[]
      /** The CSS class carrying emphasis — the panel's existing `log-score`/`log-battle`/`log-emph`. */
      readonly tone: string
      /** A glyph for the action family, or `''` when no rule claims the line. */
      readonly icon: string
    }
  | { readonly kind: 'divider'; readonly text: string }

/**
 * Lines with no actor that structure the game rather than report an action.
 *
 * Deliberately a short, closed list. Every *other* authorless line — "Call to Action discarded",
 * "initiative passes to red" — is a real event that simply has no single faction to blame, and
 * demoting those to furniture would hide them.
 */
const DIVIDER = /^(Chapter\b|round over\b|Leaders and Lore\b)/

/** The four ways a turn opens with a card, folded into the head instead of listed under it. */
const CARD_PLAY = /^(led with|surpassed with|pivoted with|copied with|leads as)\b/

/**
 * Verb families, first match wins.
 *
 * One table for both tone and glyph, because they answer the same question and two tables would
 * be free to disagree — the mistake `surfaces.ts` exists to prevent, in miniature. Order is
 * load-bearing: a battle line often also names a build ("destroyed white City"), and a scoring
 * line names the ambition that was declared, so the more specific family is listed first.
 */
const RULES: readonly { readonly re: RegExp; readonly tone: string; readonly icon: string }[] = [
  /*
   * `\blost\s` rather than `lost`, and the space is the whole point: the engine also writes
   * "(1 pip(s) lost)" when an action is unavailable, which is an administrative note and not a
   * battle. The bare word graded that line as combat and gave it a sword.
   */
  { re: /attacks|rolled|destroyed|damaged|trophy|raided|intercept|\blost\s/, tone: 'log-battle', icon: '⚔' },
  // Points actually banked. `placed (second|third)` is anchored so setup's "placed a City" misses.
  { re: /\bwon\b|\btied\b|placed (second|third)|\breached\b|scored|Game ended/, tone: 'log-score', icon: '★' },
  // A declaration is a claim, not a score — same glyph, weaker tone, because the points are not in.
  { re: /declared/, tone: 'log-emph', icon: '★' },
  { re: /built|placed a|repaired/, tone: '', icon: '⬢' },
  { re: /moved/, tone: '', icon: '➤' },
  { re: /influenced|secured|captured|ransacked|abducted|agent/, tone: '', icon: '◈' },
  { re: /taxed|spent|\btook\b|discarded/, tone: '', icon: '◆' },
]

// --- names ------------------------------------------------------------------

/** What a linked run of text refers to. Ids are whatever that card's own art is filed under. */
export interface CardRef {
  readonly kind: 'action' | 'court' | 'lore' | 'leader'
  readonly id: string
}

/** One run of a log line: plain prose, or something the app can show you. */
export type LogPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'card'; readonly text: string; readonly card: CardRef }
  | { readonly kind: 'system'; readonly text: string; readonly system: string }

/**
 * Every card the engine writes *by name*, built from the engine's own tables.
 *
 * Derived rather than listed, which is the only version of this that cannot go stale: a card added
 * to `BASE_COURT`, `LORE` or `LEADERS` is linkable the moment it exists, and one renamed is
 * renamed here too. A hand-kept list would have to be edited in lockstep with data it does not
 * live next to, and its failure — a name that quietly stops linking — is invisible.
 */
const NAMED: ReadonlyMap<string, CardRef> = new Map<string, CardRef>([
  ...BASE_COURT.map((c): [string, CardRef] => [c.name, { kind: 'court', id: c.id }]),
  ...LORE.map((c): [string, CardRef] => [c.name, { kind: 'lore', id: c.id }]),
  ...LEADERS.map((c): [string, CardRef] => [c.name, { kind: 'leader', id: c.id }]),
])

function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The one pattern, in three parts, and the order inside it is load-bearing.
 *
 * **Names, longest first.** Regex alternation takes the first branch that matches at a position,
 * not the longest — so with `Elder` ahead of `Elder Broker`, the guild card would be read as the
 * leader plus a stray " Broker". Sorting by length is what makes the longer name win.
 *
 * **Then action cards, then systems.** `Construction-3` and `1-Hex` are the same shape, which is
 * why neither is matched by a general "word-dash-word" rule: each names its own vocabulary, the
 * four suits and the four map symbols, and there is no overlap between them to get wrong.
 */
const LINK = new RegExp(
  [
    [...NAMED.keys()].sort((a, b) => b.length - a.length).map(escape).join('|'),
    `(?:${SUITS.join('|')})-[1-7]`,
    '\\d+-(?:Gate|Arrow|Crescent|Hex)',
  ].join('|'),
  'g',
)

/** What a matched run turned out to be. Systems are the fallback: nothing else is shaped like one. */
function refOf(text: string): LogPart {
  const named = NAMED.get(text)
  if (named !== undefined) return { kind: 'card', text, card: named }
  if (/-[1-7]$/.test(text)) return { kind: 'card', text, card: { kind: 'action', id: text } }
  return { kind: 'system', text, system: text }
}

/**
 * One line cut into runs — plain text, and the cards and systems it names.
 *
 * Total and lossless: joining the parts' `text` back together returns the input exactly, so a name
 * the table has never heard of costs a link and never a word. That is the same "leave it alone"
 * fallback the tone table takes, and for the same reason — this parser is downstream of prose it
 * does not control.
 */
export function tokenize(line: string): LogPart[] {
  const parts: LogPart[] = []
  let at = 0
  for (const m of line.matchAll(LINK)) {
    const start = m.index
    if (start > at) parts.push({ kind: 'text', text: line.slice(at, start) })
    parts.push(refOf(m[0]))
    at = start + m[0].length
  }
  if (at < line.length) parts.push({ kind: 'text', text: line.slice(at) })
  return parts
}

/**
 * The systems a row points the map at — every one it names, deduplicated, in order.
 *
 * Order is the caller's, not decoration: a move names its origin and then its destination, and the
 * map draws the route between them that way round. Deduplicated because a sentence that names one
 * system twice ("taxed 1-Hex and built a Ship in 1-Hex") means one place, and stacking two
 * reticles on it draws a brighter ring for no reason.
 */
export function systemsIn(parts: readonly LogPart[]): string[] {
  const out: string[] = []
  for (const p of parts) {
    if (p.kind === 'system' && !out.includes(p.system)) out.push(p.system)
  }
  return out
}

/** The faction that wrote this line, and the line with that prefix removed. */
function split(line: string): { faction: FactionId | null; rest: string } {
  for (const f of FACTION_IDS) {
    if (line.startsWith(`${f} `)) return { faction: f, rest: line.slice(f.length + 1) }
  }
  return { faction: null, rest: line }
}

function classify(text: string): { tone: string; icon: string } {
  for (const rule of RULES) {
    if (rule.re.test(text)) return { tone: rule.tone, icon: rule.icon }
  }
  return { tone: '', icon: '' }
}

/** The log as rows: turn heads, the entries beneath them, and the dividers between. */
export function parseLog(log: readonly string[]): LogItem[] {
  const items: LogItem[] = []
  /* Null between turns as well as before the first, so a divider forces the next line to reopen. */
  let open: FactionId | null = null

  for (const line of log) {
    const { faction, rest } = split(line)

    if (faction === null) {
      if (DIVIDER.test(line)) {
        open = null
        items.push({ kind: 'divider', text: line })
      } else {
        items.push({ kind: 'entry', faction: null, text: line, parts: tokenize(line), ...classify(line) })
      }
      continue
    }

    if (faction !== open) {
      open = faction
      const lead = CARD_PLAY.test(rest)
      const text = lead ? rest : ''
      items.push({ kind: 'head', faction, text, parts: tokenize(text) })
      // The card play *is* the head. Listing it again beneath itself is the only duplicate here.
      if (lead) continue
    }
    items.push({ kind: 'entry', faction, text: rest, parts: tokenize(rest), ...classify(rest) })
  }

  return items
}

/**
 * The turn in progress: the last head and everything under it.
 *
 * Empty when a divider has closed the last turn, which is the honest answer — between the round
 * ending and the next player leading, nobody is doing anything, and a feed that kept showing the
 * previous turn would be claiming otherwise.
 */
export function lastTurn(items: readonly LogItem[]): LogItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'divider') return []
    if (item.kind === 'head') return items.slice(i)
  }
  return []
}
