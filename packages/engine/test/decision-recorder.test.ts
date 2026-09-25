/**
 * The per-decision recorder behind the coverage report (spec 2026-09-23 rev 3, section 6): told
 * once per bot decision what was offered and what was taken — and invisible when absent.
 */
import { describe, expect, it } from 'vitest'

import { defaultRegistry, mobileBot, runBots, startGame } from '../src/index.js'
import type { Action, FactionId } from '../src/index.js'

const reg = defaultRegistry()
const F: FactionId[] = ['red', 'yellow']
const options = { board: 'Board2Frontiers', factions: F, seed: 31, bots: F }

describe('runBots onDecision', () => {
  it('reports every decision: who, what was offered, what was taken', () => {
    const seen: { faction: FactionId; offered: readonly Action[]; taken: Action }[] = []
    const out = runBots(startGame(options, reg), F, mobileBot, reg, 50_000, (faction, offered, taken) =>
      seen.push({ faction, offered, taken }),
    )
    expect(seen.length).toBe(out.decisions.length)
    seen.forEach((s, i) => {
      expect(s.taken).toBe(out.decisions[i]!.action)
      expect(s.offered).toContain(s.taken)
    })
  })

  it('plays the identical game with or without it', () => {
    const plain = runBots(startGame(options, reg), F, mobileBot, reg, 50_000)
    const recorded = runBots(startGame(options, reg), F, mobileBot, reg, 50_000, () => undefined)
    expect(recorded.result.state.journal).toEqual(plain.result.state.journal)
  })
})
