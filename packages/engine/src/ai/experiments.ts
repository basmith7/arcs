/**
 * Named experimental bots, so the arena can seat one by name (`--seats exp:<name>`).
 *
 * The spec 2026-09-23 rev 3 pre-registers a small family of candidates (C1a, C1b, C2a, ...); each
 * is registered here the moment it exists, so a gate run names exactly the configuration it
 * measured and a shard process builds the identical bot from the same string. Each is `hard` with
 * one change, so a gate against `hard` attributes the difference to that change alone.
 */
import { MOBILE_WEIGHTS } from './mobile.js'
import { searchBot } from './search.js'
import type { Bot } from './bot.js'
import type { Weights } from './value.js'

/** `hard` exactly as `levels.ts` builds it, with a different weight set. */
const hardWith = (weights: Weights): Bot =>
  searchBot({ width: 3, depth: 14, replies: { roots: 1, deals: 1 }, weights })

export const EXPERIMENTS: Readonly<Record<string, () => Bot>> = {
  /** C1a/C1b: where ships go, zero-sum among Move destinations (`move-target.ts`). */
  c1a: () => hardWith({ ...MOBILE_WEIGHTS, moveToward: 0.25 }),
  c1b: () => hardWith({ ...MOBILE_WEIGHTS, moveToward: 1.0 }),
  /** C3: the win-line ramp (`nearWin`). Arena time only if the B2-corpus pre-gate passes. */
  c3a: () => hardWith({ ...MOBILE_WEIGHTS, nearWin: 1 }),
  c3b: () => hardWith({ ...MOBILE_WEIGHTS, nearWin: 2 }),
  /** C2: court cards by what they do (`court-knowledge.ts`), full and half scale. */
  c2a: () => hardWith({ ...MOBILE_WEIGHTS, courtText: 1 }),
  c2b: () => hardWith({ ...MOBILE_WEIGHTS, courtText: 0.5 }),
  /**
   * C4 (added from the coverage report, docs/19 §22, into slots C1b/C2 freed): the declaration a
   * held seize makes possible. `c4a` prices it like `declareReady` (0.5); `c4b` at 1.
   */
  c4a: () => hardWith({ ...MOBILE_WEIGHTS, seizeReady: 0.5 }),
  c4b: () => hardWith({ ...MOBILE_WEIGHTS, seizeReady: 1 }),
}
