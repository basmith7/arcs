/**
 * Player stats for `GET /me/stats` (docs/superpowers/specs/2026-10-14-player-stats-design.md):
 * one row per claimed game, built from the replayed result, plus the summary over finished games.
 * Pure over its inputs so it is testable without a store; the API supplies the claimed games.
 */
import { standings } from '@arcs/engine'
import type { RuleResult } from '@arcs/engine'

import type { PublicSeat } from './api.js'

/** A claimed game as the API finds it: this account's seats in it, the replay, the public table. */
export interface ClaimedGame {
  readonly gameId: string
  readonly updatedAt: number
  /** The account's seats in this game, with their tokens. */
  readonly held: { faction: string; seatToken: string }[]
  readonly result: RuleResult
  readonly seats: readonly PublicSeat[]
}

export interface GameRow {
  readonly gameId: string
  readonly seatToken: string
  readonly updatedAt: number
  readonly over: boolean
  readonly won?: boolean
  readonly place?: number
  readonly players: number
  readonly power: number
  readonly colour: string
  readonly leader?: string
  readonly chapter: number
  readonly withBots: boolean
  /** The account holds every human seat: shown in history, kept out of the record. */
  readonly soloHotseat: boolean
  readonly table: readonly { colour: string; name?: string; power: number; isBot: boolean; owner?: string }[]
}

export interface Tally {
  played: number
  won: number
}

export interface Stats {
  readonly summary: {
    readonly played: number
    readonly won: number
    readonly inProgress: number
    /** Per player count: power and place are not comparable across table sizes. */
    readonly averagePower: Record<number, number>
    readonly averagePlace: Record<number, number>
  }
  readonly byLeader: Record<string, Tally>
  readonly byColour: Record<string, Tally>
  readonly games: readonly GameRow[]
}

function rowOf(g: ClaimedGame): GameRow {
  const { state } = g.result
  const order = standings(state)
  // An account holding several seats in one game is represented by its best-placed seat.
  const placeOf = (f: string): number => order.findIndex((s) => s.faction === f) + 1
  const best = g.held.reduce((a, b) => (placeOf(b.faction) < placeOf(a.faction) ? b : a))
  const humans = g.seats.filter((s) => !s.isBot)
  const soloHotseat = g.held.length > 1 && humans.every((s) => g.held.some((h) => h.faction === s.faction))
  const leader = state.leaders[best.faction as keyof typeof state.leaders]
  const owner = new Map(g.seats.map((s) => [s.faction, s]))
  return {
    gameId: g.gameId,
    seatToken: best.seatToken,
    updatedAt: g.updatedAt,
    over: state.isOver,
    ...(state.isOver ? { won: state.winners[0] === best.faction, place: placeOf(best.faction) } : {}),
    players: state.factions.length,
    power: state.power[best.faction as keyof typeof state.power] ?? 0,
    colour: best.faction,
    ...(state.leadersAndLore !== undefined && leader !== undefined ? { leader } : {}),
    chapter: state.chapter,
    withBots: g.seats.some((s) => s.isBot),
    soloHotseat,
    table: order.map(({ faction, power }) => {
      const s = owner.get(faction)
      return {
        colour: faction,
        ...(s?.name === undefined ? {} : { name: s.name }),
        power,
        isBot: s?.isBot ?? false,
        ...(s?.owner === undefined ? {} : { owner: s.owner }),
      }
    }),
  }
}

export function buildStats(claimed: readonly ClaimedGame[]): Stats {
  const games = claimed.map(rowOf)
  const counted = games.filter((g) => g.over && !g.soloHotseat)
  const byLeader: Record<string, Tally> = {}
  const byColour: Record<string, Tally> = {}
  const tally = (into: Record<string, Tally>, key: string, won: boolean): void => {
    const t = (into[key] ??= { played: 0, won: 0 })
    t.played += 1
    if (won) t.won += 1
  }
  const power: Record<number, number[]> = {}
  const place: Record<number, number[]> = {}
  for (const g of counted) {
    tally(byColour, g.colour, g.won === true)
    if (g.leader !== undefined) tally(byLeader, g.leader, g.won === true)
    ;(power[g.players] ??= []).push(g.power)
    ;(place[g.players] ??= []).push(g.place!)
  }
  const mean = (by: Record<number, number[]>): Record<number, number> =>
    Object.fromEntries(Object.entries(by).map(([n, xs]) => [n, xs.reduce((a, b) => a + b, 0) / xs.length]))
  return {
    summary: {
      played: counted.length,
      won: counted.filter((g) => g.won).length,
      inProgress: games.filter((g) => !g.over && !g.soloHotseat).length,
      averagePower: mean(power),
      averagePlace: mean(place),
    },
    byLeader,
    byColour,
    games,
  }
}
