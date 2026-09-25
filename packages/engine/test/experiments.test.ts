import { describe, expect, it } from 'vitest'

// Through the index: loading the module directly first trips the engine's import cycle.
import { EXPERIMENTS, botForLevel } from '../src/index.js'

describe('experiments', () => {
  it('each builds a bot distinct from hard only by its weights', () => {
    for (const [name, make] of Object.entries(EXPERIMENTS)) {
      const bot = make()
      expect(bot.id, name).toBe(botForLevel('hard').id)
    }
  })
})
