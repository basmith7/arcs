import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { botForLevel, defaultRegistry, runBots, startGame } from '../src/index.js'
import type { NewGameOptions } from '../src/index.js'

/**
 * Every bot decision pinned, so the speed work (docs/19 section 21) cannot move one silently.
 *
 * Three short two-player `normal` games from the committed fixture; the full 26-game check,
 * `hard` and four-player included, is `npm run golden`.
 */
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/golden-journals.json', import.meta.url), 'utf8'),
) as {
  games: Array<{ name: string; options: NewGameOptions; level: 'normal' | 'hard'; journal: string[] }>
}

describe('golden journals', () => {
  for (const g of fixture.games.filter((x) => x.name.startsWith('n2-')).slice(0, 3)) {
    it(`${g.name} replays decision for decision`, () => {
      const reg = defaultRegistry()
      const out = runBots(startGame(g.options, reg), g.options.factions, botForLevel(g.level), reg, 50_000)
      expect(out.result.state.journal).toEqual(g.journal)
    }, 300_000)
  }
})
