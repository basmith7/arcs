/**
 * `playoutFrom` — the rollout the advisor's oracle is built on (spec 2026-09-23 rev 3, B1).
 *
 * The contracts that matter: it is deterministic for a (position, candidate, salt), it cannot see
 * a rival's real hand, and it stops where its horizon says.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  botToAct,
  contentsOf,
  defaultRegistry,
  mobileBot,
  moveAll,
  startGame,
  trivialBot,
} from '../src/index.js'
import { NO_ASKS, playoutFrom, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const TWO: readonly FactionId[] = ['red', 'yellow']

/** A real 2p game driven to the first card-play ask at or past `minSteps`. */
function midGame(seed: number, minSteps: number): RuleResult {
  let cur = startGame({ board: 'Board2Frontiers', factions: [...TWO], seed }, registry)
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < minSteps + 400; i++) {
    const c = cur.continue
    if (i >= minSteps && c.kind === 'ask' && c.actions.some((a) => a.type === 'turn/lead')) return cur
    const f = botToAct(cur, TWO)
    if (f === undefined) break
    const step = stepBot(cur, mobileBot, f, registry, asked)
    cur = step.result
    asked = step.asked
  }
  throw new Error('no lead ask reached — fixture broke')
}

/**
 * The same position with the rival's hand, the deck and the discard rotated into each other.
 *
 * The discard is included because at two players the deck is often empty mid-chapter — a rotation
 * of the rival's hand alone is the identity, and the test would pass a playout that cheats.
 */
function swapHidden(state: GameState, self: FactionId): GameState {
  const zones = [
    ...state.factions.filter((f) => f !== self).map((r) => CardLocation.hand(r)),
    CardLocation.deck(),
    CardLocation.discard(),
  ]
  const sizes = zones.map((z) => contentsOf(state.cards, z).length)
  const pool = zones.flatMap((z) => [...contentsOf(state.cards, z)])
  expect(pool.length).toBeGreaterThan(sizes[0]!)
  const rotated = [...pool.slice(sizes[0]!), ...pool.slice(0, sizes[0]!)]
  let cards = state.cards
  let cursor = 0
  for (let i = 0; i < zones.length; i++) {
    cards = moveAll(cards, rotated.slice(cursor, cursor + sizes[i]!), zones[i]!)
    cursor += sizes[i]!
  }
  return { ...state, cards }
}

describe('playoutFrom', () => {
  const base = midGame(3, 30)
  const self = (base.continue as { faction: FactionId }).faction
  const lead = (base.continue as { actions: readonly { type: string }[] }).actions.find(
    (a) => a.type === 'turn/lead',
  )!

  it('is deterministic for the same position, candidate and salt', () => {
    const opts = { policy: mobileBot, horizon: 'chapter' as const, salt: 5 }
    const a = playoutFrom(base, self, lead as never, opts, registry)
    const b = playoutFrom(base, self, lead as never, opts, registry)
    expect(JSON.stringify(a.power)).toBe(JSON.stringify(b.power))
    expect(JSON.stringify(a.observed)).toBe(JSON.stringify(b.observed))
  })

  it('cannot see the rival’s real hand — the no-cheat property', () => {
    const altered: RuleResult = { ...base, state: swapHidden(base.state, self) }
    const opts = { policy: mobileBot, horizon: 'chapter' as const, salt: 7 }
    const a = playoutFrom(base, self, lead as never, opts, registry)
    const b = playoutFrom(altered, self, lead as never, opts, registry)
    expect(JSON.stringify(a.observed)).toBe(JSON.stringify(b.observed))
  })

  it('plays the candidate it is given', () => {
    const leads = (base.continue as { actions: readonly { type: string }[] }).actions.filter(
      (a) => a.type === 'turn/lead',
    )
    expect(leads.length).toBeGreaterThan(1)
    const opts = { policy: mobileBot, horizon: 'chapter' as const, salt: 2 }
    const [a, b] = leads.slice(0, 2).map((l) => playoutFrom(base, self, l as never, opts, registry))
    expect(a!.observed.log.join('\n')).not.toBe(b!.observed.log.join('\n'))
  })

  it('different salts give different worlds', () => {
    const seen = new Set(
      [1, 2, 3, 4].map((salt) =>
        JSON.stringify(
          playoutFrom(base, self, lead as never, { policy: mobileBot, horizon: 'chapter', salt }, registry)
            .observed,
        ),
      ),
    )
    expect(seen.size).toBeGreaterThan(1)
  })

  it('a chapter horizon stops at the chapter boundary', () => {
    const r = playoutFrom(base, self, lead as never, { policy: trivialBot, horizon: 'chapter', salt: 1 }, registry)
    expect(r.observed.chapter === base.state.chapter + 1 || r.finished).toBe(true)
  })

  it('a game horizon plays to the end and names a winner', () => {
    const r = playoutFrom(base, self, lead as never, { policy: trivialBot, horizon: 'game', salt: 1 }, registry)
    expect(r.finished).toBe(true)
    expect(r.winner).toBeDefined()
  })
})
