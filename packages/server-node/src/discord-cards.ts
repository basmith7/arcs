/**
 * What the channel bot posts, as Discord embeds: one card per event (turn, chapter end, game over,
 * stall reminder). Pure functions of the game state and the seats; notify.ts decides when to post.
 *
 * Only public information goes in a card: the channel is shared by every player, so a card shows
 * what the table can see (power, declared ambitions, the face-up lead) and never a hand.
 *
 * The game link rides on the message's button (notify.ts), not on each card: Discord may fold
 * embeds sharing a url into one.
 *
 * The `content` line carries the @mention (Discord pings only from `content`, never from an embed)
 * and is what a phone notification shows, so it says on its own whose turn it is.
 */
import { buildChapterReport, OPENERS, standings } from '@arcs/engine'
import type { Ask, FactionId, GameState, RuleResult } from '@arcs/engine'

import type { SeatRow } from './sqlite-store.js'

export interface EmbedField {
  readonly name: string
  readonly value: string
  readonly inline?: boolean
}

/** The subset of Discord's embed object the cards use. */
export interface Embed {
  readonly author?: { readonly name: string }
  readonly title?: string
  readonly description?: string
  readonly color?: number
  readonly fields?: readonly EmbedField[]
  readonly footer?: { readonly text: string }
  /** ISO time; Discord shows it in the footer in each reader's own time zone. */
  readonly timestamp?: string
}

export interface Card {
  readonly content: string
  readonly embed: Embed
  readonly mentions: readonly string[]
}

type Seat = Pick<SeatRow, 'faction' | 'name' | 'discordId'>

/* The board colours, as in the web client's theme (apps/web/src/theme.ts). */
const COLOR: Readonly<Record<string, number>> = { red: 0xd94b3f, yellow: 0xe0a92e, blue: 0x3f7fd9, white: 0xe8e8ea }
const DOT: Readonly<Record<string, string>> = { red: '🔴', yellow: '🟡', blue: '🔵', white: '⚪' }
const CHAPTER_COLOR = 0x8a6bd6
const WAITING_COLOR = 0xf0b232
const NEUTRAL = 0x8a8f98
const MEDALS = ['🥇', '🥈', '🥉']

const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const dot = (faction: string): string => DOT[faction] ?? '•'
const seatOf = (seats: readonly Seat[], faction: string): Seat => seats.find((s) => s.faction === faction) ?? { faction }

/** The player's name, or the colour for an unnamed seat (bots, hotseat). */
const nameOf = (seat: Seat): string => seat.name ?? title(seat.faction)
const nameIn = (seats: readonly Seat[], faction: string): string => nameOf(seatOf(seats, faction))

/** Engine prompts name factions by colour id ("red — Prelude"); swap in the players' names. */
function withNames(text: string, seats: readonly Seat[]): string {
  return text.replace(/\b(red|yellow|blue|white)\b/g, (f) => nameIn(seats, f))
}

/** `<@id>` for a linked seat (pings them), else the bold name. */
function tag(seat: Seat): { readonly text: string; readonly mention?: string } {
  if (seat.discordId !== undefined) return { text: `<@${seat.discordId}>`, mention: seat.discordId }
  return { text: `**${nameOf(seat)}**` }
}

/** "🔴 Brian 14" per line, best first. */
function powerLines(state: GameState, seats: readonly Seat[]): string {
  return standings(state)
    .map(({ faction, power }) => `${dot(faction)} ${nameIn(seats, faction)} ${power}`)
    .join('\n')
}

/** Chapter, round and power, plus whatever else of the table is public and in play. */
function tableFields(state: GameState, seats: readonly Seat[]): EmbedField[] {
  const fields: EmbedField[] = [{ name: 'Power', value: powerLines(state, seats), inline: true }]
  if (state.declared.length > 0) {
    const declared = state.declared.map((d) => `${d.ambition} (${d.marker.high}/${d.marker.low})`).join('\n')
    fields.push({ name: 'Declared', value: declared, inline: true })
  }
  const initiative = state.initiativeOrder[0]
  if (initiative !== undefined) {
    fields.push({ name: 'Initiative', value: `${dot(initiative)} ${nameIn(seats, initiative)}`, inline: true })
  }
  return fields
}

/** The ask a faction is answering now, from either an ask or a multi-ask. */
function askOf(result: RuleResult, faction: string): Ask | undefined {
  const c = result.continue
  if (c.kind === 'ask') return c.faction === faction ? c : undefined
  if (c.kind === 'multiAsk') return c.asks.find((a) => a.faction === faction)
  return undefined
}

