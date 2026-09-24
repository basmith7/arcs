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
   * held seize makes possible. First registered at 0.5 and 1: at 0.5 `hard` seized in 71% of
   * offers, far outside the probe's 1-25% band, so the weights were re-picked by probe (as the spec
   * allows for C1) at 0.1 and 0.2.
   */
  c4a: () => hardWith({ ...MOBILE_WEIGHTS, seizeReady: 0.1 }),
  c4b: () => hardWith({ ...MOBILE_WEIGHTS, seizeReady: 0.2 }),
  /**
   * C5 (from the tie audit, docs/19 §23): where to battle and whom to hit, on top of C1a — gated
   * against `c1a`, the bot it would join.
   */
  c5: () => hardWith({ ...MOBILE_WEIGHTS, moveToward: 0.25, battleChoice: 0.25 }),
}
