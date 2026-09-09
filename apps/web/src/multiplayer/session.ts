/**
 * A joined game: publishes what you do, and replays what everyone else did.
 *
 * docs/17 section 4 calls this "two hooks in one file" — post it, and replay the tail on poll. The
 * only real decision is what happens when those two disagree.
 *
 * ## Optimistic, with replay as the fix
 *
 * A move is applied locally **immediately** and published in the background, rather than waiting for
 * the round trip. The alternative — post first, apply on success — is simpler to reason about but
 * puts a network hop between clicking a card and seeing it move, on every single action.
 *
 * Optimism normally costs you rollback machinery. It does not here, and that is the journal design
 * paying off (docs/11): when the server says someone got there first, there is nothing to unwind
 * because the authoritative journal can simply be **replayed**. `resync` throws away local state and
 * rebuilds from `{ options, journal }`, which reproduces the game byte for byte. A 466-action game
 * replays in about 23 ms at the engine's measured 0.049 ms per action, so the expensive-sounding
 * option is the cheap one.
 *
 * Conflicts are rare regardless: turns are strictly sequential, so the realistic causes are a
 * double-tap and a stale tab rather than genuine contention.
 *
 * ## What it does not do
 *
 * It does not check whose turn it is. The engine already will not offer an action to a seat that may
 * not take it, and the server deliberately does not know the rules (docs/17 section 4). What it does
 * check is that this client *holds a seat* — a spectator publishes nothing.
 */

import { decodeAction, encodeAction, replayGame } from '@arcs/engine'
import type { Action, NewGameOptions, RuleResult } from '@arcs/engine'

import { ApiError, MultiplayerClient } from './client.js'
import type { PublicSeat } from './client.js'
import type { GameLink } from './link.js'

/** How often to ask for the tail. docs/17 section 4: adequate for a game where a turn takes a minute. */
export const POLL_MS = 2500

/**
 * How long to wait before trying the socket again after it drops.
 *
 * Longer than a poll on purpose: while it is down the game is still working over HTTP, so there is
 * nothing to rush, and a tight reconnect loop against an origin that is refusing sockets would cost
 * more than the polling it is trying to escape.
 */
export const RETRY_MS = 5000

/** How often an activity listener may send `{"t":"active"}` again. */
export const ACTIVITY_THROTTLE_MS = 30_000

export interface SessionHost {
  /** The game as this client currently has it, or `null` before it has loaded. */
  current(): RuleResult | null
  /** Replace the game wholesale — used by the initial load and by `resync`. */
  adopt(options: NewGameOptions, result: RuleResult): void
  /** Apply one action that arrived from elsewhere. Must not re-publish it. */
  applyRemote(action: Action): void
  /** The current seat list — faction, optional name, bot flag — whenever it changes. */
  seats(seats: readonly PublicSeat[]): void
  /** A turn notice pushed for some seat. Carries no journal entries of its own. */
  turn?(t: { faction: string; chapter: number; length: number }): void
}

export class Session {
  private readonly client: MultiplayerClient
  private timer: ReturnType<typeof setInterval> | null = null
  private options: NewGameOptions | null = null
  /** Guards against a poll overlapping itself on a slow connection. */
  private busy = false
  /**
   * Which faction this client's seat token belongs to, as told by the server on join.
   *
   * `null` until the first read completes, and for a spectator. Only the server can answer this —
   * a seat token is opaque — and it is what lets the UI say who you are, hide rivals' hands and
   * refuse to act for anyone else.
   */
  private seatFaction: string | null = null
  /** The poll currently in flight, if any — awaited by `claimName` so a stale read cannot clobber a claim. */
  private inflight: Promise<void> | null = null
  /** The live socket, or `null` while falling back to polling. */
  private socket: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  /**
   * Set when the server says the game does not exist.
   *
   * A 404 on a game id is permanent — nothing here ever creates one — so retrying is asking the
   * same question forever. Without this a tab left open on a deleted game polls *and* reconnects
   * indefinitely, which was visible in the dev log as a steady drip of 404s, and would be a real
   * bill against the very budget this file exists to protect.
   */
  private gone = false
  /** Cleanup for the document/window activity listeners, or `null` when not attached. */
  private removeActivityListeners: (() => void) | null = null
  private lastActiveSentAt = 0

  constructor(
    baseUrl: string,
    readonly link: GameLink,
    private readonly host: SessionHost,
  ) {
    this.client = new MultiplayerClient(baseUrl)
  }

