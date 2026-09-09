import { describe, expect, it } from 'vitest'

import { replayGame, startGame } from '@arcs/engine'
import type { RuleResult } from '@arcs/engine'
import { Notifier, seatLink } from '../src/notify.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { RED_OPENING, THREE_PLAYER } from './fixtures.js'

const HOOK = 'https://discord.test/hook'

async function setup(includeWebhook = true) {
  const store = new SqliteStore(':memory:')
  const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, includeWebhook ? { webhookUrl: HOOK } : {})
  store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam')
  const sent: { url: string; content: string }[] = []
  let clock = 1_000_000
  const notifier = new Notifier(store, {
    publicOrigin: 'https://arcs.test',
    post: async (url, content) => {
      sent.push({ url, content })
    },
    now: () => clock,
    windowMs: 60_000,
  })
  const start = startGame(THREE_PLAYER) // red is asked
  const afterRed = replayGame(THREE_PLAYER, RED_OPENING) // red's whole turn done; yellow is asked
  return { store, game, sent, notifier, start, afterRed, tick: (ms: number) => (clock += ms) }
}

describe('Notifier', () => {
  it('pings the next human by name with their seat link', async () => {
    const { game, sent, notifier, start, afterRed } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe(HOOK)
    expect(sent[0]!.content).toContain('**Sam**')
    expect(sent[0]!.content).toContain(seatLink('https://arcs.test', game.gameId, game.seats[1]!.seatToken))
  })

  it('falls back to the faction when no name is set and says nothing without a webhook', async () => {
    const a = await setup()
    // Only yellow is named. Going "backwards" from afterRed to start makes red the asked faction.
    await a.notifier.onSettled({ gameId: a.game.gameId, before: a.afterRed, after: a.start })
    expect(a.sent[0]!.content).toContain('**red**')
    const b = await setup(false)
    await b.notifier.onSettled({ gameId: b.game.gameId, before: b.start, after: b.afterRed })
    expect(b.sent).toHaveLength(0)
  })

  it('sends at most one ping per window and records the journal length', async () => {
    const { store, game, sent, notifier, start, afterRed, tick } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(store.meta(game.gameId)?.lastNotifiedLength).toBe(RED_OPENING.length)
    // The turn passes to red inside the window: skipped. (`after` is a longer journal so the
    // "already notified at this length" guard does not hide the window check.)
    const later = { ...start, state: { ...start.state, journal: [...RED_OPENING, 'x'] } }
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: later })
    expect(sent).toHaveLength(1)
    tick(60_001)
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: later })
    expect(sent).toHaveLength(2)
  })

  it('does not ping again while the same player is still being asked mid-turn', async () => {
    const { game, sent, notifier, start, tick } = await setup()
    const oneIn = replayGame(THREE_PLAYER, RED_OPENING.slice(0, 1)) // red led; red is asked again
    tick(120_000)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: oneIn })
    expect(sent).toHaveLength(0)
  })

  it('does not re-ping the same journal position after a restart', async () => {
    const { store, game, sent, notifier, start, afterRed, tick } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    tick(120_000)
    // resumeAll reports before: null for the same position — nothing new happened.
    await notifier.onSettled({ gameId: game.gameId, before: null, after: afterRed })
    expect(sent).toHaveLength(1)
    expect(store.meta(game.gameId)?.lastNotifiedLength).toBe(RED_OPENING.length)
  })

  it('announces a chapter change and game over regardless of the window', async () => {
    const { game, sent, notifier, start, afterRed } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    const nextChapter: RuleResult = {
      ...afterRed,
      state: { ...afterRed.state, chapter: afterRed.state.chapter + 1, journal: [...RED_OPENING, 'x'] },
    }
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: nextChapter })
    expect(sent).toHaveLength(2)
    expect(sent[1]!.content).toMatch(/Chapter 2/)
    const over: RuleResult = {
      state: { ...nextChapter.state, isOver: true, winners: ['yellow'], journal: [...RED_OPENING, 'x', 'y'] },
      continue: { kind: 'gameOver', winners: ['yellow'], reason: 'test' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: nextChapter, after: over })
    expect(sent).toHaveLength(3)
    expect(sent[2]!.content).toContain('Sam')
    expect(sent[2]!.content).toMatch(/wins/i)
  })

  it('swallows a failing webhook', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, { webhookUrl: HOOK })
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      post: async () => {
        throw new Error('boom')
      },
    })
    await expect(
      notifier.onSettled({ gameId: game.gameId, before: startGame(THREE_PLAYER), after: replayGame(THREE_PLAYER, RED_OPENING) }),
    ).resolves.toBeUndefined()
  })
})
