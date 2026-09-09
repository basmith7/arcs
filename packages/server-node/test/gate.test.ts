import { describe, expect, it } from 'vitest'

import { replayGame } from '@arcs/engine'
import type { RuleResult } from '@arcs/engine'
import { EngineGate, askedFactions } from '../src/gate.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { ONE_HUMAN, RED_FIRST_LEAD, RED_OPENING, THREE_PLAYER, playOpening, tempDbPath } from './fixtures.js'

/**
 * A `RuleResult` carries `Map`-backed trackers (`resources`, `cards`, `courtCards`, `figures`)
 * whose location rules are closures allocated fresh by `tracker.ts` on every call — even two
 * independent `replayGame` calls on the same journal never produce reference-equal closures, so a
 * raw `toEqual` (or a `JSON.parse(JSON.stringify(...))` snapshot, which silently serialises every
 * `Map` to `{}` and would compare nothing) can't be used here. Compare the fields that actually
 * describe game progress instead.
 */
function sameProgress(a: RuleResult | undefined, b: RuleResult): void {
  expect(a?.state.journal).toEqual(b.state.journal)
  expect(a?.state.chapter).toEqual(b.state.chapter)
  expect(a?.state.isOver).toEqual(b.state.isOver)
  expect(a?.state.winners).toEqual(b.state.winners)
  expect(a?.continue.kind).toEqual(b.continue.kind)
}

async function table(options = THREE_PLAYER, path = ':memory:', pace = 0) {
  const store = new SqliteStore(path)
  const settled: { before: number; after: number }[] = []
  const gate = new EngineGate(store, {
    pace,
    onSettled: (s) => settled.push({ before: s.before?.state.journal.length ?? -1, after: s.after.state.journal.length }),
  })
  const game = await store.create(options, options.factions, { bots: options.bots ?? [] })
  const seat = (faction: string) => game.seats.find((s) => s.faction === faction)!.seatToken
  return { store, gate, game, seat, settled }
}

describe('EngineGate turn check', () => {
  it('accepts the acting faction and refuses everyone else', async () => {
    const { gate, game, seat } = await table()
    expect(gate.askedFaction(game.gameId)).toBe('red')
    const yellowLead = RED_FIRST_LEAD.replace('faction="red"', 'faction="yellow"')
    expect(await gate.append(game.gameId, seat('yellow'), 0, yellowLead)).toEqual({ ok: false, reason: 'wrong-turn' })
    expect(await gate.append(game.gameId, seat('red'), 0, RED_FIRST_LEAD)).toEqual({ ok: true, length: 1 })
    expect(gate.resultOf(game.gameId)?.state.journal).toEqual([RED_FIRST_LEAD])
  })

  it('still reports store failures unchanged', async () => {
    const { gate, game, seat } = await table()
    expect(await gate.append(game.gameId, 'bogus', 0, RED_FIRST_LEAD)).toEqual({ ok: false, reason: 'bad-seat' })
    expect(await gate.append(game.gameId, seat('red'), 3, RED_FIRST_LEAD)).toEqual({ ok: false, reason: 'conflict', length: 0 })
    expect(await gate.append('nope', seat('red'), 0, RED_FIRST_LEAD)).toEqual({ ok: false, reason: 'no-such-game' })
  })

  it('refuses an action the engine cannot decode without touching the journal', async () => {
    const { gate, game, seat, store } = await table()
    const r = await gate.append(game.gameId, seat('red'), 0, 'garbage(faction="red")')
    expect(r.ok).toBe(false)
    expect(store.journal(game.gameId)).toEqual([])
  })
})

describe('EngineGate bots', () => {
  it('plays the bot seats after the human turn until a human is asked again', async () => {
    const { gate, game, seat, store, settled } = await table(ONE_HUMAN)
    const pushes: number[] = []
    gate.subscribe(game.gameId, (p) => pushes.push(p.from))
    await playOpening(gate, game.gameId, seat('red'))
    // append() returns before the bots have played; the journal is exactly red's opening now.
    expect(store.journal(game.gameId)).toEqual(RED_OPENING)
    await gate.settled(game.gameId)
    const journal = store.journal(game.gameId)
    expect(journal.length).toBeGreaterThan(RED_OPENING.length)
    expect(gate.askedFaction(game.gameId)).toBe('red')
    // Every entry was pushed exactly once, in order.
    expect(pushes).toEqual(journal.map((_, i) => i))
    // Bot entries carry the bot's faction, so a replay on any client agrees.
    expect(journal.slice(RED_OPENING.length).every((e) => /faction="(yellow|blue)"/.test(e))).toBe(true)
    // What the gate holds equals a fresh replay of what the store holds.
    sameProgress(gate.resultOf(game.gameId), replayGame(ONE_HUMAN, journal))
    // onSettled fired once per human append; only the last one had bots to run.
    expect(settled).toHaveLength(RED_OPENING.length)
    expect(settled.at(-1)).toEqual({ before: RED_OPENING.length - 1, after: journal.length })
  })

  it('accepts every asked faction of a multiAsk', () => {
    // Nothing in the fixtures reaches a multiAsk; pin the helper's contract directly.
    const base = replayGame(THREE_PLAYER, RED_OPENING)
    const multi = { ...base, continue: { kind: 'multiAsk' as const, asks: [{ faction: 'blue', actions: [] }, { faction: 'yellow', actions: [] }] } }
    expect(askedFactions(multi as never)).toEqual(['blue', 'yellow'])
    expect(askedFactions(base)).toEqual(['yellow'])
  })

  it('resumes a game whose next ask is a bot when the server starts', async () => {
    const path = tempDbPath()
    const store = new SqliteStore(path)
    const game = await store.create(ONE_HUMAN, ONE_HUMAN.factions, { bots: ['yellow', 'blue'] })
    const red = game.seats[0]!.seatToken
    // Bare store: the human plays a whole turn, no gate runs the bots. This is the
    // "crashed before the bots moved" state.
    await playOpening(store, game.gameId, red)
    store.close()

    const reopened = new SqliteStore(path)
    const gate = new EngineGate(reopened, { pace: 0 })
    await gate.resumeAll()
    await gate.settled(game.gameId)
    expect(reopened.journal(game.gameId).length).toBeGreaterThan(RED_OPENING.length)
    expect(gate.askedFaction(game.gameId)).toBe('red')
    reopened.close()
  })

  it('serialises a human append that arrives while bots are running', async () => {
    const { gate, game, seat, store } = await table(ONE_HUMAN, ':memory:', 5)
    await playOpening(gate, game.gameId, seat('red'))
    // Bots are mid-run (pace 5 ms). A stale human append must lose cleanly, not corrupt.
    const r = await gate.append(game.gameId, seat('red'), RED_OPENING.length, RED_FIRST_LEAD)
    expect(r.ok).toBe(false)
    await gate.settled(game.gameId)
    sameProgress(gate.resultOf(game.gameId), replayGame(ONE_HUMAN, store.journal(game.gameId)))
  })
})
