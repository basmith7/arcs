/** One shard of `scripts/coverage.ts`: plays games by index, prints `{ index, outcome, tallies }`. */
import { defaultRegistry, playGameAt, seatsForGame } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'

import { buildBot } from './bot-spec.js'
import type { ArenaJob } from './bot-spec.js'
import { recorder } from './tally-lib.js'
import type { Tally } from './tally-lib.js'

const job = JSON.parse(process.argv[2] ?? '{}') as ArenaJob
const registry = defaultRegistry()
const bots = job.specs.map((spec, i) => ({ ...buildBot(spec), id: job.ids[i] ?? buildBot(spec).id }))
const factions = job.factions as readonly FactionId[]

for (let i = job.shard; i < job.games; i += job.jobs) {
  const seats = seatsForGame(bots, factions, i)
  const tallies = new Map<string, Tally>()
  const botOf = (f: FactionId): string => seats[f]?.id ?? '?'
  const outcome = playGameAt(bots, i, {
    seed: job.seed,
    board: job.board,
    factions,
    onDecision: recorder(tallies, botOf),
  }, registry)
  process.stdout.write(`${JSON.stringify({ index: i, outcome, tallies: Object.fromEntries(tallies) })}\n`)
}
