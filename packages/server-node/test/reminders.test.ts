import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { replayGame, startGame } from '@arcs/engine'
import { MAX_REMINDERS, Notifier } from '../src/notify.js'
import { Presence } from '../src/presence.js'
import { nextSlotAfter, parseDailyTime } from '../src/reminder-time.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { RED_OPENING, THREE_PLAYER, tempDbPath } from './fixtures.js'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

const TZ = 'America/Phoenix' // UTC-7 all year, so 16:30 there is 23:30Z
const TIME = parseDailyTime('16:30')!
const HOUR = 3_600_000
/** The last move, 13:00 Phoenix on a Saturday. */
const MOVED = Date.parse('2026-10-10T20:00:00Z')
const YELLOW_ID = '111222333444555666'

interface Sent {
  content: string
  mentions: readonly string[]
}

function channel(sent: Sent[]) {
  const bot = {
    postMessage: async (_c: string, m: Sent) => void sent.push(m),
  } as unknown as import('../src/discord.js').DiscordBot
  return { channelId: 'chan', bot }
}

async function setup({ reminder = true, discord = true }: { reminder?: boolean; discord?: boolean } = {}) {
  const path = tempDbPath()
  const store = new SqliteStore(path)
  const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
  const yellow = game.seats[1]!
  store.setName(game.gameId, yellow.seatToken, 'Sam', discord ? { id: YELLOW_ID } : undefined)
  const sent: Sent[] = []
  let clock = MOVED
  const notifier = new Notifier(store, {
    publicOrigin: 'https://arcs.test',
    fallbackChannel: channel(sent),
    now: () => clock,
    ...(reminder ? { reminder: { time: TIME, tz: TZ } } : {}),
  })
  // Journal reaches RED_OPENING's length; the store's own clock is then pinned to MOVED.
  for (let i = 0; i < RED_OPENING.length; i += 1) {
    await store.append(game.gameId, game.seats[0]!.seatToken, i, `filler${i}`)
  }
  const pin = (at: number): void => {
    const raw = new DatabaseSync(path)
    raw.prepare('UPDATE game SET updated_at = ? WHERE id = ?').run(at, game.gameId)
    raw.close()
  }
  pin(MOVED)
  const start = startGame(THREE_PLAYER)
  const afterRed = replayGame(THREE_PLAYER, RED_OPENING) // yellow is asked
  await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
  sent.length = 0 // forget the turn ping itself
  return { path, store, game, sent, notifier, afterRed, pin, at: (iso: string) => (clock = Date.parse(iso)), set: (ms: number) => (clock = ms) }
}

describe('daily stall reminder', () => {
  it('stays quiet until 24 h have passed and then waits for 16:30 Phoenix', async () => {
    const t = await setup()
    t.set(MOVED + 23 * HOUR)
    await t.notifier.sweep()
    t.at('2026-10-11T20:00:00Z') // exactly 24 h, but 13:00 local
    await t.notifier.sweep()
    t.at('2026-10-11T23:29:59Z')
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(0)
    t.at('2026-10-11T23:30:00Z')
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]!.content).toBe(
      `<@${YELLOW_ID}> still your turn in Arcs — 1 day since the last move: https://arcs.test/#/g/${t.game.gameId}`,
    )
    expect(t.sent[0]!.mentions).toEqual([YELLOW_ID])
    // Same slot, further sweeps: nothing more.
    t.at('2026-10-11T23:31:00Z')
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(1)
  })

  it('repeats at 16:30 each following day and stops after seven', async () => {
    const t = await setup()
    for (let day = 1; day <= 12; day += 1) {
      t.set(Date.parse('2026-10-10T23:30:00Z') + day * 24 * HOUR)
      await t.notifier.sweep()
      await t.notifier.sweep()
    }
    expect(t.sent).toHaveLength(MAX_REMINDERS)
    expect(t.sent[1]!.content).toContain('2 days since the last move')
    expect(t.sent[6]!.content).toContain('7 days since the last move')
  })

  it('after days of downtime, waits for the next 16:30 and sends one message, not a backlog', async () => {
    const t = await setup()
    t.at('2026-10-15T01:00:00Z') // 18:00 local: past today's slot window
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(0)
    t.at('2026-10-15T23:30:00Z')
    await t.notifier.sweep()
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]!.content).toContain('5 days since the last move')
    t.at('2026-10-16T23:45:00Z') // still inside the hour after the slot
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(2)
  })

  it('starts over after a move', async () => {
    const t = await setup()
    t.at('2026-10-11T23:30:00Z')
    await t.notifier.sweep()
    t.at('2026-10-12T23:30:00Z')
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(2)
    expect(t.store.reminder(t.game.gameId)!.count).toBe(2)

    // Someone moves (yellow is asked again at a longer journal): the count resets and the 24 h clock restarts.
    const movedAt = Date.parse('2026-10-13T02:00:00Z') // 19:00 Phoenix
    await t.store.append(t.game.gameId, t.game.seats[0]!.seatToken, RED_OPENING.length, 'filler-next')
    t.pin(movedAt)
    const later = { ...t.afterRed, state: { ...t.afterRed.state, journal: [...RED_OPENING, 'x'] } }
    t.set(movedAt)
    await t.notifier.onSettled({ gameId: t.game.gameId, before: t.afterRed, after: later })
    expect(t.store.reminder(t.game.gameId)!.count).toBe(0)
    t.sent.length = 0
    t.at('2026-10-13T23:30:00Z') // only 21.5 h since the move
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(0)
    t.at('2026-10-14T23:30:00Z')
    await t.notifier.sweep()
    expect(t.sent).toHaveLength(1)
  })

  it('honours the seat toggle, REMINDER_TIME=off, bots and finished games', async () => {
    const off = await setup({ reminder: false })
    off.at('2026-10-12T23:30:00Z')
    await off.notifier.sweep()
    expect(off.sent).toHaveLength(0)

    const muted = await setup()
    muted.store.setPings(muted.game.gameId, muted.game.seats[1]!.seatToken, false)
    muted.at('2026-10-12T23:30:00Z')
    await muted.notifier.sweep()
    expect(muted.sent).toHaveLength(0)

    // A bot being asked is never waited on, and neither is a finished game.
    const over = await setup()
    const finished = { ...over.afterRed, state: { ...over.afterRed.state, isOver: true, winners: ['red'] as never } }
    await over.notifier.onSettled({ gameId: over.game.gameId, before: over.afterRed, after: finished })
    expect(over.store.reminder(over.game.gameId)).toBeUndefined()
    over.at('2026-10-12T23:30:00Z')
    await over.notifier.sweep()
    expect(over.sent).toHaveLength(0)
  })

  it('names a seat with no Discord link in bold, like the turn ping', async () => {
    const t = await setup({ discord: false })
    t.at('2026-10-11T23:30:00Z')
    await t.notifier.sweep()
    expect(t.sent[0]!.content).toMatch(/^\*\*Sam\*\* still your turn in Arcs/)
    expect(t.sent[0]!.mentions).toEqual([])
  })
})

