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
import type { Presence } from './presence.js'
import type { SeatRow } from './sqlite-store.js'
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

export interface Schedule {
  cancel(): void
}

export interface NotifierOptions {
  readonly publicOrigin: string
  readonly post?: Poster
  readonly now?: () => number
  readonly windowMs?: number
  readonly fallbackChannel?: FallbackChannel
  readonly presence?: Presence
  /** Milliseconds to wait, while the player is active, before pinging Discord anyway. Default 600000. */
  readonly graceMs?: number
  /** Milliseconds to wait after the player's last socket closes before pinging. Default 60000. */
  readonly leaveGraceMs?: number
  readonly schedule?: (fn: () => void, ms: number) => Schedule
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

interface Pending {
  readonly seatToken: string
  readonly length: number
  readonly chapter: number
  timer: Schedule
}

function defaultSchedule(fn: () => void, ms: number): Schedule {
  const handle = setTimeout(fn, ms)
  handle.unref?.()
  return { cancel: () => clearTimeout(handle) }
}

export class Notifier {
  private readonly post: Poster
  private readonly now: () => number
  private readonly windowMs: number
  private readonly origin: string
  private readonly fallbackChannel: FallbackChannel | undefined
  private readonly presence: Presence | undefined
  private readonly graceMs: number
  private readonly leaveGraceMs: number
  private readonly schedule: (fn: () => void, ms: number) => Schedule
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly store: SqliteStore,
    opts: NotifierOptions,
  ) {
    this.post = opts.post ?? postToDiscord
    this.now = opts.now ?? Date.now
    this.windowMs = opts.windowMs ?? 60_000
    this.origin = opts.publicOrigin
    this.fallbackChannel = opts.fallbackChannel
    this.presence = opts.presence
    this.graceMs = opts.graceMs ?? 600_000
    this.leaveGraceMs = opts.leaveGraceMs ?? 60_000
    this.schedule = opts.schedule ?? defaultSchedule
    this.presence?.onLeave((gameId, seatToken) => this.onLeave(gameId, seatToken))
  }

  private onLeave(gameId: string, seatToken: string): void {
    const pending = this.pending.get(gameId)
    if (pending === undefined || pending.seatToken !== seatToken) return
    pending.timer.cancel()
    pending.timer = this.schedule(() => void this.checkPending(gameId), this.leaveGraceMs)
  }

  private async checkPending(gameId: string): Promise<void> {
    const pending = this.pending.get(gameId)
    if (pending === undefined) return
    if (this.store.journalLength(gameId) !== pending.length) return
    this.pending.delete(gameId)
    const seat = this.store.seats(gameId).find((s) => s.seatToken === pending.seatToken)
    if (seat === undefined) return
    const line = this.turnLine(gameId, seat, pending.chapter)
    if (line === undefined) return
    await this.postLines(gameId, [line], pending.length)
  }

  async onSettled({ gameId, before, after }: Settled): Promise<void> {
    const existingPending = this.pending.get(gameId)
    if (existingPending !== undefined) {
      existingPending.timer.cancel()
      this.pending.delete(gameId)
    }

    const meta = this.store.meta(gameId)
    if (meta === undefined) return
    const hasWebhook = meta.webhookUrl !== undefined
    if (!hasWebhook && this.fallbackChannel === undefined) return
    const length = after.state.journal.length
    if (length <= meta.lastNotifiedLength) return

    const seats = this.store.seats(gameId)
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
      if (seat !== undefined && !seat.isBot && changed) {
        this.presence?.send(gameId, seat.seatToken, { turn: { faction: seat.faction, chapter: after.state.chapter, length } })
        if (seat.pings && this.presence?.isActive(gameId, seat.seatToken) === true) {
          // Defer: wait to see if the journal moves before pinging Discord.
          const timer = this.schedule(() => void this.checkPending(gameId), this.graceMs)
          this.pending.set(gameId, { seatToken: seat.seatToken, length, chapter: after.state.chapter, timer })
        } else {
          const inWindow = this.now() - meta.lastNotifiedAt < this.windowMs
          if (!inWindow || lines.length > 0) {
            const line = this.turnLine(gameId, seat, after.state.chapter)
            if (line !== undefined) lines.push(line)
          }
        }
      }
    }

    await this.postLines(gameId, lines, length)
  }

  /** Builds the turn-ping line for a seat, or `undefined` when pings are off for it. */
  private turnLine(gameId: string, seat: SeatRow, chapter: number): Line | undefined {
    if (!seat.pings) return undefined
    const seats = this.store.seats(gameId)
    const nameOf = (faction: string): string => seats.find((s) => s.faction === faction)?.name ?? faction
    const link = seatLink(this.origin, gameId, seat.seatToken)
    if (seat.discordId !== undefined) {
      return {
        text: `<@${seat.discordId}> (**${nameOf(seat.faction)}**), it's your turn in Arcs (chapter ${chapter}) — ${link}`,
        mentions: [seat.discordId],
      }
    }
    return {
      text: `**${nameOf(seat.faction)}**, it's your turn in Arcs (chapter ${chapter}) — ${link}`,
      mentions: [],
    }
  }

  private async postLines(gameId: string, lines: readonly Line[], length: number): Promise<void> {
    if (lines.length === 0) return
    const meta = this.store.meta(gameId)
    if (meta === undefined) return
    const hasWebhook = meta.webhookUrl !== undefined
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
