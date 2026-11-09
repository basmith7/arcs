import { describe, expect, it } from 'vitest'

import { applyExternal, defaultRegistry, replayGame, startGame } from '@arcs/engine'
import type { RuleResult } from '@arcs/engine'
import { turnCard } from '../src/discord-cards.js'
import { Notifier, seatLink } from '../src/notify.js'
import type { NotifierOptions } from '../src/notify.js'
import { Presence } from '../src/presence.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { RED_OPENING, THREE_PLAYER } from './fixtures.js'

const CHANNEL = 'chan-1'

interface Sent {
  url: string
  /** Everything a reader sees: the content line, the embeds and the button's link. */
  text: string
  mentions: readonly string[]
}

type Posted = import('../src/discord.js').ChannelMessage
const textOf = (m: Posted): string => [m.content, JSON.stringify(m.embeds ?? []), m.link?.url ?? ''].join('\n')

/** A channel whose bot records posts into `sent`, or throws when `fail` says so. */
function channel(sent: Sent[], fail = false): NonNullable<NotifierOptions['fallbackChannel']> {
  const bot = {
    postMessage: async (channelId: string, message: Posted) => {
      if (fail) throw new Error('boom')
      sent.push({ url: channelId, text: textOf(message), mentions: message.mentions })
    },
  } as unknown as import('../src/discord.js').DiscordBot
  return { channelId: CHANNEL, bot }
}

