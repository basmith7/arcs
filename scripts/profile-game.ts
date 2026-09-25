/**
 * Time one seeded bot game — the number the speed work is judged by.
 *
 *   npm run profile -- 4 normal
 *   node --cpu-prof ... for a profile (see docs/19 §21)
 */
import { botForLevel, playGame } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'

const players = Number(process.argv[2] ?? 4)
const level = (process.argv[3] ?? 'normal') as 'normal' | 'hard'
const seed = Number(process.argv[4] ?? 201)
const factions = (['red', 'yellow', 'blue', 'white'] as FactionId[]).slice(0, players)
const board = players === 4 ? 'Board4MixUp1' : players === 3 ? 'Board3Frontiers' : 'Board2Frontiers'
const t = Date.now()
const o = playGame({ seats: botForLevel(level), seed, factions, board })
const ms = Date.now() - t
console.log(`${players}p ${level} seed ${seed}: ${ms} ms, ${o.actions} decisions, ${(ms / o.actions).toFixed(1)} ms/decision`)
