/**
 * The end-of-turn confirmation: the turn's last move waits on this device for End turn, and Start
 * over takes the turn's sent moves back. Runs the store against the real server-node routes, like
 * take-back.test.ts, because Start over is a run of take-backs only that server answers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyExternal, decodeAction, defaultRegistry, encodeAction, startGame, takeBackBlock } from '@arcs/engine'
import type { Action, NewGameOptions } from '@arcs/engine'

import { EngineGate } from '../../../packages/server-node/src/gate.js'
import { route } from '../../../packages/server-node/src/api.js'
import { SqliteStore } from '../../../packages/server-node/src/sqlite-store.js'
import { setSettings } from '../src/settings.js'
import { store } from '../src/store.js'

const API = 'https://arcs.test'
const OPTIONS: NewGameOptions = { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 5 }

async function seated() {
  const db = new SqliteStore(':memory:')
  const api = { store: db, gate: new EngineGate(db, { pace: 0 }) }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await route(new Request(input as string, init), api)
    return res ?? new Response('not found', { status: 404 })
  })
  const game = await db.create(OPTIONS, OPTIONS.factions, { bots: [] })
  const red = game.seats.find((s) => s.faction === 'red')!.seatToken
  await store.joinSession(API, { gameId: game.gameId, seatToken: red })
  const journal = () => db.journal(game.gameId).map((e) => decodeAction(e).type)
  return { journal }
}

/** Red plays its turn — the first offered move each time — until the store holds the last one. */
async function playRedTurn(): Promise<number> {
  let sent = 0
  for (let i = 0; i < 40 && !store.endTurnPending(); i++) {
    const c = store.getSnapshot()!.continue
    if (c.kind !== 'ask' || c.faction !== 'red') throw new Error(`red was not asked: ${c.kind}`)
    const action = c.actions[0] as Action
    store.apply(action)
    if (!store.endTurnPending()) sent++
  }
  // Let the session's sends land.
  await new Promise((r) => setTimeout(r, 50))
  return sent
}

/**
 * A table played forward (every seat's first offered move) until red is offered a move that cannot
 * be taken back; red then joins. Found rather than written out, so it holds whatever the seed deals.
 */
async function seatedAtReveal(): Promise<{ journal: () => string[]; risky: Action }> {
  const registry = defaultRegistry()
  const db = new SqliteStore(':memory:')
  const gate = new EngineGate(db, { pace: 0 })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await route(new Request(input as string, init), { store: db, gate })
    return res ?? new Response('not found', { status: 404 })
  })
  const game = await db.create(OPTIONS, OPTIONS.factions, { bots: [] })
  const token = (f: string) => game.seats.find((s) => s.faction === f)!.seatToken
  let r = startGame(OPTIONS, registry)
  for (let i = 0; i < 500; i++) {
    const c = r.continue
    if (c.kind !== 'ask') break
    if (c.faction === 'red') {
      const risky = (c.actions as readonly Action[]).find((a) => {
        try {
          return takeBackBlock(r, applyExternal(r, a, registry), a) !== undefined
        } catch {
          return false
        }
      })
      if (risky !== undefined) {
        await store.joinSession(API, { gameId: game.gameId, seatToken: token('red') })
        return { journal: () => db.journal(game.gameId).map((e) => decodeAction(e).type), risky }
      }
    }
    const a = c.actions[0] as Action
    expect((await gate.append(game.gameId, token(c.faction), i, encodeAction(a))).ok).toBe(true)
    r = applyExternal(r, a, registry)
  }
  throw new Error('red was never offered a revealing move')
}

afterEach(() => {
  store.leaveSession()
  vi.unstubAllGlobals()
})

describe('end of turn', () => {
  it('holds the last move until End turn, then sends it', async () => {
    const { journal } = await seated()
    const sent = await playRedTurn()
    expect(store.endTurnPending()).toBe(true)
    expect(journal()).toHaveLength(sent)
    // The board shows the held move: someone else is being asked.
    const shown = store.getSnapshot()!.continue
    expect(shown.kind === 'ask' && shown.faction === 'red').toBe(false)

    store.endTurn()
    await new Promise((r) => setTimeout(r, 50))
    expect(store.endTurnPending()).toBe(false)
    expect(journal()).toHaveLength(sent + 1)
  })

  it('Undo drops only the held move; Start over takes the whole turn back', async () => {
    const { journal } = await seated()
    const sent = await playRedTurn()
    expect(sent).toBeGreaterThan(0)

    store.undo()
    expect(store.endTurnPending()).toBe(false)
    expect(store.getSnapshot()!.state.journal).toHaveLength(sent)

    await playRedTurn()
    const plan = store.startOverPlan()!
    expect(plan).toMatchObject({ to: 0, moves: sent, locked: [] })
    expect(plan.undone.length).toBeGreaterThan(0)
    store.startOver()
    expect(store.getSnapshot()!.state.journal).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 100))
    expect(journal()).toEqual([])
    expect(store.undoNote).toBeNull()
  })

  it('sends the held move by itself when the wait runs out', async () => {
    const { journal } = await seated()
    store.endTurnWaitMs = 300
    try {
      const sent = await playRedTurn()
      expect(store.endTurnAt()).not.toBeNull()
      expect(journal()).toHaveLength(sent)
      await new Promise((r) => setTimeout(r, 400))
      expect(store.endTurnPending()).toBe(false)
      expect(journal()).toHaveLength(sent + 1)
    } finally {
      store.endTurnWaitMs = 120_000
    }
  })

  it('asks before a move that cannot be taken back, and Cancel forgets it', async () => {
    const { journal, risky } = await seatedAtReveal()
    const before = journal().length
    const shown = store.getSnapshot()

    store.apply(risky)
    expect(store.riskyMove()).toEqual(expect.any(String))
    // Neither sent nor shown: its result is what it would reveal.
    expect(store.getSnapshot()).toBe(shown)
    store.undo()
    expect(store.riskyMove()).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(journal()).toHaveLength(before)

    store.apply(risky)
    store.confirmRisky()
    await new Promise((r) => setTimeout(r, 50))
    expect(store.riskyMove()).toBeNull()
    expect(store.endTurnPending()).toBe(false)
    expect(journal()).toHaveLength(before + 1)
  })

  it('sends a move its surface already warned about without asking', async () => {
    const { journal, risky } = await seatedAtReveal()
    const before = journal().length
    store.apply(risky, { warned: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(store.riskyMove()).toBeNull()
    expect(journal()).toHaveLength(before + 1)
  })

  it('sends at once with the setting off', async () => {
    setSettings({ confirmMoves: false })
    try {
      const { journal } = await seated()
      const before = journal().length
      const c = store.getSnapshot()!.continue
      if (c.kind !== 'ask') throw new Error('not asked')
      store.apply(c.actions[0] as Action)
      await new Promise((r) => setTimeout(r, 50))
      expect(store.endTurnPending()).toBe(false)
      expect(journal()).toHaveLength(before + 1)
    } finally {
      setSettings({ confirmMoves: true })
    }
  })
})
