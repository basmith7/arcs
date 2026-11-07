/**
 * Discord turn pings and stall reminders. Best effort: a failed post is logged and forgotten.
 *
 * Fires from the gate's `onSettled`, i.e. once the bots have finished after a human action, so a
 * ping always names a human who can actually act. Rate-limited per game to one message per window
 * except for chapter changes and game over, which always go out.
 *
 * Two things are deferred and so must outlive a restart; both sit in SQLite and one periodic
 * `sweep()` sends whatever has come due:
 *  - a turn ping held for the idle grace (player has the page open) or leave grace (they just left);
 *  - a daily reminder for a game that has waited on the same human for 24 h or more.
 */
import type { RuleResult } from '@arcs/engine'

import { chapterCard, gameOverCard, reminderCard, turnCard } from './discord-cards.js'
import type { Card } from './discord-cards.js'
import type { DiscordBot } from './discord.js'
import { askedOf } from './gate.js'
import type { Settled } from './gate.js'
import type { Presence } from './presence.js'
import { nextSlotAfter } from './reminder-time.js'
import type { DailyTime } from './reminder-time.js'
import type { PendingPing, Reminder, SeatRow } from './sqlite-store.js'
import type { SqliteStore } from './sqlite-store.js'

const DAY_MS = 86_400_000
/** How long after the daily slot a reminder may still go out. */
const SLOT_WINDOW_MS = 3_600_000
/** Reminders per stall; after this, silence until someone moves. */
export const MAX_REMINDERS = 7

/** Where pings go. Without one the notifier stays quiet. */
export interface FallbackChannel {
  readonly channelId: string
  readonly bot: DiscordBot
}

export interface Schedule {
  cancel(): void
}

export interface NotifierOptions {
  readonly publicOrigin: string
  /** The game as it stands, for what a held ping or a reminder shows when it finally goes out. */
  readonly current: (gameId: string) => RuleResult | undefined
  readonly now?: () => number
  readonly windowMs?: number
  readonly fallbackChannel?: FallbackChannel
  readonly presence?: Presence
  /** Milliseconds to wait, while the player is active, before pinging Discord anyway. Default 600000. */
  readonly graceMs?: number
  /** Milliseconds to wait after the player's last socket closes before pinging. Default 60000. */
  readonly leaveGraceMs?: number
  /** Daily stall reminder time of day in `tz`; leave unset for no reminders. */
  readonly reminder?: { readonly time: DailyTime; readonly tz: string }
  /** How often `start()` sweeps, in ms. Default 30000. */
  readonly sweepMs?: number
  /** Repeating-timer seam for `start()`; defaults to an unref'd `setInterval`. */
  readonly every?: (fn: () => void, ms: number) => Schedule
}

export function seatLink(origin: string, gameId: string, seatToken?: string): string {
  const seat = seatToken === undefined ? '' : `/s/${encodeURIComponent(seatToken)}`
  return `${origin.replace(/\/+$/, '')}/#/g/${encodeURIComponent(gameId)}${seat}`
}

function defaultEvery(fn: () => void, ms: number): Schedule {
  const handle = setInterval(fn, ms)
  handle.unref?.()
  return { cancel: () => clearInterval(handle) }
}

export class Notifier {
  private readonly now: () => number
  private readonly windowMs: number
  private readonly origin: string
  private readonly current: NotifierOptions['current']
  private readonly fallbackChannel: FallbackChannel | undefined
  private readonly presence: Presence | undefined
  private readonly graceMs: number
  private readonly leaveGraceMs: number
  private readonly reminder: NotifierOptions['reminder']
  private readonly sweepMs: number
  private readonly every: (fn: () => void, ms: number) => Schedule
  private ticker: Schedule | undefined
  private sweeping = false

  constructor(
    private readonly store: SqliteStore,
    opts: NotifierOptions,
  ) {
    this.now = opts.now ?? Date.now
    this.windowMs = opts.windowMs ?? 60_000
    this.origin = opts.publicOrigin
    this.current = opts.current
    this.fallbackChannel = opts.fallbackChannel
    this.presence = opts.presence
    this.graceMs = opts.graceMs ?? 600_000
    this.leaveGraceMs = opts.leaveGraceMs ?? 60_000
    this.reminder = opts.reminder
    this.sweepMs = opts.sweepMs ?? 30_000
    this.every = opts.every ?? defaultEvery
    this.presence?.onLeave((gameId, seatToken) => this.onLeave(gameId, seatToken))
  }

