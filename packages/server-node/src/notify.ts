/**
 * Discord turn pings. Best effort: a failed POST is logged and forgotten.
 *
 * Fires from the gate's `onSettled`, i.e. once the bots have finished after a human action, so a
 * ping always names a human who can actually act. Rate-limited per game to one message per window
 * except for chapter changes and game over, which always go out.
 */
import type { DiscordBot } from './discord.js'
import { askedOf } from './gate.js'
import type { Settled } from './gate.js'
import type { SqliteStore } from './sqlite-store.js'

export interface Message {
  readonly content: string
  readonly mentions: readonly string[]
}

export type Poster = (url: string, message: Message) => Promise<void>

/** A game with no webhook of its own posts here instead, when configured. */
export interface FallbackChannel {
  readonly channelId: string
  readonly bot: DiscordBot
}

export interface NotifierOptions {
  readonly publicOrigin: string
  readonly post?: Poster
  readonly now?: () => number
  readonly windowMs?: number
  readonly fallbackChannel?: FallbackChannel
}

export function seatLink(origin: string, gameId: string, seatToken?: string): string {
  const seat = seatToken === undefined ? '' : `/s/${encodeURIComponent(seatToken)}`
  return `${origin.replace(/\/+$/, '')}/#/g/${encodeURIComponent(gameId)}${seat}`
}

export async function postToDiscord(url: string, message: Message): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: message.content, allowed_mentions: { parse: [], users: message.mentions } }),
  })
  if (!res.ok) throw new Error(`discord webhook -> ${res.status}`)
}

interface Line {
  readonly text: string
  readonly mentions: readonly string[]
}

/** `<@id>` when the seat has linked Discord, else today's bold name. */
function mentionOf(seat: { readonly name?: string; readonly faction: string; readonly discordId?: string }): {
  readonly text: string
  readonly mention?: string
} {
  if (seat.discordId !== undefined) return { text: `<@${seat.discordId}>`, mention: seat.discordId }
  return { text: `**${seat.name ?? seat.faction}**` }
}

export class Notifier {
  private readonly post: Poster
  private readonly now: () => number
  private readonly windowMs: number
  private readonly origin: string
  private readonly fallbackChannel: FallbackChannel | undefined

  constructor(
    private readonly store: SqliteStore,
    opts: NotifierOptions,
  ) {
    this.post = opts.post ?? postToDiscord
    this.now = opts.now ?? Date.now
    this.windowMs = opts.windowMs ?? 60_000
    this.origin = opts.publicOrigin
    this.fallbackChannel = opts.fallbackChannel
  }

  async onSettled({ gameId, before, after }: Settled): Promise<void> {
    const meta = this.store.meta(gameId)
    if (meta === undefined) return
    const hasWebhook = meta.webhookUrl !== undefined
    if (!hasWebhook && this.fallbackChannel === undefined) return
    const length = after.state.journal.length
    if (length <= meta.lastNotifiedLength) return

    const seats = this.store.seats(gameId)
    const nameOf = (faction: string): string => seats.find((s) => s.faction === faction)?.name ?? faction
    const lines: Line[] = []

    if (after.state.isOver) {
      const tagged = after.state.winners.map((f) => mentionOf(seats.find((s) => s.faction === f) ?? { faction: f }))
      const winners = tagged.map((t) => t.text).join(' and ')
      const mentions = tagged.flatMap((t) => (t.mention === undefined ? [] : [t.mention]))
      lines.push({ text: `Game over in Arcs — ${winners} wins! ${seatLink(this.origin, gameId)}`, mentions })
    } else {
      if (before !== null && after.state.chapter !== before.state.chapter) {
        lines.push({
          text: `Chapter ${before.state.chapter} is over in Arcs. Chapter ${after.state.chapter} begins.`,
          mentions: [],
        })
      }
      const asked = askedOf(after)
      const seat = asked === undefined ? undefined : seats.find((s) => s.faction === asked)
      // A turn is many asks in a row for the same player; ping only when the asked player changes.
      // After a restart (before === null) the length guard above already decided it is news.
      const changed = before === null ? true : askedOf(before) !== asked
      const inWindow = this.now() - meta.lastNotifiedAt < this.windowMs
      if (seat !== undefined && !seat.isBot && changed && (!inWindow || lines.length > 0)) {
        const link = seatLink(this.origin, gameId, seat.seatToken)
        if (seat.discordId !== undefined) {
          lines.push({
            text: `<@${seat.discordId}> (**${nameOf(seat.faction)}**), it's your turn in Arcs (chapter ${after.state.chapter}) — ${link}`,
            mentions: [seat.discordId],
          })
        } else {
          lines.push({
            text: `**${nameOf(seat.faction)}**, it's your turn in Arcs (chapter ${after.state.chapter}) — ${link}`,
            mentions: [],
          })
        }
      }
    }

    if (lines.length === 0) return
    const message: Message = {
      content: lines.map((l) => l.text).join('\n'),
      mentions: [...new Set(lines.flatMap((l) => l.mentions))],
    }
    try {
      if (hasWebhook) {
        await this.post(meta.webhookUrl!, message)
      } else {
        await this.fallbackChannel!.bot.postMessage(this.fallbackChannel!.channelId, message)
      }
      this.store.markNotified(gameId, length, this.now())
    } catch (e) {
      console.warn(`[notify] post failed for ${gameId}:`, (e as Error).message)
    }
  }
}
