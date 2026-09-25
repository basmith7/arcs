/**
 * Where does the evaluator see nothing? For each decision type, how often the best two candidates
 * score exactly equal — the choice then falls to offer order, as Move destinations did before
 * `moveToward` (docs/19 §23). Plays one 4p game with the named experiment in every seat.
 *
 *   npx vite-node scripts/tie-audit.ts <experiment|hard> <seed>
 */
import { EXPERIMENTS, NO_ASKS, botForLevel, botToAct, defaultRegistry, startGame, stepBot } from '@arcs/engine'
import type { AskedThisTurn, FactionId, RuleResult } from '@arcs/engine'

const [name, seedArg] = process.argv.slice(2)
const bot = name === 'hard' ? botForLevel('hard') : EXPERIMENTS[name!]!()
const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
let r: RuleResult = startGame({ board: 'Board4MixUp1', factions: F, seed: Number(seedArg), bots: F }, reg)
let asked: AskedThisTurn = NO_ASKS
const seen: Record<string, { n: number; tied: number; options: number }> = {}
for (let i = 0; i < 20_000; i++) {
  const f = botToAct(r, F)
  if (f === undefined) break
  const step = stepBot(r, bot, f, reg, asked)
  const cons = step.decision.considered ?? []
  if (cons.length >= 2) {
    const key = cons[0]!.action.type
    const sorted = [...cons].filter((c) => c.eligible !== false).map((c) => c.score).sort((a, b) => b - a)
    const t = (seen[key] ??= { n: 0, tied: 0, options: 0 })
    t.n++
    t.options += cons.length
    if (sorted.length >= 2 && sorted[0] === sorted[1]) t.tied++
  }
  r = step.result
  asked = step.asked
}
console.log(JSON.stringify(seen))
