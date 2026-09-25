/**
 * Coverage and probe tallies (spec 2026-09-23 rev 3, sections 6 and C1).
 *
 *   npm run coverage -- --seats A=hard,B=exp:c1a,A=hard,B=exp:c1a --games 100 --jobs 14
 *
 * Plays the games across shards (same seating and seeds as the arena) and prints, per bot: every
 * offered key with its take rate, the Move share of pip choices, and move reversals.
 */
import { spawn } from 'node:child_process'

import { parseSpec } from './bot-spec.js'
import type { ArenaJob } from './bot-spec.js'
import { emptyTally, merge, moveShare } from './tally-lib.js'
import type { Tally } from './tally-lib.js'
import type { FactionId, GameOutcome } from '@arcs/engine'

const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? undefined : argv[i + 1]
}
const seatArgs = (flag('seats') ?? 'hard,hard,hard,hard').split(',')
const ids = seatArgs.map((a) => (a.includes('=') ? a.slice(0, a.indexOf('=')) : a))
const specs = seatArgs.map((a) => parseSpec(a.includes('=') ? a.slice(a.indexOf('=') + 1) : a))
const games = Number(flag('games') ?? 20)
const jobs = Number(flag('jobs') ?? 14)
const seed = Number(flag('seed') ?? 90000)
const factions = (['red', 'yellow', 'blue', 'white'] as FactionId[]).slice(0, specs.length)
const board = specs.length === 4 ? 'Board4MixUp1' : specs.length === 3 ? 'Board3Frontiers' : 'Board2Frontiers'

const totals = new Map<string, Tally>()
let finished = 0
let unfinished = 0
await Promise.all(
  [...Array(jobs).keys()].map(
    (shard) =>
      new Promise<void>((resolve, reject) => {
        const job: ArenaJob = { specs, ids, games, seed, board, factions, shard, jobs }
        const child = spawn('npx', ['vite-node', 'scripts/tally-shard.ts', JSON.stringify(job)], {
          stdio: ['ignore', 'pipe', 'inherit'],
        })
        let buffer = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('{')) continue
            const r = JSON.parse(line) as { outcome: GameOutcome; tallies: Record<string, Tally> }
            if (r.outcome.finished) finished++
            else unfinished++
            for (const [id, t] of Object.entries(r.tallies)) {
              let into = totals.get(id)
              if (into === undefined) totals.set(id, (into = emptyTally()))
              merge(into, t)
            }
            process.stderr.write(`  ${finished + unfinished}/${games}\r`)
          }
        })
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${shard} exited ${code}`))))
      }),
  ),
)

console.log(`\n${games} games on ${board}: ${finished} finished, ${unfinished} unfinished`)
for (const [id, t] of totals) {
  console.log(`\n== ${id}: ${t.decisions} decisions, move share of pips ${(100 * moveShare(t)).toFixed(1)}%, reversals ${t.reversals}`)
  for (const at of t.reversalAt) console.log(`  reversal: ${at}`)
  for (const k of Object.keys(t.offered).sort()) {
    const o = t.offered[k]!
    const tk = t.taken[k] ?? 0
    console.log(`  ${k.padEnd(36)} offered ${String(o).padStart(6)}  taken ${String(tk).padStart(6)}  ${((100 * tk) / o).toFixed(1).padStart(5)}%`)
  }
}
