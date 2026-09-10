/**
 * Somebody else's actions as on-board events.
 *
 * The BotPanel used to narrate bot turns in prose beside the map; docs/19 section 2a's pacing
 * survives it, but the narration moved onto the board itself: each action becomes a `TurnEvent`,
 * and the surfaces draw it where it happened — a pulse on the system a ship landed in, an arrow
 * along a move, a flash on the court card that was influenced. This module is the store-side half:
 * the event record and the pure derivations the surfaces share.
 *
 * ## Why this is not "bot events"
 *
 * It was, and the name outlived the fact. Two sources feed it now, and neither one is visible from
 * here: `stepBotOnce` records the bot it just stepped, and `applyRemote` records an action that
 * arrived from another player over the session. Both are *somebody else acting while you watch*,
 * which is the only property any of this depends on — a pulse does not care whether the hand that
 * moved the ship was in this browser. Keeping "bot" in the name would have made the remote half
 * read as a hack on the bot path rather than the second caller of a general one.
 *
 * The two sources differ in exactly one way, which `queueAt` exists to absorb: a bot is paced by a
 * timer and so arrives pre-spaced, while a catch-up poll can hand over several actions at once.
 */

import type { Action, Continue, FactionId } from '@arcs/engine'

export interface TurnEvent {
  /** Monotonic per session, so React keys and prune logic never collide. */
  readonly id: number
  readonly faction: FactionId
  readonly action: Action
  /** The `state.log` lines this one action appended — the engine's own prose for it. */
  readonly lines: readonly string[]
  /** `performance.now()` when the action was applied. */
  readonly at: number
}

/** How long an event's visuals live, in ms. The pace leaves most of this visible per action. */
export const EVENT_LIFE_MS = 2600

/**
 * The least time between two events' captions, in ms.
 *
 * Comfortably shorter than `EVENT_LIFE_MS`, so a staggered burst overlaps rather than playing as
 * a slideshow of one caption at a time — the map should look busy during a catch-up, not slow.
 */
export const STAGGER_MS = 600

export interface Placement {
  readonly kind: 'pulse' | 'arrow' | 'battle'
  readonly system?: string
  readonly from?: string
  readonly to?: string
}

/** Action types whose system field points at a fight rather than a placement. */
const BATTLE_TYPES = /^(battle\/|rifles\/|action\/martyr$)/

/**
 * Where on the map an action happened, or `null` for actions with no board location.
 *
 * Deliberately generic: any action carrying `from` + `to` reads as a movement, and any action
 * carrying a system-shaped field (`system`, `at`, `to`) reads as something happening *there* —
 * builds, taxes, vox placements, `turn/gates-place`, `turn/ships-place` and reinforcements all
 * fall out of the field scan without being named. Court, ambition and card-play actions carry
 * none of these fields and return `null`; their surfaces flash instead (`liveFlash` below).
 */
export function derivePlacement(action: Action): Placement | null {
  const str = (k: string): string | undefined => {
    const v = action[k]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const from = str('from')
  const to = str('to')
  // A movement names both ends; `from` alone (e.g. a Union's take) is not a map location pair.
  if (from !== undefined && to !== undefined && from.includes('-') && to.includes('-')) {
    return { kind: 'arrow', from, to }
  }
  const system = str('system') ?? str('at')
  if (system === undefined || !system.includes('-')) return null
  return { kind: BATTLE_TYPES.test(action.type) ? 'battle' : 'pulse', system }
}

/**
 * The one-line caption drawn beside the event: the engine's own first log line for the action
 * when there is one (they read like "blue built a Ship in 1-Hex"), else the action's label.
 */
export function caption(event: TurnEvent): string {
  const line = event.lines[0]
  if (line !== undefined) return line
  const label = event.action['label']
  return typeof label === 'string' ? `${event.faction}: ${label}` : event.faction
}

/** Which court slot an event flashes, if any. */
export function courtFlashSlot(action: Action): number | undefined {
  if (action.type !== 'action/influence' && action.type !== 'action/secure' && action.type !== 'action/ransack') {
    return undefined
  }
  const slot = action['slot']
  return typeof slot === 'number' ? slot : undefined
}

/** Which ambition row an event flashes, if any. */
export function ambitionFlash(action: Action): string | undefined {
  if (
    action.type !== 'ambition/declare' &&
    action.type !== 'vox/populist' &&
    action.type !== 'turn/prelude-tycoon'
  ) {
    return undefined
  }
  const ambition = action['ambition']
  return typeof ambition === 'string' ? ambition : undefined
}

/** Which just-played action card an event flashes, if any. */
export function playedCardFlash(action: Action): string | undefined {
  if (
    action.type !== 'turn/lead' &&
    action.type !== 'turn/surpass' &&
    action.type !== 'turn/copy' &&
    action.type !== 'turn/pivot'
  ) {
    return undefined
  }
  const card = action['card']
  return typeof card === 'string' ? card : undefined
}

/**
 * When an event should play, given what is already queued.
 *
 * Normally `now`: a bot is paced by its timer, and a remote player's actions arrive one WebSocket
 * push at a time. The case this exists for is catch-up — the single poll after the socket opens or
 * reopens, and the polling fallback — where `session.ts` loops the whole tail into `applyRemote`
 * in one pass. Those actions share an instant, and their captions would be drawn on top of each
 * other on the same few systems.
 *
 * So an event that lands inside the stagger of the newest one is pushed just past it, and the next
 * one past that: a burst becomes a sequence. The board itself is already at the final position
 * either way — these are captions for what has landed, not an animation of it landing, which is
 * the honest reading of a connection that just caught up.
 */
export function queueAt(events: readonly TurnEvent[], now: number): number {
  const last = events[events.length - 1]
  if (last === undefined) return now
  return Math.max(now, last.at + STAGGER_MS)
}

/**
 * Who acted, for an action the store was handed rather than chose.
 *
 * The bot path names the faction outright — it picked the seat before stepping it. A remote action
 * carries only what was published, so the actor is read off the position it answered: the engine
 * addresses an ask to whoever must answer it, which is whoever sent this. `undefined` when neither
 * the ask nor the action names anybody, which the caller treats as "record nothing" — an event in
 * a guessed colour would be worse than no event.
 */
export function eventActor(before: Continue, action: Action): FactionId | undefined {
  if (before.kind === 'ask') return before.faction
  const own = action['faction']
  return typeof own === 'string' ? (own as FactionId) : undefined
}

/**
 * Events still worth drawing, newest last.
 *
 * Both ends of the window are load-bearing. The upper one ages an event out; the lower one holds
 * an event `queueAt` has put in the future, and without it a staggered burst would flash all at
 * once — `now - at` is negative for a queued event, which the age test alone reads as very fresh.
 */
export function liveEvents(events: readonly TurnEvent[], now: number): TurnEvent[] {
  return events.filter((e) => e.at <= now && now - e.at < EVENT_LIFE_MS)
}

/**
 * The newest live event a surface should flash for, through its own picker
 * (`courtFlashSlot`, `ambitionFlash`, `playedCardFlash`).
 *
 * The `id` is part of the result so the surface can *key* the flashed element by it — a keyed
 * remount is what restarts the CSS animation when two consecutive events hit the same target.
 */
export function liveFlash<T>(
  events: readonly TurnEvent[],
  now: number,
  pick: (action: Action) => T | undefined,
): { value: T; id: number } | undefined {
  for (const e of [...liveEvents(events, now)].reverse()) {
    const value = pick(e.action)
    if (value !== undefined) return { value, id: e.id }
  }
  return undefined
}
