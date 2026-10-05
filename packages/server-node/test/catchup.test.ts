/**
 * The catch-up writer (spec 2026-10-04-scoreboard-catchup-design.md): on a hand-off to a human
 * seat, DeepSeek writes a story and a second call checks it; a passing story is stored for that
 * seat and pushed down its socket. DeepSeek is faked; nothing here touches the network.
 */
import { replayGame, startGame } from '@arcs/engine'
import type { RuleResult } from '@arcs/engine'
import { describe, expect, it } from 'vitest'

import { CatchupWriter } from '../src/catchup.js'
import type { Chat } from '../src/deepseek.js'
import { Presence } from '../src/presence.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { ONE_HUMAN, RED_OPENING, THREE_PLAYER } from './fixtures.js'

const start = startGame(THREE_PLAYER) // red is asked
const afterRed = replayGame(THREE_PLAYER, RED_OPENING) // yellow is asked
const LEN = afterRed.state.journal.length

/** A Chat that answers from a script — writer and checker calls alike — and records each call. */
function scripted(...replies: (string | Error)[]): Chat & { calls: { model: string; user: string }[] } {
  const calls: { model: string; user: string }[] = []
  const chat = (async (model: string, _system: string, user: string) => {
    calls.push({ model, user })
    const r = replies.shift() ?? 'PASS'
    if (r instanceof Error) throw r
    return r
  }) as unknown as Chat & { calls: typeof calls }
  chat.calls = calls
  return chat
}

async function setup(chat: Chat | undefined, options = THREE_PLAYER, current: () => RuleResult | undefined = () => afterRed) {
  const store = new SqliteStore(':memory:')
  const game = await store.create(options, options.factions, { bots: options.bots ?? [] })
  const presence = new Presence()
  const pushed: unknown[] = []
  const yellow = store.seats(game.gameId).find((s) => s.faction === 'yellow')!
  presence.connect(game.gameId, yellow.seatToken, { send: (d) => pushed.push(JSON.parse(d)), readyState: 1, OPEN: 1 })
  const writer = new CatchupWriter(store, presence, {
    current,
    ...(chat === undefined ? {} : { chat }),
    writerModel: 'writer',
    checkerModel: 'checker',
    timeoutMs: 50,
  })
  const handOff = async (before: RuleResult | null = start, after: RuleResult = afterRed): Promise<void> => {
    writer.onSettled({ gameId: game.gameId, before, after })
    await writer.settled()
  }
  return { store, gameId: game.gameId, writer, pushed, handOff }
}

describe('CatchupWriter', () => {
  it('writes, checks, stores and pushes a story on a hand-off to a human', async () => {
    const chat = scripted('story', 'PASS')
    const t = await setup(chat)
    await t.handOff()
    expect(chat.calls.map((c) => c.model)).toEqual(['writer', 'checker'])
    expect(chat.calls[0]!.user).toContain('your hand — private to you')
    expect(t.store.getCatchup(t.gameId, 'yellow', LEN)).toBe('story')
    expect(t.pushed).toEqual([{ catchup: { length: LEN, story: 'story' } }])
  })

  it('rewrites once when the checker fails, and keeps the rewrite', async () => {
    const chat = scripted('first', 'FAIL: invented', 'second', 'PASS')
    const t = await setup(chat)
    await t.handOff()
    expect(chat.calls.map((c) => c.model)).toEqual(['writer', 'checker', 'writer', 'checker'])
    expect(t.store.getCatchup(t.gameId, 'yellow', LEN)).toBe('second')
  })

  it('keeps bullets only after a second failed check', async () => {
    const t = await setup(scripted('first', 'FAIL: x', 'second', 'FAIL: y'))
    await t.handOff()
    expect(t.store.getCatchup(t.gameId, 'yellow', LEN)).toBeUndefined()
    expect(t.pushed).toEqual([])
  })

  it('gives up quietly when a call times out', async () => {
    const hang: Chat = (_m, _s, _u, signal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    const t = await setup(hang)
    await t.handOff()
    expect(t.store.getCatchup(t.gameId, 'yellow', LEN)).toBeUndefined()
    expect(t.pushed).toEqual([])
  })

  it('writes nothing when the turn did not change hands', async () => {
    const chat = scripted()
    const t = await setup(chat)
    await t.handOff(afterRed, afterRed)
    expect(chat.calls).toEqual([])
  })

  it('writes nothing for a bot seat', async () => {
    const chat = scripted()
    const t = await setup(chat, ONE_HUMAN)
    await t.handOff()
    expect(chat.calls).toEqual([])
  })

  it('without a DeepSeek key, calls nothing and stores nothing', async () => {
    const t = await setup(undefined)
    await t.handOff()
    expect(t.store.getCatchup(t.gameId, 'yellow', LEN)).toBeUndefined()
  })

  it('drops a story when the game moved on while it was written', async () => {
    const moved = { ...afterRed, state: { ...afterRed.state, journal: [...afterRed.state.journal, 'x'] } }
    const t = await setup(scripted('story', 'PASS'), THREE_PLAYER, () => moved)
    await t.handOff()
    expect(t.store.getCatchup(t.gameId, 'yellow', LEN)).toBeUndefined()
    expect(t.pushed).toEqual([])
  })

  it("deletes the game's stories when it ends", async () => {
    const t = await setup(scripted())
    t.store.putCatchup(t.gameId, 'yellow', LEN, 'old', 0)
    await t.handOff(afterRed, { ...afterRed, state: { ...afterRed.state, isOver: true } })
    expect(t.store.getCatchup(t.gameId, 'yellow', LEN)).toBeUndefined()
  })

  it('never holds up the move that triggered it', async () => {
    const t = await setup(() => new Promise<string>(() => {}))
    let done = false
    t.writer.onSettled({ gameId: t.gameId, before: start, after: afterRed })
    void t.writer.settled().then(() => (done = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false) // still writing...
    expect(t.pushed).toEqual([]) // ...and onSettled returned long ago
  })
})
