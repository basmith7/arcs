import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { EngineGate } from '../src/gate.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { WorkerThinker, localThink } from '../src/thinker.js'
import type { Think } from '../src/thinker.js'
import { ONE_HUMAN, playOpening } from './fixtures.js'

/** Play red's opening, let the bots answer, and return the journal. */
async function botsAnswer(think?: Think): Promise<string[]> {
  const store = new SqliteStore(':memory:')
  const gate = new EngineGate(store, { pace: 0, ...(think === undefined ? {} : { think }) })
  const game = await store.create(ONE_HUMAN, ONE_HUMAN.factions, { bots: ['yellow', 'blue'] })
  await playOpening(gate, game.gameId, game.seats.find((s) => s.faction === 'red')!.seatToken)
  await gate.settled(game.gameId)
  return [...store.journal(game.gameId)]
}

let dir: string
let workerUrl: URL
const thinkers: WorkerThinker[] = []

beforeAll(async () => {
  // The production worker is a separate esbuild entry; build it the same way.
  dir = mkdtempSync(join(tmpdir(), 'arcs-worker-'))
  await build({
    entryPoints: [join(import.meta.dirname, '../src/bot-worker.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: join(dir, 'bot-worker.js'),
    logLevel: 'silent',
  })
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
  workerUrl = pathToFileURL(join(dir, 'bot-worker.js'))
}, 60_000)

afterAll(async () => {
  await Promise.all(thinkers.map((t) => t.close()))
})

describe('bot thinking off the main thread', () => {
  it('the gate plays the same journal through an injected think as in-process', async () => {
    let calls = 0
    const local = localThink()
    const counted: Think = (req) => {
      calls++
      return local(req)
    }
    expect(await botsAnswer(counted)).toEqual(await botsAnswer())
    expect(calls).toBeGreaterThan(0)
  })

  it('keeps the event loop free while a bot thinks', async () => {
    let ticks = 0
    const timer = setInterval(() => ticks++, 1)
    const slow: Think = async (req) => {
      await new Promise((r) => setTimeout(r, 20))
      return localThink()(req)
    }
    await botsAnswer(slow)
    clearInterval(timer)
    expect(ticks).toBeGreaterThan(5)
  })

  it('a worker thread plays the same journal', async () => {
    const t = new WorkerThinker(workerUrl, localThink())
    thinkers.push(t)
    expect(await botsAnswer(t.think)).toEqual(await botsAnswer())
    expect(t.stats().worker).toBeGreaterThan(0)
    expect(t.stats().fallback).toBe(0)
  }, 60_000)

  it('a bot that throws rejects the think instead of hanging, and the game stays playable', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boom: Think = () => Promise.reject(new Error('engine bug'))
    const t = new WorkerThinker(pathToFileURL(join(dir, 'missing.js')), () => {
      throw new Error('engine bug, in-process too')
    })
    thinkers.push(t)
    await expect(t.think({} as never)).rejects.toThrow('engine bug, in-process too')

    const store = new SqliteStore(':memory:')
    const gate = new EngineGate(store, { pace: 0, think: boom })
    const game = await store.create(ONE_HUMAN, ONE_HUMAN.factions, { bots: ['yellow', 'blue'] })
    const red = game.seats.find((s) => s.faction === 'red')!.seatToken
    await playOpening(gate, game.gameId, red)
    // The failed bot run must release the game's queue, not hold it forever.
    await gate.settled(game.gameId)
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
    warns.mockRestore()
  }, 60_000)

  it('falls back to thinking in-process when the worker cannot start', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = new WorkerThinker(pathToFileURL(join(dir, 'missing.js')), localThink())
    thinkers.push(t)
    expect(await botsAnswer(t.think)).toEqual(await botsAnswer())
    expect(t.stats().fallback).toBeGreaterThan(1)
    // Said once, not once per decision.
    expect(errors).toHaveBeenCalledTimes(1)
    expect(warns).not.toHaveBeenCalled()
    errors.mockRestore()
    warns.mockRestore()
  }, 60_000)
})
