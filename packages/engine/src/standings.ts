import type { FactionId } from './ids.js'
import type { GameState } from './state.js'

/**
 * Turn order for breaking ties: the initiative order (rulebook 6.2.3), not the seating order
 * `state.factions` lists. A faction missing from `initiativeOrder` is appended in seating order
 * rather than dropped; the two lists agree today and a winner is no place to discover otherwise.
 */
export function turnOrder(state: GameState): readonly FactionId[] {
  return [
    ...state.initiativeOrder.filter((f) => state.factions.includes(f)),
    ...state.factions.filter((f) => !state.initiativeOrder.includes(f)),
  ]
}

/**
 * Final placings, best first: power descending, ties broken by `turnOrder`. First place is the
 * faction `performCheckWin` picks; 2nd and later use the same rule.
 */
export function standings(state: GameState): readonly { faction: FactionId; power: number }[] {
  return turnOrder(state)
    .map((faction) => ({ faction, power: state.power[faction] ?? 0 }))
    .sort((a, b) => b.power - a.power) // Array.sort is stable: turn order breaks ties.
}