describe('durable pending pings', () => {
  it('a held ping survives a fresh Notifier over the same database', async () => {
    const path = tempDbPath()
    const store = new SqliteStore(path)
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const yellow = game.seats[1]!
    store.setName(game.gameId, yellow.seatToken, 'Sam')
    for (let i = 0; i < RED_OPENING.length; i += 1) await store.append(game.gameId, game.seats[0]!.seatToken, i, `f${i}`)
    let clock = 1_000_000
    const presence = new Presence({ now: () => clock, activeMs: 120_000 })
    presence.connect(game.gameId, yellow.seatToken, { readyState: 1, OPEN: 1, send() {} })
    const sent: Sent[] = []
    const make = (s: SqliteStore, p?: Presence) =>
      new Notifier(s, {
        publicOrigin: 'https://arcs.test',
        fallbackChannel: channel(sent),
        now: () => clock,
        graceMs: 600_000,
        ...(p === undefined ? {} : { presence: p }),
      })
    await make(store, presence).onSettled({
      gameId: game.gameId,
      before: startGame(THREE_PLAYER),
      after: replayGame(THREE_PLAYER, RED_OPENING),
    })
    expect(sent).toHaveLength(0)
    store.close()

    // "Deploy": new store, new notifier. The ping is still owed; before it is due nothing goes out.
    const reopened = new SqliteStore(path)
    const fresh = make(reopened)
    clock += 599_000
    await fresh.sweep()
    expect(sent).toHaveLength(0)
    clock += 2_000
    await fresh.sweep()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.content).toContain('**Sam**')
    // Delivered once; the row is gone.
    await fresh.sweep()
    expect(sent).toHaveLength(1)
    expect(reopened.pendingPing(game.gameId)).toBeUndefined()
  })

  it('a restart re-settling the same position keeps the held ping', async () => {
    const path = tempDbPath()
    const store = new SqliteStore(path)
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    for (let i = 0; i < RED_OPENING.length; i += 1) await store.append(game.gameId, game.seats[0]!.seatToken, i, `f${i}`)
    store.setPendingPing({
      gameId: game.gameId,
      seatToken: game.seats[1]!.seatToken,
      journalLength: RED_OPENING.length,
      chapter: 1,
      dueAt: 5,
    })
    store.markNotified(game.gameId, RED_OPENING.length - 1, 0)
    const sent: Sent[] = []
    const n = new Notifier(store, { publicOrigin: 'https://arcs.test', fallbackChannel: channel(sent), now: () => 1_000_000 })
    await n.onSettled({ gameId: game.gameId, before: null, after: replayGame(THREE_PLAYER, RED_OPENING) })
    expect(store.pendingPing(game.gameId)).toBeDefined()
  })
})

describe('nextSlotAfter', () => {
  it('finds 16:30 Phoenix and follows DST in zones that have it', () => {
    expect(new Date(nextSlotAfter(Date.parse('2026-10-11T23:30:00Z'), TIME, TZ)).toISOString()).toBe('2026-10-12T23:30:00.000Z')
    expect(new Date(nextSlotAfter(Date.parse('2026-10-11T00:00:00Z'), TIME, TZ)).toISOString()).toBe('2026-10-11T23:30:00.000Z')
    const ny = 'America/New_York' // clocks go back on 2026-11-01
    expect(new Date(nextSlotAfter(Date.parse('2026-10-31T21:00:00Z'), TIME, ny)).toISOString()).toBe('2026-11-01T21:30:00.000Z')
    expect(new Date(nextSlotAfter(Date.parse('2026-10-31T00:00:00Z'), TIME, ny)).toISOString()).toBe('2026-10-31T20:30:00.000Z')
  })

  it('parses HH:MM and rejects junk', () => {
    expect(parseDailyTime('9:05')).toEqual({ hour: 9, minute: 5 })
    expect(parseDailyTime('24:00')).toBeUndefined()
    expect(parseDailyTime('noon')).toBeUndefined()
  })
})
