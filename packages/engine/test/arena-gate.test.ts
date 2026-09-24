import { describe, expect, it } from 'vitest'

import { pairedGate } from '../src/ai/arena.js'
import type { GameOutcome } from '../src/ai/arena.js'

/** A 4p game with bot A in red/blue and bot B in yellow/white. */
const game = (winnerBot: 'A' | 'B', pa: number, pb: number, finished = true): GameOutcome => ({
  seed: 1,
  finished,
  reason: '',
  tied: false,
  chapters: 5,
  actions: 1,
  ms: 1,
  seats: { red: 'A', yellow: 'B', blue: 'A', white: 'B' },
  winner: winnerBot === 'A' ? 'red' : 'yellow',
  power: { red: pa, yellow: pb, blue: pa, white: pb },
})

describe('pairedGate', () => {
  it('scores each game as challenger win share minus control win share', () => {
    const games = [...Array(60)].map((_, i) => game(i % 3 === 0 ? 'B' : 'A', 20, 15))
    const r = pairedGate(games, 'A', 'B')
    expect(r.games).toBe(60)
    expect(r.winDiff).toBeCloseTo(2 / 3 - 1 / 3, 5)
    expect(r.powerDiff).toBeCloseTo(5, 5)
    expect(r.pass).toBe(true)
  })

  it('does not pass an even split', () => {
    const games = [...Array(60)].map((_, i) => game(i % 2 === 0 ? 'B' : 'A', 15, 15))
    const r = pairedGate(games, 'A', 'B')
    expect(Math.abs(r.winZ)).toBeLessThan(0.5)
    expect(r.pass).toBe(false)
  })

  it('fails a win-rate edge bought with a clear power deficit', () => {
    const games = [...Array(60)].map((_, i) =>
      game(i % 3 === 0 ? 'B' : 'A', 10 + (i % 5), 20 + (i % 7)),
    )
    const r = pairedGate(games, 'A', 'B')
    expect(r.winZ).toBeGreaterThan(2.5)
    expect(r.powerZ).toBeLessThan(-2)
    expect(r.pass).toBe(false)
  })

  it('ignores unfinished games', () => {
    expect(pairedGate([game('A', 1, 1, false)], 'A', 'B').games).toBe(0)
  })
})