async function setup(withChannel = true) {
  const store = new SqliteStore(':memory:')
  const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
  store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam')
  const sent: Sent[] = []
  let clock = 1_000_000
  const presence = new Presence({ now: () => clock, activeMs: 120_000 })
  const start = startGame(THREE_PLAYER) // red is asked
  const afterRed = replayGame(THREE_PLAYER, RED_OPENING) // red's whole turn done; yellow is asked
  const notifier = new Notifier(store, {
    publicOrigin: 'https://arcs.test',
    current: () => afterRed,
    ...(withChannel ? { fallbackChannel: channel(sent) } : {}),
    now: () => clock,
    windowMs: 60_000,
    presence,
    graceMs: 600_000,
    leaveGraceMs: 60_000,
  })
  // Advances the clock to the held ping's due time and sweeps.
  const fireLatest = async (): Promise<void> => {
    const due = store.pendingPing(game.gameId)?.dueAt
    if (due !== undefined) clock = Math.max(clock, due)
    await notifier.sweep()
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

describe('Notifier', () => {
  it('pings the next human by name with the game link, never a seat token', async () => {
    const { game, sent, notifier, start, afterRed } = await setup()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe(CHANNEL)
    expect(sent[0]!.text).toContain('**Sam**')
    // The channel is shared: anyone who clicks a seat link becomes that player, and the browser
    // remembers it over their own seat. Each browser recalls its own seat from the bare link.
    expect(sent[0]!.text).toContain(seatLink('https://arcs.test', game.gameId))
    for (const s of game.seats) expect(sent[0]!.text).not.toContain(s.seatToken)
  })

  it('falls back to the faction when no name is set and says nothing without a channel', async () => {
    const a = await setup()
    // Only yellow is named. Going "backwards" from afterRed to start makes red the asked faction.
    await a.notifier.onSettled({ gameId: a.game.gameId, before: a.afterRed, after: a.start })
    expect(a.sent[0]!.text).toContain('**Red**')
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
    expect(sent[1]!.text).toMatch(/Chapter 2/)
    const over: RuleResult = {
      state: { ...nextChapter.state, isOver: true, winners: ['yellow'], journal: [...RED_OPENING, 'x', 'y'] },
      continue: { kind: 'gameOver', winners: ['yellow'], reason: 'test' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: nextChapter, after: over })
    expect(sent).toHaveLength(3)
    expect(sent[2]!.text).toContain('Sam')
    expect(sent[2]!.text).toMatch(/wins/i)
  })

  it('tags a linked player with <@id> and lists their id in mentions; untagged pings mention nothing', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam', { id: '111222333444555666' })
    const sent: Sent[] = []
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: channel(sent),
      windowMs: 60_000,
    })
    const start = startGame(THREE_PLAYER)
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent[0]!.text).toContain('<@111222333444555666>')
    expect(sent[0]!.text).toContain('Your turn, Sam')
    expect(sent[0]!.mentions).toEqual(['111222333444555666'])

    // red (untagged, no discord link) mentions nothing on their own ping.
    const store2 = new SqliteStore(':memory:')
    const game2 = await store2.create(THREE_PLAYER, THREE_PLAYER.factions)
    const sent2: Sent[] = []
    const notifier2 = new Notifier(store2, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: channel(sent2),
    })
    await notifier2.onSettled({ gameId: game2.gameId, before: afterRed, after: start })
    expect(sent2[0]!.mentions).toEqual([])
  })

  it('tags a claimed seat with its account\'s Discord id, not the seat\'s own', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam', { id: '999888777666555444' })
    const account = store.upsertAccount({ discordId: '111222333444555666', discordName: 'sam', displayName: 'Sam' })
    store.claim(game.gameId, game.seats[1]!.seatToken, account.id, 'Sam')
    const sent: Sent[] = []
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: channel(sent),
      windowMs: 60_000,
    })
    const start = startGame(THREE_PLAYER)
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent[0]!.text).toContain('<@111222333444555666>')
    expect(sent[0]!.mentions).toEqual(['111222333444555666'])
  })

  it('tags a linked winner in the game-over message', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    store.setName(game.gameId, game.seats[1]!.seatToken, 'Sam', { id: '111222333444555666' })
    const sent: Sent[] = []
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: channel(sent),
    })
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    const over: RuleResult = {
      state: { ...afterRed.state, isOver: true, winners: ['yellow'], journal: [...RED_OPENING, 'x'] },
      continue: { kind: 'gameOver', winners: ['yellow'], reason: 'test' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: over })
    expect(sent[0]!.text).toContain('<@111222333444555666>')
    expect(sent[0]!.mentions).toEqual(['111222333444555666'])
  })

  it('posts to the channel, and nothing when there is none', async () => {
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
      current: () => undefined,
      fallbackChannel: { channelId: 'chan-1', bot: fakeBot },
    })
    const start = startGame(THREE_PLAYER)
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(posted).toHaveLength(1)
    expect(posted[0]!.channelId).toBe('chan-1')

    const store2 = new SqliteStore(':memory:')
    const game2 = await store2.create(THREE_PLAYER, THREE_PLAYER.factions)
    const notifier2 = new Notifier(store2, { publicOrigin: 'https://arcs.test', current: () => undefined })
    const sentNone: unknown[] = []
    await notifier2.onSettled({ gameId: game2.gameId, before: start, after: afterRed })
    expect(sentNone).toHaveLength(0)
  })

  it('swallows a failing post', async () => {
    const store = new SqliteStore(':memory:')
    const game = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: channel([], true),
    })
    await expect(
      notifier.onSettled({ gameId: game.gameId, before: startGame(THREE_PLAYER), after: replayGame(THREE_PLAYER, RED_OPENING) }),
    ).resolves.toBeUndefined()
  })

  it('an active player gets a socket push and no immediate post; the sweep posts if idle', async () => {
    const { game, sent, notifier, start, afterRed, presence, fireLatest, growJournal } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent).toHaveLength(0)
    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0]).toMatchObject({ turn: { faction: 'yellow', length: RED_OPENING.length } })
    await fireLatest()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('**Sam**')
  })

  it('drops the held ping when the active player acts before it fires', async () => {
    const { store, game, sent, notifier, start, afterRed, presence, fireLatest, growJournal } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    const later = { ...afterRed, state: { ...afterRed.state, journal: [...RED_OPENING, 'x'] } }
    await growJournal(RED_OPENING.length + 1)
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: later })
    expect(store.pendingPing(game.gameId)).toBeUndefined()
    await fireLatest()
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
    await fireLatest()
    expect(sent).toHaveLength(0)

    // Absent (not active) player with pings off: still nothing.
    unregister()
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(sent).toHaveLength(0)
  })

  it('reschedules for leaveGraceMs when the active player leaves, and posts when that fires', async () => {
    const { store, game, sent, notifier, start, afterRed, presence, fireLatest, growJournal } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    const unregister = presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    await notifier.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    expect(store.pendingPing(game.gameId)!.dueAt).toBe(1_000_000 + 600_000)
    unregister()
    expect(store.pendingPing(game.gameId)!.dueAt).toBe(1_000_000 + 60_000)
    await fireLatest()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('**Sam**')
  })

  it('suppresses a deferred turn ping when a chapter message already posted inside the rate window', async () => {
    const { store, game, sent, notifier, start, afterRed, presence, growJournal, tick } = await setup()
    const yellowSeat = game.seats[1]!
    const socket = fakeSocket()
    presence.connect(game.gameId, yellowSeat.seatToken, socket)
    await growJournal(RED_OPENING.length)
    const chapterEnd = { ...afterRed, state: { ...afterRed.state, chapter: start.state.chapter + 1 } }
    await notifier.onSettled({ gameId: game.gameId, before: start, after: chapterEnd })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('Chapter')
    tick(10_000) // well inside the 60s window; pretend the grace is up
    store.setPendingPing({ ...store.pendingPing(game.gameId)!, dueAt: 0 })
    await notifier.sweep()
    expect(sent).toHaveLength(1)
  })

  it('the turn card says what the player faces and shows the public table', async () => {
    const { store, game, start, afterRed } = await setup()
    const posts: Posted[] = []
    const notifierWith = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: { channelId: CHANNEL, bot: { postMessage: async (_c: string, m: Posted) => void posts.push(m) } as never },
    })
    // Yellow answers red's face-up lead; red's declaration is public, so the card names it.
    await notifierWith.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    const yellow = posts[0]!.embeds![0]!
    expect(yellow).toMatchObject({
      title: 'Your turn, Sam',
      description: 'Red led **Aggression** and declared **Warlord**.',
      author: { name: 'Arcs · Chapter 1 · Round 1' },
    })
    expect(yellow.fields).toContainEqual({ name: 'Declared', value: 'Warlord (5/3)', inline: true })
    expect(posts[0]!.link).toEqual({ label: 'Open game', url: seatLink('https://arcs.test', game.gameId) })
  })

  it('the turn card lists what each player did since the pinged player\'s last turn', async () => {
    const { store, game, start, afterRed } = await setup()
    const posts: Posted[] = []
    const notifierWith = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: { channelId: CHANNEL, bot: { postMessage: async (_c: string, m: Posted) => void posts.push(m) } as never },
    })
    await notifierWith.onSettled({ gameId: game.gameId, before: start, after: afterRed })
    // Red's whole turn on one line, the setup before it left out; the attacked seat reads by name.
    expect(posts[0]!.embeds![0]!.fields).toContainEqual({
      name: 'Since your last turn',
      value:
        '🔴 **Red** led with Aggression-4 (2 pips) · declared Warlord (5/3) · discarded Weapon · discarded Relic · ' +
        'moved 2 ships 2-Gate → 2-Arrow · attacks Sam in 2-Arrow: rolled 2S/0A/0R → 0 hits, 0 bldg, 0 self, no intercept, 0 keys',
      inline: false,
    })
  })

  it('a card copied face down stays face down in the channel', async () => {
    const { store, game, afterRed } = await setup()
    const posts: Posted[] = []
    const notifierWith = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: () => undefined,
      fallbackChannel: { channelId: CHANNEL, bot: { postMessage: async (_c: string, m: Posted) => void posts.push(m) } as never },
    })
    // Yellow copies, then takes the first legal action at every ask until the turn reaches blue.
    const registry = defaultRegistry()
    let afterYellow = afterRed
    let copied: unknown
    for (;;) {
      const c = afterYellow.continue
      if (c.kind !== 'ask' || c.faction !== 'yellow') break
      const copy = c.actions.find((a) => a.type === 'turn/copy')
      copied ??= copy?.card
      afterYellow = applyExternal(afterYellow, copy ?? c.actions[0]!, registry)
    }
    expect(afterYellow.state.log).toContain(`yellow copied with ${String(copied)}`)

    await notifierWith.onSettled({ gameId: game.gameId, before: afterRed, after: afterYellow })
    const blue = posts[0]!.embeds![0]!
    expect(blue.title).toBe('Your turn, Blue')
    const recap = blue.fields!.find((f) => f.name === 'Since your last turn')!.value.split('\n')
    // Blue has not played yet: red's turn, then yellow's, each on its own line.
    expect(recap).toHaveLength(2)
    expect(recap[0]).toMatch(/^🔴 \*\*Red\*\* led with Aggression-4 /)
    expect(recap[1]).toMatch(/^🟡 \*\*Sam\*\* copied \(card face down\) · seized the initiative · /)
    expect(JSON.stringify(posts[0])).not.toContain(String(copied))
  })

  it('the engine\'s prompt names players, not colours', async () => {
    const { store, game, sent, notifier, start, afterRed } = await setup()
    store.setName(game.gameId, game.seats[0]!.seatToken, 'Brian')
    // Mid-turn asks carry the engine's own prompt, which names factions by colour id.
    const asked: RuleResult = {
      ...afterRed,
      continue: { kind: 'ask', faction: 'yellow', actions: [{ type: 'probe/pick' }], prompt: 'Pick a system red or blue rules' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: start, after: asked })
    expect(sent[0]!.text).toContain('Pick a system Brian or blue rules')
    // Answering a question inside someone's turn is not a new turn: no recap.
    expect(sent[0]!.text).not.toContain('Since your last turn')
  })

  it('a recap too long for a Discord field keeps the latest turns whole and marks the cut', () => {
    // 30 turns of 100 characters each: three times Discord's 1024-character field limit.
    const since = Array.from({ length: 30 }, (_, i) => `${i % 2 === 0 ? 'red' : 'yellow'} did thing ${String(i).padStart(2, '0')} ${'x'.repeat(80)}`)
    const seats = [{ faction: 'red' }, { faction: 'yellow' }, { faction: 'blue' }]
    const card = turnCard(seats[2]!, startGame(THREE_PLAYER), seats, 0, since)
    const lines = card.embed.fields!.find((f) => f.name === 'Since your last turn')!.value.split('\n')
    expect(lines.join('\n').length).toBeLessThanOrEqual(1024)
    expect(lines[0]).toBe('…')
    expect(lines.at(-1)).toBe(`🟡 **Yellow** did thing 29 ${'x'.repeat(80)}`)
    // Whole turns only, the newest ones, in order: 9 fit under the limit beside the cut mark.
    expect(lines.slice(1).map((l) => /did thing (\d+)/.exec(l)![1])).toEqual(['21', '22', '23', '24', '25', '26', '27', '28', '29'])

    // One turn that alone overflows the field is cut short rather than sent for Discord to reject.
    const one = turnCard(seats[2]!, startGame(THREE_PLAYER), seats, 0, [`red did ${'y'.repeat(2000)}`])
    const value = one.embed.fields!.find((f) => f.name === 'Since your last turn')!.value
    expect(value).toHaveLength(1024)
    expect(value.startsWith('🔴 **Red** did yyy')).toBe(true)
    expect(value.endsWith('y…')).toBe(true)
  })

  it('the player who leads is told so', async () => {
    const a = await setup()
    // Going "backwards" from afterRed to start makes red, who opens the round, the asked faction.
    await a.notifier.onSettled({ gameId: a.game.gameId, before: a.afterRed, after: a.start })
    expect(a.sent[0]!.text).toContain('You lead this round.')
    // The game's first turn has nothing before it: no recap field (Discord rejects an empty one).
    expect(a.sent[0]!.text).not.toContain('Since your last turn')
  })

  it('the chapter card lists who scored each declared ambition and the power after', async () => {
    const { game, sent, notifier, afterRed } = await setup()
    const before: RuleResult = {
      ...afterRed,
      state: { ...afterRed.state, declared: [{ ambition: 'Tycoon', marker: { high: 5, low: 3 }, round: 1, by: 'red' }] },
    }
    const after: RuleResult = {
      ...afterRed,
      state: {
        ...afterRed.state,
        chapter: 2,
        declared: [],
        power: { red: 5, yellow: 3, blue: 0 },
        journal: [...RED_OPENING, 'x'],
        log: [...afterRed.state.log, 'red won Tycoon for 5 power', 'yellow placed second in Tycoon for 3 power'],
      },
    }
    await notifier.onSettled({ gameId: game.gameId, before, after })
    expect(sent[0]!.text).toContain('Chapter 1 scored — Chapter 2 begins')
    expect(sent[0]!.text).toContain(JSON.stringify({ name: 'Tycoon', value: '🔴 Red +5\n🟡 Sam +3', inline: true }))
    expect(sent[0]!.text).toContain(JSON.stringify({ name: 'Power', value: '🔴 Red 5\n🟡 Sam 3\n🔵 Blue 0', inline: false }))
  })

  it('an ambition nobody placed in still gets a non-empty field (Discord rejects empty ones)', async () => {
    const { game, sent, notifier, afterRed } = await setup()
    const before: RuleResult = {
      ...afterRed,
      state: { ...afterRed.state, declared: [{ ambition: 'Tycoon', marker: { high: 5, low: 3 }, round: 1, by: 'red' }] },
    }
    // Two-player games: the out-of-play resources can take first with no one second, and no "No one scored" line.
    const after: RuleResult = {
      ...afterRed,
      state: {
        ...afterRed.state,
        chapter: 2,
        declared: [],
        journal: [...RED_OPENING, 'x'],
        log: [...afterRed.state.log, 'the out-of-play resources lead Tycoon; no one takes first'],
      },
    }
    await notifier.onSettled({ gameId: game.gameId, before, after })
    expect(sent[0]!.text).toContain(JSON.stringify({ name: 'Tycoon', value: 'No one scored', inline: true }))
  })

  it('a game that no longer replays does not hold up another game\'s held ping', async () => {
    const store = new SqliteStore(':memory:')
    const broken = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const fine = await store.create(THREE_PLAYER, THREE_PLAYER.factions)
    const afterRed = replayGame(THREE_PLAYER, RED_OPENING)
    for (const g of [broken, fine]) {
      for (let i = 0; i < RED_OPENING.length; i += 1) await store.append(g.gameId, g.seats[0]!.seatToken, i, `f${i}`)
      store.setPendingPing({ gameId: g.gameId, seatToken: g.seats[1]!.seatToken, journalLength: RED_OPENING.length, chapter: 1, dueAt: 0 })
    }
    const sent: Sent[] = []
    const notifier = new Notifier(store, {
      publicOrigin: 'https://arcs.test',
      current: (id) => {
        if (id === broken.gameId) throw new Error('journal does not replay')
        return afterRed
      },
      fallbackChannel: channel(sent),
      now: () => 1_000_000,
    })
    await notifier.sweep()
    expect(sent.map((m) => m.text.includes(fine.gameId))).toEqual([true])
  })

  it('the game-over card ranks every faction by power', async () => {
    const { game, sent, notifier, afterRed } = await setup()
    const over: RuleResult = {
      state: { ...afterRed.state, isOver: true, winners: ['blue'], power: { red: 20, yellow: 18, blue: 31 }, journal: [...RED_OPENING, 'x'] },
      continue: { kind: 'gameOver', winners: ['blue'], reason: 'test' },
    }
    await notifier.onSettled({ gameId: game.gameId, before: afterRed, after: over })
    expect(sent[0]!.text).toContain('🏆 Blue wins')
    expect(sent[0]!.text).toContain(JSON.stringify('🥇 Blue 31\n🥈 Red 20\n🥉 Sam 18'))
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
    expect(sent[0]!.text).toMatch(/wins/i)
  })
})
