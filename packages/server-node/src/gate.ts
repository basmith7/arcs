/**
 * The one place this server runs the rules.
 *
 * Wraps `SqliteStore` and, for each game, keeps the last replayed `RuleResult`. That answers three
 * questions the bare store cannot: is this action from the faction being asked (turn check), is a
 * bot being asked (then play it, here, so every client sees the same journal), and who is asked
 * now (notifications, via `onSettled`).
 *
 * Bot stepping for a game runs on a per-game promise chain, so a human append and a bot run never
 * interleave. `settled(gameId)` awaits that chain — tests and the notifier use it.
 */
import {
  applyExternal,
  botForLevel,
  botToAct,
  decodeAction,
  defaultRegistry,
  encodeAction,
  NO_ASKS,
  replayGame,
  stepBot,
} from '@arcs/engine'
import type { AskedThisTurn, NewGameOptions, RuleResult } from '@arcs/engine'
import type { AppendResult } from '@arcs/server'

import type { SqliteStore } from './sqlite-store.js'

export interface Push {
  readonly from: number
  readonly entries: readonly string[]
}

export type GateAppend = AppendResult | { readonly ok: false; readonly reason: 'wrong-turn' | 'game-over' }

export interface Settled {
  readonly gameId: string
  readonly before: RuleResult | null
  readonly after: RuleResult
}

export interface GateOptions {
  /** Milliseconds between bot actions so connected clients can follow. Default 1000. */
  readonly pace?: number
  readonly onSettled?: (s: Settled) => void
}

const CACHE_LIMIT = 100

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))

/** Every faction the engine is waiting on right now; [] when the game is over or mid-`then`. */
export function askedFactions(result: RuleResult): readonly string[] {
  const c = result.continue
  if (c.kind === 'ask') return [c.faction]
  if (c.kind === 'multiAsk') return c.asks.map((a) => a.faction)
  return []
}

/** The first asked faction — what the notifier and `askedFaction` report. */
export function askedOf(result: RuleResult): string | undefined {
  return askedFactions(result)[0]
}

export class EngineGate {
  private readonly registry = defaultRegistry()
  private readonly cache = new Map<string, RuleResult>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly listeners = new Map<string, Set<(push: Push) => void>>()
  private readonly pace: number
  private readonly onSettled: ((s: Settled) => void) | undefined

  constructor(
    private readonly store: SqliteStore,
    opts: GateOptions = {},
  ) {
    this.pace = opts.pace ?? 1000
    this.onSettled = opts.onSettled
  }

  // --- reading --------------------------------------------------------------

  resultOf(gameId: string): RuleResult | undefined {
    const hit = this.cache.get(gameId)
    if (hit !== undefined) {
      // Touch for LRU: delete + set moves it to the end of insertion order.
      this.cache.delete(gameId)
      this.cache.set(gameId, hit)
      return hit
    }
    const options = this.store.options(gameId) as NewGameOptions | undefined
    if (options === undefined) return undefined
    const result = replayGame(options, this.store.journal(gameId), this.registry)
    this.remember(gameId, result)
    return result
  }

  askedFaction(gameId: string): string | undefined {
    const result = this.resultOf(gameId)
    return result === undefined ? undefined : askedOf(result)
  }

  // --- writing --------------------------------------------------------------

  async append(
    gameId: string,
    seatToken: string,
    expectedLength: number,
    action: string,
  ): Promise<GateAppend> {
    // On the game's queue, so the turn check always sees the real head of the journal — a bot run
    // in progress finishes first, and a stale expectedLength then fails as a plain conflict.
    return this.enqueue(gameId, () => this.appendNow(gameId, seatToken, expectedLength, action))
  }

