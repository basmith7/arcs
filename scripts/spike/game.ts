/**
 * Engine-speed spike, step 1/4: one seeded bot game, timed as CPU of this process.
 *
 *   node dist-spike/game.mjs <players> <normal|hard> <seed>
 *
 * Prints one JSON line: CPU ms (user+sys), decisions, GC ms, call counts and per-decision medians.
 */
import { PerformanceObserver } from 'node:perf_hooks'
import { botForLevel, playGame } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'
import { SPIKE_COUNTS } from '../../packages/engine/src/spike-count.js'

const players = Number(process.argv[2] ?? 4)
const level = (process.argv[3] ?? 'normal') as 'normal' | 'hard'
const seed = Number(process.argv[4] ?? 201)
const factions = (['red', 'yellow', 'blue', 'white'] as FactionId[]).slice(0, players)
const board = players === 4 ? 'Board4MixUp1' : players === 3 ? 'Board3Frontiers' : 'Board2Frontiers'

let gcMs = 0
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) gcMs += e.duration
}).observe({ entryTypes: ['gc'] })

type K = keyof typeof SPIKE_COUNTS
const keys = Object.keys(SPIKE_COUNTS) as K[]
const per: Record<K, number[]> = Object.fromEntries(keys.map((k) => [k, []])) as never
let last = { ...SPIKE_COUNTS }
const cpu0 = process.cpuUsage()
const o = playGame({
  seats: botForLevel(level),
  seed,
  factions,
  board,
  onDecision: () => {
    for (const k of keys) per[k].push(SPIKE_COUNTS[k] - last[k])
    last = { ...SPIKE_COUNTS }
  },
})
const c = process.cpuUsage(cpu0)
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}
const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)] ?? 0
setTimeout(() => console.log(
  JSON.stringify({
    players, level, seed, finished: o.finished, decisions: o.actions,
    cpuMs: Math.round((c.user + c.system) / 1000), gcMs: Math.round(gcMs),
    counts: { ...SPIKE_COUNTS },
    perDecision: Object.fromEntries(keys.map((k) => [k, { median: median(per[k]), p90: pct(per[k], 0.9), max: Math.max(...per[k]), mean: +(SPIKE_COUNTS[k] / o.actions).toFixed(1) }])),
  }),
), 50)
