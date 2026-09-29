/**
 * One bot decision from plain data, for running off the main thread.
 *
 * A `hard` card play can take seconds (docs/19 §26), and both the server and the browser used to
 * think on their main thread — so the tab froze, and online every game on the server stalled with
 * it. A worker cannot be handed a `RuleResult` (structured clone drops the `Tracker`'s prototype),
 * so the request is what rebuilds one: options and journal. The reply is the encoded action, which
 * the caller applies itself with `applyExternal` — exactly what `stepBot` does — so a game played
 * through a thinker journals identically to one stepped in-process.
 */
import { applyExternal, decodeAction, defaultRegistry, encodeAction, replayGame } from '../index.js'
import type { NewGameOptions } from '../index.js'
import type { RuleRegistry, RuleResult } from '../dispatch.js'
import type { FactionId } from '../ids.js'
import { botForLevel } from './levels.js'
import type { BotLevel } from './levels.js'
import { stepBot } from './play.js'
import type { AskedThisTurn } from './play.js'

export interface ThinkRequest {
  readonly options: NewGameOptions
  readonly journal: readonly string[]
  readonly faction: FactionId
  readonly level: BotLevel | undefined
  readonly asked: AskedThisTurn
}

export interface ThinkReply {
  /** `encodeAction` of the decision. */
  readonly action: string
  readonly asked: AskedThisTurn
}

/** Games whose last position a thinker keeps, so a step replays one entry rather than the game. */
const GAMES_KEPT = 16

/**
 * A stateful `think`: it remembers each game's last position (keyed by its options) and catches up
 * by the new journal entries only. A journal that does not extend the remembered one — an undo, a
 * load — is replayed from the start.
 */
export function createThinker(registry: RuleRegistry = defaultRegistry()): (req: ThinkRequest) => ThinkReply {
  const games = new Map<string, RuleResult>()
  const positionOf = (options: NewGameOptions, journal: readonly string[]): RuleResult => {
    const key = JSON.stringify(options)
    let at = games.get(key)
    games.delete(key)
    const known = at?.state.journal
    if (at === undefined || known === undefined || !extends_(journal, known)) {
      at = replayGame(options, journal, registry)
    } else {
      for (let i = known.length; i < journal.length; i++) at = applyExternal(at, decodeAction(journal[i]!), registry)
    }
    games.set(key, at)
    if (games.size > GAMES_KEPT) games.delete(games.keys().next().value!)
    return at
  }
  return (req) => {
    const at = positionOf(req.options, req.journal)
    const step = stepBot(at, botForLevel(req.level), req.faction, registry, req.asked)
    return { action: encodeAction(step.decision.action), asked: step.asked }
  }
}

function extends_(journal: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > journal.length) return false
  // The tail is where an undo-then-replay would differ; check it first.
  for (let i = prefix.length - 1; i >= 0; i--) if (journal[i] !== prefix[i]) return false
  return true
}