/** One line on what the player faces: the face-up lead they answer, their own lead, or the engine's prompt. */
function situation(result: RuleResult, faction: FactionId, seats: readonly Seat[]): string | undefined {
  const ask = askOf(result, faction)
  if (ask === undefined) return undefined
  if (!ask.actions.some((a) => OPENERS.has(a.type))) return ask.prompt === undefined ? undefined : withNames(ask.prompt, seats)
  const lead = result.state.lead
  if (lead === undefined || lead.faction === faction) return 'You lead this round.'
  const who = nameIn(seats, lead.faction)
  const declared = result.state.declared.find((d) => d.by === lead.faction && d.round === result.state.round)
  return declared === undefined
    ? `${who} led **${lead.suit} ${lead.strength}**.`
    : `${who} led **${lead.suit}** and declared **${declared.ambition}**.`
}

const where = (state: GameState): string => `Chapter ${state.chapter} · Round ${state.round}`

/** It is this seat's turn; `result` is the game now. */
export function turnCard(seat: Seat, result: RuleResult, seats: readonly Seat[], now: number): Card {
  const who = tag(seat)
  const description = situation(result, seat.faction as FactionId, seats)
  return {
    content: `${who.text}, your turn in Arcs (${where(result.state).toLowerCase()})`,
    mentions: who.mention === undefined ? [] : [who.mention],
    embed: {
      author: { name: `Arcs · ${where(result.state)}` },
      title: `Your turn, ${nameOf(seat)}`,
      color: COLOR[seat.faction] ?? NEUTRAL,
      ...(description === undefined ? {} : { description }),
      fields: tableFields(result.state, seats),
      timestamp: new Date(now).toISOString(),
    },
  }
}

/** A chapter just ended between `before` and `after`: who scored what, and power after it. */
export function chapterCard(before: GameState, after: GameState, seats: readonly Seat[]): Card {
  const report = buildChapterReport(before, after)
  const name = (f: string): string => `${dot(f)} ${nameIn(seats, f)}`
  const fields: EmbedField[] = report.results.map((r) => ({
    name: r.ambition,
    value: r.awards.length === 0
      ? 'No one scored'
      : r.awards.map((a) => `${name(a.faction)} +${a.power}${a.place === 'tied' ? ' (tied)' : ''}`).join('\n'),
    inline: true,
  }))
  fields.push({ name: 'Power', value: powerLines(after, seats), inline: false })
  const headline = `Chapter ${report.chapter} scored — Chapter ${after.chapter} begins`
  return {
    content: '',
    mentions: [],
    embed: { author: { name: 'Arcs' }, title: headline, color: CHAPTER_COLOR, fields },
  }
}

/** The game is over: winners tagged, final placings with medals. */
export function gameOverCard(state: GameState, seats: readonly Seat[]): Card {
  const winners = state.winners.map((f) => seatOf(seats, f))
  const tags = winners.map(tag)
  const placings = standings(state)
    .map(({ faction, power }, i) => `${MEDALS[i] ?? `${i + 1}.`} ${nameIn(seats, faction)} ${power}`)
    .join('\n')
  return {
    content: `Game over in Arcs — ${tags.map((t) => t.text).join(' and ')} ${tags.length === 1 ? 'wins' : 'win'}!`,
    mentions: tags.flatMap((t) => (t.mention === undefined ? [] : [t.mention])),
    embed: {
      author: { name: 'Arcs · Game over' },
      title: `🏆 ${winners.map(nameOf).join(' and ')} ${winners.length === 1 ? 'wins' : 'win'}`,
      color: COLOR[state.winners[0] ?? ''] ?? NEUTRAL,
      description: placings,
      footer: { text: `${state.chapter} ${state.chapter === 1 ? 'chapter' : 'chapters'}` },
    },
  }
}

/** The daily nudge for a game stalled on one human. `lastMove` is when the journal last grew. */
export function reminderCard(
  seat: Seat,
  state: GameState | undefined,
  opts: { readonly days: number; readonly count: number; readonly max: number; readonly lastMove: number },
): Card {
  const who = tag(seat)
  const days = `${opts.days} ${opts.days === 1 ? 'day' : 'days'}`
  return {
    content: `${who.text} still your turn in Arcs — ${days} since the last move`,
    mentions: who.mention === undefined ? [] : [who.mention],
    embed: {
      title: `Waiting on ${nameOf(seat)} — ${days}`,
      color: WAITING_COLOR,
      ...(state === undefined ? {} : { description: where(state) }),
      footer: { text: `Reminder ${opts.count} of ${opts.max} · last move` },
      timestamp: new Date(opts.lastMove).toISOString(),
    },
  }
}