  /** Starts the periodic sweep. Anything already overdue (say, across a restart) goes out on the first tick. */
  start(): void {
    this.ticker ??= this.every(() => void this.sweep(), this.sweepMs)
  }

  stop(): void {
    this.ticker?.cancel()
    this.ticker = undefined
  }

  private onLeave(gameId: string, seatToken: string): void {
    const pending = this.store.pendingPing(gameId)
    if (pending === undefined || pending.seatToken !== seatToken) return
    this.store.setPendingPing({ ...pending, dueAt: this.now() + this.leaveGraceMs })
  }

  /** Sends every deferred ping and stall reminder that has come due. Safe to call at any time. */
  async sweep(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      // One game that no longer replays must not hold up the others' pings.
      const each = async (gameId: string, send: () => Promise<void>): Promise<void> => {
        try {
          await send()
        } catch (e) {
          console.warn(`[notify] sweep failed for ${gameId}:`, (e as Error).message)
        }
      }
      for (const pending of this.store.duePendingPings(this.now())) {
        this.store.clearPendingPing(pending.gameId)
        await each(pending.gameId, () => this.sendPending(pending))
      }
      const reminder = this.reminder
      if (reminder !== undefined) {
        for (const r of this.store.allReminders()) await each(r.gameId, () => this.remind(r, reminder))
      }
    } catch (e) {
      console.warn('[notify] sweep failed:', (e as Error).message)
    } finally {
      this.sweeping = false
    }
  }

  private async sendPending(pending: PendingPing): Promise<void> {
    const { gameId } = pending
    if (this.store.journalLength(gameId) !== pending.journalLength) return
    const meta = this.store.meta(gameId)
    if (meta !== undefined && this.now() - meta.lastNotifiedAt < this.windowMs) return
    const seat = this.store.seats(gameId).find((s) => s.seatToken === pending.seatToken)
    // A game that no longer replays has no turn to show.
    const result = this.current(gameId)
    if (seat === undefined || result === undefined) return
    const card = this.turnCard(gameId, seat, result)
    if (card === undefined) return
    await this.postCards(gameId, [card], pending.journalLength)
  }

  /** Sends the stall reminder for one game if the seat is still the one being waited on and its slot is due. */
  private async remind(r: Reminder, { time, tz }: { time: DailyTime; tz: string }): Promise<void> {
    if (r.count >= MAX_REMINDERS || this.fallbackChannel === undefined) return
    const { gameId } = r
    if (this.store.journalLength(gameId) !== r.journalLength) return
    const lastMove = this.store.updatedAt(gameId)
    if (lastMove === undefined) return
    // First reminder: the first slot at least 24 h after the last move. Then the first slot after the last send.
    const due = r.count === 0 ? nextSlotAfter(lastMove + DAY_MS - 1, time, tz) : nextSlotAfter(r.lastAt, time, tz)
    const now = this.now()
    if (now < due) return
    // Only in the hour after the slot: a stall found late (a long-idle game, a server that was down
    // over 16:30) waits for the next 16:30 instead of pinging at whatever hour it is.
    if (now - nextSlotAfter(now - DAY_MS, time, tz) > SLOT_WINDOW_MS) return
    const seat = this.store.seats(gameId).find((s) => s.seatToken === r.seatToken)
    if (seat === undefined || seat.isBot || !seat.pings) return
    // Counted before the post: like every ping here, a failed one is forgotten, not retried every sweep.
    this.store.noteReminded(gameId, now)
    const days = Math.max(1, Math.floor((now - lastMove) / DAY_MS))
    const card = reminderCard(seat, this.current(gameId)?.state, {
      days,
      count: r.count + 1,
      max: MAX_REMINDERS,
      lastMove,
    })
    await this.post(gameId, card)
  }

  /** Who the game now waits on, for the stall reminder. A new mover or a longer journal restarts the count. */
  private trackStall(gameId: string, after: RuleResult): void {
    const waitingOn = after.state.isOver ? undefined : this.store.seats(gameId).find((s) => s.faction === askedOf(after))
    if (waitingOn !== undefined && !waitingOn.isBot) this.store.watchStall(gameId, waitingOn.seatToken, after.state.journal.length)
    else this.store.clearStall(gameId)
  }

  /**
   * Startup: track games already waiting on a human. A stall is otherwise noticed only when a move
   * settles, so a game idle since before this server started would never be reminded.
   */
  watchStalls(): void {
    for (const gameId of this.store.gameIds()) {
      try {
        const result = this.current(gameId)
        if (result !== undefined) this.trackStall(gameId, result)
      } catch {
        // A game that no longer replays is not one anybody is waiting on.
      }
    }
  }

  async onSettled({ gameId, before, after }: Settled): Promise<void> {
    const length = after.state.journal.length
    // A held ping is stale once the journal has moved. Same length means a restart re-settling the game: keep it.
    if (this.store.pendingPing(gameId)?.journalLength !== length) this.store.clearPendingPing(gameId)

    const meta = this.store.meta(gameId)
    if (meta === undefined) return
    if (this.fallbackChannel === undefined) return
    const seats = this.store.seats(gameId)

    this.trackStall(gameId, after)

    if (length <= meta.lastNotifiedLength) return

    const cards: Card[] = []
    if (after.state.isOver) {
      cards.push(gameOverCard(after.state, seats))
    } else {
      if (before !== null && after.state.chapter !== before.state.chapter) {
        cards.push(chapterCard(before.state, after.state, seats))
      }
      const asked = askedOf(after)
      const seat = asked === undefined ? undefined : seats.find((s) => s.faction === asked)
      // A turn is many asks in a row for the same player; ping only when the asked player changes.
      // After a restart (before === null) the length guard above already decided it is news.
      const changed = before === null ? true : askedOf(before) !== asked
      if (seat !== undefined && !seat.isBot && changed) {
        this.presence?.send(gameId, seat.seatToken, { turn: { faction: seat.faction, chapter: after.state.chapter, length } })
        if (seat.pings && this.presence?.isActive(gameId, seat.seatToken) === true) {
          // Defer: wait to see if the journal moves before pinging Discord. Held in SQLite, sent by `sweep`.
          this.store.setPendingPing({
            gameId,
            seatToken: seat.seatToken,
            journalLength: length,
            chapter: after.state.chapter,
            dueAt: this.now() + this.graceMs,
          })
        } else {
          const inWindow = this.now() - meta.lastNotifiedAt < this.windowMs
          if (!inWindow || cards.length > 0) {
            const card = this.turnCard(gameId, seat, after)
            if (card !== undefined) cards.push(card)
          }
        }
      }
    }

    await this.postCards(gameId, cards, length)
  }

  /** The turn-ping card for a seat, or `undefined` when pings are off for it. */
  private turnCard(gameId: string, seat: SeatRow, result: RuleResult): Card | undefined {
    if (!seat.pings) return undefined
    return turnCard(seat, result, this.store.seats(gameId), this.now())
  }

  /** Posts the cards as one message to the channel; false when it failed or there is no channel. */
  private async post(gameId: string, ...cards: Card[]): Promise<boolean> {
    if (this.fallbackChannel === undefined) return false
    try {
      await this.fallbackChannel.bot.postMessage(this.fallbackChannel.channelId, {
        content: cards.map((c) => c.content).filter((c) => c !== '').join('\n'),
        mentions: [...new Set(cards.flatMap((c) => c.mentions))],
        embeds: cards.map((c) => c.embed),
        /*
         * The game link, not the seat's. The channel is shared, so a seat link there lets anyone who
         * clicks it play that seat, and their browser then remembers it in place of their own. A bare
         * game link opens whichever seat this browser last played in the game (`recall` in the web
         * client), so the player whose turn it is still lands in their seat.
         */
        link: { label: 'Open game', url: seatLink(this.origin, gameId) },
      })
      return true
    } catch (e) {
      console.warn('[notify] post failed:', (e as Error).message)
      return false
    }
  }

  private async postCards(gameId: string, cards: readonly Card[], length: number): Promise<void> {
    if (cards.length === 0) return
    if (await this.post(gameId, ...cards)) this.store.markNotified(gameId, length, this.now())
  }
}