  private async appendNow(
    gameId: string,
    seatToken: string,
    expectedLength: number,
    action: string,
  ): Promise<GateAppend> {
    const before = this.resultOf(gameId)
    if (before === undefined) return { ok: false, reason: 'no-such-game' }
    if (before.state.isOver) return { ok: false, reason: 'game-over' }

    // Only a faction being asked may act. The store's own actorOf check still runs after.
    const asked = askedFactions(before)
    const seat = this.store.seats(gameId).find((s) => s.seatToken === seatToken)
    if (seat === undefined) return { ok: false, reason: 'bad-seat' }
    if (asked.length > 0 && !asked.includes(seat.faction)) return { ok: false, reason: 'wrong-turn' }

    // Prove the action replays before storing it, so a bad string never poisons the journal.
    let after: RuleResult
    try {
      if (before.state.journal.length !== expectedLength) {
        return { ok: false, reason: 'conflict', length: before.state.journal.length }
      }
      after = applyExternal(before, decodeAction(action), this.registry)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[gate] rejected action', gameId, message)
      return { ok: false, reason: 'wrong-turn' }
    }

    const stored = await this.store.append(gameId, seatToken, expectedLength, action)
    if (!stored.ok) return stored
    this.remember(gameId, after)
    this.emit(gameId, { from: expectedLength, entries: [action] })

    // Bots play on the same queue but as their own job, so this append resolves now and the HTTP
    // response is not held for a whole bot round. Nothing else can slip in between: the queue
    // orders this job, then the bot job, then anything that arrives later. The job is registered
    // on the queue synchronously (so `settled` sees it right away) but its body is deferred past a
    // macrotask boundary, so the caller's own continuation from this `append` always runs first —
    // otherwise a same-tick microtask race could let the bot's first move land before the caller
    // observes the human-only journal it was promised.
    void this.enqueue(
      gameId,
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            void this.runBots(gameId, after).then((done) => {
              this.onSettled?.({ gameId, before, after: done })
              resolve()
            })
          }, 0)
        }),
    )
    return stored
  }

  /** Play bot seats until a human is asked or the game ends. Returns the final result. */
  private async runBots(gameId: string, start: RuleResult): Promise<RuleResult> {
    const options = this.store.options(gameId) as NewGameOptions | undefined
    if (options === undefined) return start
    const bots = this.store.seats(gameId).filter((s) => s.isBot)
    if (bots.length === 0) return start
    const bot = botForLevel(options.botLevel)
    let result = start
    // `stepBot` resets this itself at a turn boundary; carry it between steps like `stepBots` does.
    let asked: AskedThisTurn = NO_ASKS
    for (;;) {
      const faction = botToAct(result, options.bots)
      if (faction === undefined || result.state.isOver) return result
      const seat = bots.find((s) => s.faction === faction)
      if (seat === undefined) return result
      const step = stepBot(result, bot, faction, this.registry, asked)
      asked = step.asked
      const encoded = encodeAction(step.decision.action)
      const at = result.state.journal.length
      const stored = await this.store.append(gameId, seat.seatToken, at, encoded)
      if (!stored.ok) {
        // Someone wrote under us (should not happen on the queue); resync from the store.
        this.cache.delete(gameId)
        result = this.resultOf(gameId) ?? result
        continue
      }
      result = step.result
      this.remember(gameId, result)
      this.emit(gameId, { from: at, entries: [encoded] })
      await sleep(this.pace)
    }
  }

  async resumeAll(): Promise<void> {
    for (const gameId of this.store.gameIds()) {
      const result = this.resultOf(gameId)
      if (result === undefined || result.state.isOver) continue
      const options = this.store.options(gameId) as NewGameOptions
      if (botToAct(result, options.bots) === undefined) continue
      void this.enqueue(gameId, async () => {
        const done = await this.runBots(gameId, result)
        this.onSettled?.({ gameId, before: null, after: done })
      })
    }
  }

  // --- push -----------------------------------------------------------------

  subscribe(gameId: string, listener: (push: Push) => void): () => void {
    let set = this.listeners.get(gameId)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(gameId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  private emit(gameId: string, push: Push): void {
    for (const l of this.listeners.get(gameId) ?? []) {
      try {
        l(push)
      } catch {
        // A broken listener must not stop the others or the append.
      }
    }
  }

  // --- queue and cache ------------------------------------------------------

  /** Resolves once every queued job for the game (appends and bot runs) has finished. */
  async settled(gameId: string): Promise<void> {
    // Loop: a job may enqueue another (an append queues its bot run).
    let tail = this.queues.get(gameId)
    while (tail !== undefined) {
      await tail
      const now = this.queues.get(gameId)
      if (now === tail) return
      tail = now
    }
  }

  private enqueue<T>(gameId: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(gameId) ?? Promise.resolve()
    const run = prev.then(job, job)
    // The chain link never rejects, so one failing job cannot poison the queue for later jobs.
    const link = run.then(
      () => undefined,
      (e: unknown) => {
        console.error(`[gate] job failed for ${gameId}:`, e)
      },
    )
    this.queues.set(gameId, link)
    void link.then(() => {
      if (this.queues.get(gameId) === link) this.queues.delete(gameId)
    })
    return run
  }

  private remember(gameId: string, result: RuleResult): void {
    this.cache.delete(gameId)
    this.cache.set(gameId, result)
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
  }
}
