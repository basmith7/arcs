import { describe, expect, it } from 'vitest'

import { pairedGate } from '../src/ai/arena.js'
import type { GameOutcome } from '../src/ai/arena.js'

/** A 4p game with bot A in red/blue and bot B in yellow/white. */
const game = (winnerBot: 'A' | 'B', pa: number, pb: number, finished = true, seed = 1): GameOutcome => ({
  seed,
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
    const games = [...Array(60)].map((_, i) => game(i % 3 === 0 ? 'B' : 'A', 20, 15, true, i))
    const r = pairedGate(games, 'A', 'B')
    expect(r.games).toBe(60)
    expect(r.winDiff).toBeCloseTo(2 / 3 - 1 / 3, 5)
    expect(r.powerDiff).toBeCloseTo(5, 5)
    expect(r.pass).toBe(true)
  })

  it('does not pass an even split', () => {
    const games = [...Array(60)].map((_, i) => game(i % 2 === 0 ? 'B' : 'A', 15, 15, true, i))
    const r = pairedGate(games, 'A', 'B')
    expect(Math.abs(r.winZ)).toBeLessThan(0.5)
    expect(r.pass).toBe(false)
  })

  it('fails a win-rate edge bought with a clear power deficit', () => {
    const games = [...Array(60)].map((_, i) =>
      game(i % 3 === 0 ? 'B' : 'A', 10 + (i % 5), 20 + (i % 7), true, i),
    )
    const r = pairedGate(games, 'A', 'B')
    expect(r.winZ).toBeGreaterThan(2.5)
    expect(r.powerZ).toBeLessThan(-2)
    expect(r.pass).toBe(false)
  })

  it('treats games sharing a seed as one unit — they are the same deal, not independent draws', () => {
    // 30 seeds, each played 4 times with identical results: 30 units, not 120.
    const games = [...Array(30)].flatMap((_, i) =>
      [0, 1, 2, 3].map(() => game(i % 3 === 0 ? 'B' : 'A', 20, 15, true, 100 + i)),
    )
    const r = pairedGate(games, 'A', 'B')
    expect(r.games).toBe(120)
    expect(r.units).toBe(30)
    const once = pairedGate(games.filter((_, i) => i % 4 === 0), 'A', 'B')
    expect(r.winSe).toBeCloseTo(once.winSe, 6)
  })

  it('ignores unfinished games', () => {
    expect(pairedGate([game('A', 1, 1, false)], 'A', 'B').games).toBe(0)
  })
  it('treats games that share a deal as one unit — the arena replays each seed with rotated seats', () => {
    // Four seeds, each played twice with the sides swapped: A wins every deal once and loses once.
    // As independent games this looks like noise with se > 0; clustered by seed each deal nets
    // exactly zero, which is what a mirror match is.
    const games = [1, 2, 3, 4].flatMap((seed) => [game('A', 10, 10, true, seed), game('B', 10, 10, true, seed)])
    const r = pairedGate(games, 'A', 'B')
    expect(r.games).toBe(8)
    expect(r.winDiff).toBe(0)
    expect(r.winSe).toBe(0)
    expect(r.pass).toBe(false)
  })
})
