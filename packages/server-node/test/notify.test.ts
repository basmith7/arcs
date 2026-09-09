import { afterEach, describe, expect, it, vi } from 'vitest'

import { replayGame, startGame } from '@arcs/engine'
import type { RuleResult } from '@arcs/engine'
import { Notifier, postToDiscord, seatLink } from '../src/notify.js'
import { Presence } from '../src/presence.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { RED_OPENING, THREE_PLAYER } from './fixtures.js'

const HOOK = 'https://discord.test/hook'

interface FakeSchedule {
  fire(): void
  cancelled: boolean
}

async function setup(includeWebhook = true) {
  const store = new SqliteStore(':memory:')
  const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, includeWebhook ? { webhookUrl: HOOK } : {})
  store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam')
  const sent: { url: string; content: string; mentions: readonly string[] }[] = []
  let clock = 1_000_000
  const presence = new Presence({ now: () => clock, activeMs: 120_000 })
  const scheduled: { fn: () => void; ms: number; cancel: FakeSchedule }[] = []
  const schedule = (fn: () => void, ms: number): { cancel(): void } => {
    const handle: FakeSchedule = {
      cancelled: false,
      fire() {
        if (!this.cancelled) fn()
      },
    }
    scheduled.push({ fn, ms, cancel: handle })
    return {
      cancel: () => {
        handle.cancelled = true
      },
    }
  }
  const notifier = new Notifier(store, {
    publicOrigin: 'https://arcs.test',
    post: async (url, message) => {
      sent.push({ url, content: message.content, mentions: message.mentions })
    },
    now: () => clock,
    windowMs: 60_000,
    presence,
    graceMs: 600_000,
    leaveGraceMs: 60_000,
    schedule,
  })
  const start = startGame(THREE_PLAYER) // red is asked
  const afterRed = replayGame(THREE_PLAYER, RED_OPENING) // red's whole turn done; yellow is asked
  // Fires the most recently scheduled timer that has not been cancelled.
  const fireLatest = (): void => {
    for (let i = scheduled.length - 1; i >= 0; i -= 1) {
      const entry = scheduled[i]!
      if (!entry.cancel.cancelled) {
        entry.fn()
        return
      }
    }
  }
  // The notify tests build RuleResults straight from the engine and never append to the store's
  // own journal, so `checkPending`'s `store.journalLength` comparison needs the store's journal to
  // actually reach the length a test is pretending happened. Filler actions carry no faction (no
  // parens), so `actorOf` reads them as unattributed and `append` accepts them from any seat.
  const growJournal = async (n: number): Promise<void> => {
    let length = store.journalLength(game.gameId)
    while (length < n) {
      const result = await store.append(game.gameId, game.seats[0]!.seatToken, length, `filler${length}`)
      if (!result.ok) throw new Error(`growJournal failed: ${JSON.stringify(result)}`)
      length = result.length
    }
  }

  return {
    store,
    game,
    sent,
    notifier,
    start,
    afterRed,
    presence,
    scheduled,
    fireLatest,
    growJournal,
    tick: (ms: number) => (clock += ms),
  }
}

const OPEN = 1
function fakeSocket() {
  return {
    readyState: OPEN,
    OPEN,
    sent: [] as unknown[],
    send(data: string) {
      this.sent.push(JSON.parse(data))
    },
  }
}

