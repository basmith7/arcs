/**
 * Pool arena outcome logs and apply the pre-registered gate (spec 2026-09-23 rev 3, A2).
 *
 *   npm run gate -- <challengerId> <controlId> runs/c1a-part1.jsonl runs/c1a-part2.jsonl ...
 *
 * Gates run in halves with different seeds: after the first half a **futility-only** look stops a
 * gate whose win z is <= 0 ("not detected"). A futility stop can only end a run that would otherwise
 * continue, never pass one, so it adds no false passes; the pass threshold (z >= 2.5) is unchanged
 * and applied to the pooled total.
 */
import { readFileSync } from 'node:fs'

import { pairedGate } from '@arcs/engine'
import type { GameOutcome } from '@arcs/engine'

const [challenger, control, ...files] = process.argv.slice(2)
if (challenger === undefined || control === undefined || files.length === 0) {
  console.error('usage: npm run gate -- <challengerId> <controlId> <outcomes.jsonl>...')
  process.exit(2)
}
const outcomes: GameOutcome[] = files.flatMap((f) =>
  readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as GameOutcome),
)
const g = pairedGate(outcomes, challenger, control)
const sd = g.winSe * Math.sqrt(Math.max(1, g.games))
const mde = (d: number): number => Math.ceil((((2.5 + 0.84) * sd) / d) ** 2)
const unfinished = outcomes.filter((o) => !o.finished).length
console.log(
  `${challenger} vs ${control}: ${g.games} finished games (${unfinished} unfinished)\n` +
    `  win share Δ ${(100 * g.winDiff).toFixed(2)} ± ${(100 * g.winSe).toFixed(2)} pts per side (z ${g.winZ.toFixed(2)})\n` +
    `  power Δ ${g.powerDiff.toFixed(2)} ± ${g.powerSe.toFixed(2)} per seat (z ${g.powerZ.toFixed(2)})\n` +
    `  ${g.pass ? 'PASS' : g.winZ <= 0 ? 'futility: z <= 0' : 'no pass'}; games for 80% power at +3/+2 pts: ${mde(0.06)}/${mde(0.04)}`,
)
