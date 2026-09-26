/**
 * Record every tracker call of one seeded bot game (from `startGame`) for the TS/Rust replay
 * benchmark. Built by build-trace.mjs, which swaps in the recording tracker.
 *
 *   node dist-spike/trace-record.mjs <players> <level> <seed> <out.txt>
 *
 * Output (text, for a dependency-free Rust reader): line 1 "<nStrings> <nOps>", then one string
 * per line, then the op ints space-separated on one line.
 */
import { writeFileSync } from 'node:fs'
import { botForLevel, playGame } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'
import { TRACE } from './tracker-traced.js'

const players = Number(process.argv[2] ?? 4)
const level = (process.argv[3] ?? 'normal') as 'normal' | 'hard'
const seed = Number(process.argv[4] ?? 201)
const out = process.argv[5] ?? 'runs-spike/trace/tracker.txt'
const factions = (['red', 'yellow', 'blue', 'white'] as FactionId[]).slice(0, players)
const board = players === 4 ? 'Board4MixUp1' : 'Board2Frontiers'
TRACE.on = true
TRACE.limit = Number(process.env['TRACE_LIMIT'] ?? 3_000_000)
const o = playGame({ seats: botForLevel(level), seed, factions, board })
TRACE.on = false
for (const x of TRACE.strings) if (x.includes('\n')) throw new Error(`newline in id ${x}`)
writeFileSync(out, `${TRACE.strings.length} ${TRACE.ops.length}\n${TRACE.strings.join('\n')}\n${TRACE.ops.join(' ')}\n`)
const kinds = new Map<number, number>()
for (let i = 0; i < TRACE.ops.length; ) {
  const op = TRACE.ops[i]!
  kinds.set(op, (kinds.get(op) ?? 0) + 1)
  i += op === 0 ? 2 : op === 1 || op === 5 ? 5 + TRACE.ops[i + 3]! : op === 4 ? 5 : 4
}
console.log(JSON.stringify({ decisions: o.actions, strings: TRACE.strings.length, ints: TRACE.ops.length, ops: Object.fromEntries(kinds) }))