describe('postToDiscord', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('suppresses @everyone/@here and role mentions, only allowing the listed users', async () => {
    let capturedBody: string | undefined
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    await postToDiscord('https://discord.test/hook', { content: 'hello @everyone', mentions: ['123'] })
    const parsed = JSON.parse(capturedBody!) as { allowed_mentions?: { parse: string[]; users: string[] } }
    expect(parsed.allowed_mentions?.parse).toEqual([])
    expect(parsed.allowed_mentions?.users).toEqual(['123'])
  })
})

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

  it('tags a linked player with <@id> and lists their id in mentions; untagged pings mention nothing', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, { webhookUrl: HOOK })
    store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam', { id: '111222333444555666' })
    const sent: { content: string; mentions: readonly string[] }[] = []
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      post: async (_url, message) => {
        sent.push({ content: message.content, mentions: message.mentions })
      },
      windowMs: 60_000,
    })
    const start = startGame(THREE_PLAYER)
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent[0]!.content).toContain('<@111222333444555666>')
    expect(sent[0]!.content).toContain('**Sam**')
    expect(sent[0]!.mentions).toEqual(['111222333444555666'])

    // red (untagged, no discord link) mentions nothing on their own ping.
    const store2 = new SqliteStore(':memory:')
    const game2 = await store2.create(THREE_PLAYER, THREE_PLAYER.factions, { webhookUrl: HOOK })
    const sent2: { content: string; mentions: readonly string[] }[] = []
    const notifier2 = new Notifier(store2, {
      publicOrigin: 'https://arcs.test',
      post: async (_url, message) => {
        sent2.push({ content: message.content, mentions: message.mentions })
      },
    })
    await notifier2.onSettled({ gameId: game2.gameId, before: afterRed, after: start })
    expect(sent2[0]!.mentions).toEqual([])
  })

  it('tags a linked winner in the game-over message', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions, { webhookUrl: HOOK })
    store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam', { id: '111222333444555666' })
    const sent: { content: string; mentions: readonly string[] }[] = []
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      post: async (_url, message) => {
        sent.push({ content: message.content, mentions: message.mentions })
      },
    })
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    const over: RuleResult = {
      state: { ...afterRed.state, isOver: true, winners: ['yellow'], journal: [...RED_OPENING, 'x'] },
      continue: { kind: 'gameOver', winners: ['yellow'], reason: 'test' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: over })
    expect(sent[0]!.content).toContain('<@111222333444555666>')
    expect(sent[0]!.mentions).toEqual(['111222333444555666'])
  })

  it('posts to a fallback channel when there is no webhook, and nothing when there is neither', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const posted: { channelId: string; content: string; mentions: readonly string[] }[] = []
    const fakeBot = {
      postMessage: async (channelId: string, message: { content: string; mentions: readonly string[] }) => {
        posted.push({ channelId, content: message.content, mentions: message.mentions })
      },
    } as unknown as import('../src/discord.js').DiscordBot
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      fallbackChannel: { channelId: 'chan-1', bot: fakeBot },
    })
    const start = startGame(THREE_PLAYER)
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(posted).toHaveLength(1)
    expect(posted[0]!.channelId).toBe('chan-1')

    const store2 = new SqliteStore(':memory:')
    const game2 = await store2.create(THREE_PLAYER, THREE_PLAYER.factions)
    const notifier2 = new Notifier(store2, { publicOrigin: 'https://arcs.test' })
    const sentNone: unknown[] = []
    await notifier2.onSettled({ gameId: game2.gameId, before: start, after: afterRed })
    expect(sentNone).toHaveLength(0)
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

  it('an active player gets a socket push and no immediate post; the grace timer posts if idle', async () => {
    const { game, sent, notifier, start, afterRed, presence, fireLatest, growJournal } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent).toHaveLength(0)
    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0]).toMatchObject({ turn: { faction: 'yellow', length: RED_OPENING.length } })
    fireLatest()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.content).toContain('**Sam**')
  })

  it('cancels the grace timer when the active player acts before it fires', async () => {
    const { game, sent, notifier, start, afterRed, presence, fireLatest, growJournal } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    const later = { ...afterRed, state: { ...afterRed.state, journal: [...RED_OPENING, 'x'] } }
    await growJournal(RED_OPENING.length + 1)
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: later })
    fireLatest()
    expect(sent).toHaveLength(0)
  })

  it('setPings(false) suppresses the post but the turn payload still reaches the socket', async () => {
    const { store, game, sent, notifier, start, afterRed, presence, fireLatest, growJournal } = await setup()
    const yellowSeat = game.seats[1]!
    store.setPings(game.gameId, yellowSeat.seatToken, false)
    const socket = fakeSocket()
    const unregister = presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(socket.sent).toHaveLength(1)
    fireLatest()
    expect(sent).toHaveLength(0)

    // Absent (not active) player with pings off: still nothing.
    unregister()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent).toHaveLength(0)
  })

  it('reschedules for leaveGraceMs when the active player leaves, and posts when that fires', async () => {
    const { game, sent, notifier, start, afterRed, presence, fireLatest, growJournal } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    const unregister = presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    unregister()
    fireLatest()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.content).toContain('**Sam**')
  })

  it('posts immediately for an active winner on game over, ignoring presence', async () => {
    const { game, sent, notifier, afterRed, presence } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    presence.connect(game.gameId, yellowSeat.seatToken, socket)
    const over: RuleResult = {
      state: { ...afterRed.state, isOver: true, winners: ['yellow'], journal: [...RED_OPENING, 'x'] },
      continue: { kind: 'gameOver', winners: ['yellow'], reason: 'test' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: over })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.content).toMatch(/wins/i)
  })
})
