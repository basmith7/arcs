/**
 * Discord turn pings. Best effort: a failed POST is logged and forgotten.
 *
 * Fires from the gate's `onSettled`, i.e. once the bots have finished after a human action, so a
 * ping always names a human who can actually act. Rate-limited per game to one message per window
 * except for chapter changes and game over, which always go out.
 */
import { askedOf } from './gate.js'
import type { Settled } from './gate.js'
import type { SqliteStore } from './sqlite-store.js'

export type Poster = (url: string, content: string) => Promise<void>

export interface NotifierOptions {
  readonly publicOrigin: string
  readonly post?: Poster
  readonly now?: () => number
  readonly windowMs?: number
}

export function seatLink(origin: string, gameId: string, seatToken?: string): string {
  const seat = seatToken === undefined ? '' : `/s/${encodeURIComponent(seatToken)}`
  return `${origin.replace(/\/+$/, '')}/#/g/${encodeURIComponent(gameId)}${seat}`
}

export async function postToDiscord(url: string, content: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  })
  if (!res.ok) throw new Error(`discord webhook -> ${res.status}`)
}

export class Notifier {
  private readonly post: Poster
  private readonly now: () => number
  private readonly windowMs: number
  private readonly origin: string

  constructor(
    private readonly store: SqliteStore,
    opts: NotifierOptions,
  ) {
    this.post = opts.post ?? postToDiscord
    this.now = opts.now ?? Date.now
    this.windowMs = opts.windowMs ?? 60_000
    this.origin = opts.publicOrigin
  }

  async onSettled({ gameId, before, after }: Settled): Promise<void> {
    const meta = this.store.meta(gameId)
    if (meta === undefined || meta.webhookUrl === undefined) return
    const length = after.state.journal.length
    if (length <= meta.lastNotifiedLength) return

    const seats = this.store.seats(gameId)
    const nameOf = (faction: string): string => seats.find((s) => s.faction === faction)?.name ?? faction
    const lines: string[] = []

    if (after.state.isOver) {
      const winners = after.state.winners.map(nameOf).join(' and ')
      lines.push(`Game over in Arcs — **${winners}** wins! ${seatLink(this.origin, gameId)}`)
    } else {
      if (before !== null && after.state.chapter !== before.state.chapter) {
        lines.push(`Chapter ${before.state.chapter} is over in Arcs. Chapter ${after.state.chapter} begins.`)
      }
      const asked = askedOf(after)
      const seat = asked === undefined ? undefined : seats.find((s) => s.faction === asked)
      // A turn is many asks in a row for the same player; ping only when the asked player changes.
      // After a restart (before === null) the length guard above already decided it is news.
      const changed = before === null ? true : askedOf(before) !== asked
      const inWindow = this.now() - meta.lastNotifiedAt < this.windowMs
      if (seat !== undefined && !seat.isBot && changed && (!inWindow || lines.length > 0)) {
        lines.push(
          `**${nameOf(seat.faction)}**, it's your turn in Arcs (chapter ${after.state.chapter}) — ${seatLink(this.origin, gameId, seat.seatToken)}`,
        )
      }
    }

    if (lines.length === 0) return
    try {
      await this.post(meta.webhookUrl, lines.join('\n'))
      this.store.markNotified(gameId, length, this.now())
    } catch (e) {
      console.warn(`[notify] webhook failed for ${gameId}:`, (e as Error).message)
    }
  }
}