  get isSpectator(): boolean {
    return this.link.seatToken === undefined
  }

  /** Which faction you are, or `null` if you are watching (or have not loaded yet). */
  get faction(): string | null {
    return this.seatFaction
  }

  /** Load the game, then listen for what everyone else does. */
  async join(): Promise<void> {
    await this.resync()
    this.openSocket()
    this.attachActivityListeners()
  }

  leave(): void {
    this.stopPolling()
    if (this.retry !== null) clearTimeout(this.retry)
    this.retry = null
    const ws = this.socket
    this.socket = null
    try {
      ws?.close()
    } catch {
      /* already gone */
    }
    this.removeActivityListeners?.()
    this.removeActivityListeners = null
  }

  /**
   * Tell the server this seat is being actively used, at most once per `ACTIVITY_THROTTLE_MS`.
   *
   * `force` bypasses the throttle for the one call that matters most — right after the socket
   * opens, since that is what the presence check on the other end actually keys off.
   */
  private sendActive(force = false): void {
    const ws = this.socket
    if (ws === null || ws.readyState !== ws.OPEN) return
    const now = Date.now()
    if (!force && now - this.lastActiveSentAt < ACTIVITY_THROTTLE_MS) return
    this.lastActiveSentAt = now
    try {
      ws.send(JSON.stringify({ t: 'active' }))
    } catch {
      /* socket race on the way down; the next reconnect will send one on open */
    }
  }

