/**
 * The whole game's chapter reports, for the game-over screen. Built on the engine's
 * `buildChapterReport`; lives here because it replays through `startGame`/`applyExternal`.
 */

import { applyExternal, buildChapterReport, chapterEnded, decodeAction, finalChapterReport, startGame } from '@arcs/engine'
import type { ChapterReport, FactionId, NewGameOptions, RuleRegistry, RuleResult } from '@arcs/engine'

export interface GameHistory {
  readonly chapters: readonly ChapterReport[]
  readonly winner: FactionId
  readonly reason: string
  /** Final power, best first; seating order breaks ties, matching the engine's winner pick. */
  readonly standings: readonly { faction: FactionId; power: number }[]
}

/**
 * Every chapter's report, rebuilt by replaying the journal from the start.
 *
 * Replayed on demand rather than accumulated as the game runs: the store would otherwise have
 * to invalidate its accumulation on undo, on load and on a multiplayer resync, and the replay
 * is the same property the whole save system already rests on — the journal reproduces
 * everything. Paid once, when the game-over screen opens.
 */
export function buildGameHistory(
  options: NewGameOptions,
  journal: readonly string[],
  registry: RuleRegistry,
): GameHistory {
  let result: RuleResult = startGame(options, registry)
  const chapters: ChapterReport[] = []
  for (const encoded of journal) {
    const prev = result
    result = applyExternal(prev, decodeAction(encoded), registry)
    // `chapter >= 1`: a Leaders & Lore draft ends with the 0 -> 1 bump, which is no chapter.
    if (prev.state.chapter >= 1 && chapterEnded(prev.state, result.state)) {
      chapters.push(buildChapterReport(prev.state, result.state))
    } else {
      const last = finalChapterReport(prev.state, result.state)
      if (last !== null) chapters.push(last)
    }
  }

  const state = result.state
  const standings = state.factions
    .map((faction) => ({ faction, power: state.power[faction] ?? 0 }))
    .sort((a, b) => b.power - a.power) // Array.sort is stable: seating order breaks ties.
  const over = result.continue
  return {
    chapters,
    // The continue is authoritative; `state.winners` holds chapter winners mid-game.
    winner: over.kind === 'gameOver' ? over.winners[0]! : standings[0]!.faction,
    reason: over.kind === 'gameOver' ? over.reason : '',
    standings,
  }
}
