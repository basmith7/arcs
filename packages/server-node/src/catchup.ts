/**
 * The turn catch-up's story (spec 2026-10-04-scoreboard-catchup-design.md).
 *
 * When the turn passes to a human seat, the server asks DeepSeek for a short story starring that
 * player, built from `seatFacts` — public facts, that seat's own hand, and the heads-ups code
 * picked. A second, cheaper call checks every claim against the facts and that nothing advises a
 * move; a failure gets one rewrite, a second failure gets no story (the page shows the bullets,
 * which it computes itself). A passing story is stored for that seat and journal length and pushed
 * down that seat's socket.
 *
 * Its own gate subscriber, beside the notifier, so it inherits none of the ping rules. Fire and
 * forget: `onSettled` only enqueues, on one chain for the whole server, so a slow or failing call
 * never delays a move — and DeepSeek sees one game's request at a time.
 */
import { defaultRegistry, replayGame, seatFacts, sinceLastTurn, turnStart, withNames } from '@arcs/engine'
import type { FactionId, NewGameOptions, RuleResult, SeatFacts } from '@arcs/engine'

import type { Chat } from './deepseek.js'
import { askedOf } from './gate.js'
import type { Settled } from './gate.js'
import type { Presence } from './presence.js'
import type { SqliteStore } from './sqlite-store.js'

export interface CatchupOptions {
  /** The game's live result, to drop a story the game has moved past while it was written. */
  readonly current: (gameId: string) => RuleResult | undefined
  /** Undefined (no DEEPSEEK_API_KEY): no stories, the page shows its bullets only. */
  readonly chat?: Chat
  readonly writerModel: string
  readonly checkerModel: string
  /** Per call. Default 30 s. */
  readonly timeoutMs?: number
  readonly now?: () => number
}

/** The push a seat's socket receives when its story is ready. */
export interface CatchupPush {
  readonly catchup: { readonly length: number; readonly story: string }
}

const MAX_WORDS = 120 // the prompt asks for 80; slack before a long draft counts as a failure

const STORY_SYSTEM = `You narrate a game of Arcs for one player, who is the hero of the story. Root for them.
Write at most 80 words of plain text: two or three sentences on what happened since their last
turn, then one line of your own rooting for them — a statement about them, never a command. The
heads-ups are shown to the player as bullets right above your text: do not repeat them, though the
story may lead up to them.
Use only the facts provided. Never invent moves, cards or numbers. Never tell the player what to
do, suggest a move, or say "you should"/"consider". Do not guess what any rival holds in hand.
Arcs basics: taxing a city gains its planet's resource; Relics score Keeper, Material and Fuel
score Tycoon, Psionics score Empath; a secured Guild card counts as one of its resource; Weapons
score no ambition.`

const CHECK_SYSTEM = `You check a short game recap against the facts it was written from. Reply PASS if every factual claim in it is supported by the facts and no sentence advises a game action (a move, a card to play, a plan to follow). A closing line that roots for the player without stating a game fact is fine: it is neither a claim nor advice. Otherwise reply FAIL: followed by the first unsupported or advising sentence.`

/** The facts as the writer sees them: names in place of faction ids, the hand marked private. */
function factSheet(facts: SeatFacts, name: (f: FactionId) => string): string {
  const named = (t: string): string => withNames(t, facts.factions.map((f) => f.faction), name)
  return JSON.stringify(
    {
      since: facts.since.map(named),
      headsUps: facts.headsUps.map((h) => named(h.text)),
      standings: facts.factions.map((f) => ({ player: name(f.faction), colour: f.faction, ...f })),
      ambitions: facts.ambitions.map((a) => ({
        ...a,
        holdings: a.holdings.map((h) => ({ player: name(h.faction), value: h.value })),
      })),
      ifChapterEndedNow:
        facts.ifChapterEndedNow?.results.map((r) => ({
          ambition: r.ambition,
          wouldScore: r.awards.map((a) => ({ player: name(a.faction), place: a.place, power: a.power })),
        })) ?? null,
      'your hand — private to you': facts.hand,
    },
    null,
    1,
  )
}