  /**
   * Listen for the browser signals that mean "a person is here", so a player who is on the board
   * but idle at the keyboard still reads as present. Guarded because these tests (and any non-DOM
   * host) have no `document`/`window` at all.
   */
  private attachActivityListeners(): void {
    if (this.removeActivityListeners !== null) return
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const onActivity = (): void => this.sendActive()
    const onVisibility = (): void => {
      if (!document.hidden) onActivity()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onActivity)
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    this.removeActivityListeners = () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onActivity)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }

  // --- push -----------------------------------------------------------------

  /**
   * Open the live socket, and fall back to polling if it will not.
   *
   * Failure is not exceptional: a proxy that blocks WebSockets, an origin that has not deployed the
   * route, a `WebSocket` that does not exist in whatever is running this. Every one of those ends in
   * `onclose`, and every one of them is survivable — polling is slower and dearer, not broken. The
   * game must never depend on the socket, which is why `poll` stays.
   */
  private openSocket(): void {
    if (this.gone) return
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') {
      this.startPolling()
      return
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(this.client.liveUrl(this.link.gameId, location.href, this.link.seatToken))
    } catch {
      this.startPolling()
      return
    }
    this.socket = ws

    ws.onopen = () => {
      if (this.socket !== ws) return
      this.sendActive(true)
      /*
       * One catch-up read, then stop paying for the timer. This covers the gap between the join
       * read and the socket being live, and — on a reconnect — everything missed while it was down.
       */
      void this.poll().then(() => {
        if (this.socket === ws) this.stopPolling()
      })
    }
    ws.onmessage = (event: MessageEvent) => {
      if (this.socket === ws) this.applyPush(String(event.data))
    }
    ws.onclose = () => {
      if (this.socket !== ws) return
      this.socket = null
      /*
       * Keep the game working first, then try to get the cheap path back. A blip on a three-hour
       * game should not cost the socket for the rest of it, and a reopen that succeeds stops the
       * polling again in `onopen`.
       */
      this.startPolling()
      this.retry = setTimeout(() => this.openSocket(), RETRY_MS)
    }
  }

  /**
   * Apply what the server pushed.
   *
   * The payload is `{ from, entries }` — the entries themselves, not a nudge to go and fetch them,
   * which would put an HTTP request back on every action and give away most of the saving.
   *
   * `from` is what makes it safe to apply blind. Three cases, and the middle one is the common one:
   * a gap means something was missed and replay is the only honest answer; entries we already hold
   * are our own move coming back, since publishing is optimistic and applied locally first.
   */
  private applyPush(raw: string): void {
    let push: { from?: unknown; entries?: unknown; turn?: unknown }
    try {
      push = JSON.parse(raw) as { from?: unknown; entries?: unknown; turn?: unknown }
    } catch {
      return
    }

    const turn = push.turn
    if (typeof turn === 'object' && turn !== null && typeof (turn as { faction?: unknown }).faction === 'string') {
      this.host.turn?.(turn as { faction: string; chapter: number; length: number })
      return
    }

    const from = push.from
    const entries = push.entries
    if (typeof from !== 'number' || !Array.isArray(entries)) return

    const seats = (push as { seats?: unknown }).seats
    if (Array.isArray(seats)) this.host.seats(seats as PublicSeat[])

    const have = this.host.current()?.state.journal.length ?? 0
    if (from > have) {
      void this.resync()
      return
    }
    const already = have - from
    if (already >= entries.length) return
    for (const entry of entries.slice(already)) {
      this.host.applyRemote(decodeAction(String(entry)))
    }
  }

  private startPolling(): void {
    if (this.timer !== null || this.gone) return
    this.timer = setInterval(() => {
      void this.poll()
    }, POLL_MS)
  }

  private stopPolling(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Rebuild from the authoritative journal.
   *
   * The whole recovery story, and the reason optimism is affordable. Used on join, and whenever a
   * publish conflicts — replay is exact, so there is no partial state to reconcile.
   */
  async resync(): Promise<void> {
    const tail = await this.client.read(this.link.gameId, 0, this.link.seatToken)
    const options = tail.options as NewGameOptions
    this.options = options
    this.seatFaction = tail.yourFaction ?? null
    this.host.adopt(options, replayGame(options, [...tail.entries]))
    this.host.seats(tail.seats ?? [])
  }

  /** Ask for anything new and apply it. Called on a timer; safe to call by hand. */
  async poll(): Promise<void> {
    if (this.busy || this.gone) return
    this.busy = true
    const task = this.runPoll()
    this.inflight = task
    try {
      await task
    } finally {
      if (this.inflight === task) this.inflight = null
    }
  }

  private async runPoll(): Promise<void> {
    try {
      const have = this.host.current()?.state.journal.length ?? 0
      const tail = await this.client.read(this.link.gameId, have)
      /*
       * Shorter than we are is not possible on an append-only list, so it means we are looking at a
       * different game than we think — a reset, or a bug. Replay rather than guess.
       */
      if (tail.length < have) {
        await this.resync()
        return
      }
      for (const entry of tail.entries) this.host.applyRemote(decodeAction(entry))
      if (tail.seats !== undefined) this.host.seats(tail.seats)
    } catch (e) {
      /*
       * Only a 404 stops us. Anything else — a dropped connection, a 500, a proxy hiccup — is
       * transient, and giving up on it would turn a blip into a dead session; the next tick is the
       * recovery.
       *
       * Swallowed rather than rethrown because every caller is `void this.poll()`, so a rethrow
       * becomes an unhandled rejection. That was the old behaviour and it was visible as a steady
       * run of `Uncaught (in promise) ApiError` in the console — noise that said nothing actionable,
       * since the retry already handles it.
       */
      if (e instanceof ApiError && e.status === 404) this.abandon()
    } finally {
      this.busy = false
    }
  }

  /** The game is gone. Stop everything and stay stopped. */
  private abandon(): void {
    this.gone = true
    this.leave()
  }

  /**
   * Publish a move already applied locally.
   *
   * `expectedLength` is the journal length **before** the action, which is what makes a double-tap a
   * no-op server-side. Deliberately not awaited by callers: the move is already on screen, and the
   * only outcome that needs handling is a conflict, which resolves itself by replaying.
   */
  async publish(action: Action, expectedLength: number): Promise<void> {
    if (this.link.seatToken === undefined) return
    try {
      const outcome = await this.client.append(
        this.link.gameId,
        this.link.seatToken,
        expectedLength,
        encodeAction(action),
      )
      if (!outcome.ok) await this.resync()
    } catch (e) {
      // A refusal (wrong turn, wrong faction, bad seat) means the optimistic local state is wrong;
      // the server's journal is the truth, so replay it. Network errors: the next poll retries.
      if (e instanceof ApiError) {
        console.warn('publish refused, resyncing', e)
        await this.resync()
      } else {
        throw e
      }
    }
  }

  /**
   * Claim a display name for this client's seat. A spectator has no seat and does nothing.
   *
   * Waits out any poll already in flight first: a poll that started before the claim but resolves
   * after it would otherwise apply a seat list without the name just claimed, clobbering it and
   * reopening the prompt the user just answered.
   */
  async claimName(name: string, discordId?: string): Promise<void> {
    if (this.link.seatToken === undefined) return
    if (this.inflight !== null) await this.inflight.catch(() => {})
    this.host.seats(await this.client.claimName(this.link.gameId, this.link.seatToken, name, discordId))
  }
}
