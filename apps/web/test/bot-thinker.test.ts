/**
 * The paced bot thinks off the main thread (`bot-worker.ts`), so a slow `hard` decision no longer
 * freezes the tab. The store must land exactly the move `stepBotOnce` would, and must drop an
 * answer that arrives after the position moved on (an undo, a new game) instead of playing it into
 * a game it was not thought about.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createThinker } from '@arcs/engine'
import type { NewGameOptions, ThinkReply, ThinkRequest } from '@arcs/engine'

import { store } from '../src/store.js'

const OPTIONS: NewGameOptions = {
  board: 'Board3Frontiers',
  factions: ['red', 'yellow', 'blue'],
  seed: 3,
  bots: ['red', 'yellow', 'blue'],
}

const journal = (): string[] => (JSON.parse(store.toJSON()!) as { journal: string[] }).journal

/** A thinker whose answers the test releases by hand. */
function heldThinker() {
  const think = createThinker()
  const held: { req: ThinkRequest; release: () => void }[] = []
  return {
    held,
    think: (req: ThinkRequest) =>
      new Promise<ThinkReply>((resolve) => {
        held.push({ req, release: () => resolve(think(req)) })
      }),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  store.useThinker(undefined)
  vi.useRealTimers()
})

describe('paced bots think through the thinker', () => {
  it('lands the same move stepBotOnce would', async () => {
    store.start(OPTIONS)
    store.stepBotOnce()
    const direct = journal()

    const t = heldThinker()
    store.useThinker(t.think)
    store.start(OPTIONS)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(t.held).toHaveLength(1)
    expect(journal()).toEqual([])
    t.held[0]!.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(journal()).toEqual(direct)
  })

  it('drops an answer that arrives after an undo', async () => {
    const t = heldThinker()
    store.useThinker(t.think)
    store.start(OPTIONS)
    await vi.advanceTimersByTimeAsync(5_000)
    t.held[0]!.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(journal()).toHaveLength(1)

    // The second bot move is being thought about when the player undoes the first.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(t.held).toHaveLength(2)
    store.undo()
    t.held[1]!.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(journal()).toEqual([])
  })

  it('falls back to thinking in-process when the thinker fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.useThinker(() => Promise.reject(new Error('worker gone')))
    store.start(OPTIONS)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(journal().length).toBeGreaterThan(0)
  })
})