export function storyPrompt(facts: SeatFacts, name: (f: FactionId) => string): { system: string; user: string } {
  return {
    system: STORY_SYSTEM,
    user: `The hero is ${name(facts.self)}, playing ${facts.self}.\n\n${factSheet(facts, name)}`,
  }
}

export function checkPrompt(facts: SeatFacts, name: (f: FactionId) => string, story: string): { system: string; user: string } {
  return { system: CHECK_SYSTEM, user: `${factSheet(facts, name)}\n---\n${story}` }
}

export class CatchupWriter {
  private readonly registry = defaultRegistry()
  private chain: Promise<void> = Promise.resolve()
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(
    private readonly store: SqliteStore,
    private readonly presence: Presence,
    private readonly opts: CatchupOptions,
  ) {
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.now = opts.now ?? Date.now
  }

  /** Never throws and never waits: the gate calls it after every settle. */
  onSettled(s: Settled): void {
    try {
      this.consider(s)
    } catch (e) {
      console.error('[catchup] skipped', s.gameId, e)
    }
  }

  /** Resolves once every queued story has been written or given up on (tests). */
  async settled(): Promise<void> {
    let tail = this.chain
    for (;;) {
      await tail
      if (tail === this.chain) return
      tail = this.chain
    }
  }

  private consider({ gameId, before, after }: Settled): void {
    if (after.state.isOver) {
      this.store.deleteCatchups(gameId)
      return
    }
    const asked = askedOf(after)
    if (asked === undefined || (before !== null && askedOf(before) === asked)) return
    const seat = this.store.seats(gameId).find((s) => s.faction === asked)
    if (seat === undefined || seat.isBot) return
    const chat = this.opts.chat
    if (chat === undefined) return
    const length = after.state.journal.length
    if (this.store.getCatchup(gameId, asked, length) !== undefined) return
    this.chain = this.chain.then(() =>
      this.write(chat, gameId, asked as FactionId, seat.seatToken, after).catch((e: unknown) => {
        console.error('[catchup] no story', gameId, asked, String(e))
      }),
    )
  }

  private async write(chat: Chat, gameId: string, faction: FactionId, seatToken: string, after: RuleResult): Promise<void> {
    const options = this.store.options(gameId) as NewGameOptions | undefined
    if (options === undefined) return
    const journal = after.state.journal
    const before = replayGame(options, journal.slice(0, sinceLastTurn(journal, faction)), this.registry).state
    const facts = seatFacts(before, after.state, faction, this.registry)
    const names = new Map(this.store.seats(gameId).map((s) => [s.faction, s.name ?? s.faction]))
    const name = (f: FactionId): string => names.get(f) ?? f

    const ask = (model: string, p: { system: string; user: string }, reason = false): Promise<string> => {
      const signal = AbortSignal.timeout(this.timeoutMs)
      // Raced as well as passed: a call that ignores its signal still cannot hold the chain.
      const timedOut = new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('deepseek timeout')), { once: true }),
      )
      return Promise.race([chat(model, p.system, p.user, signal, { reason }), timedOut])
    }

    let story: string | undefined
    const refusals: string[] = []
    for (let attempt = 0; attempt < 2 && story === undefined; attempt++) {
      const draft = await ask(this.opts.writerModel, storyPrompt(facts, name), true)
      const verdict = await ask(this.opts.checkerModel, checkPrompt(facts, name, draft), true)
      const words = draft.split(/\s+/).length
      if (words > MAX_WORDS) refusals.push(`${words} words`)
      else if (/^\W*PASS\b/i.test(verdict)) story = draft
      else refusals.push(verdict.slice(0, 160).replace(/\s+/g, ' '))
    }
    if (story === undefined) {
      console.log(`[catchup] bullets only for ${gameId} ${faction}: ${refusals.join(' | ')}`)
      return
    }
    // The seat may have started its turn meanwhile; anything else (its turn over, a take-back
    // below the hand-off) means this story describes a turn that is no longer current.
    const live = this.opts.current(gameId)?.state.journal
    if (live === undefined || turnStart(live, faction) !== journal.length) return
    this.store.putCatchup(gameId, faction, journal.length, story, this.now())
    const push: CatchupPush = { catchup: { length: journal.length, story } }
    this.presence.send(gameId, seatToken, push)
  }
}
