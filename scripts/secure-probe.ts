/**
 * Why does `hard` never take Secure from the pip menu? (coverage report, runs/finders)
 * Plays one 4p all-`hard` game and prints, at each pip menu offering Secure, the scored candidates.
 *
 *   npx vite-node scripts/secure-probe.ts <seed> [maxShown]
 */
import { EXPERIMENTS, NO_ASKS, botForLevel, botToAct, defaultRegistry, startGame, stepBot } from '@arcs/engine'
import type { AskedThisTurn, FactionId, RuleResult } from '@arcs/engine'

const [seedArg, maxArg] = process.argv.slice(2)
const max = Number(maxArg ?? 6)
const bot = process.argv[4] === "s1" ? EXPERIMENTS["s1"]!() : botForLevel("hard")
const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
let r: RuleResult = startGame({ board: 'Board4MixUp1', factions: F, seed: Number(seedArg ?? 93001), bots: F }, reg)
let asked: AskedThisTurn = NO_ASKS
let shown = 0
for (let i = 0; i < 20_000 && shown < max; i++) {
  const f = botToAct(r, F)
  if (f === undefined) break
  const offered = r.continue.kind === 'ask' ? r.continue.actions : []
  const step = stepBot(r, bot, f, reg, asked)
  if (offered.some((a) => a.type === 'action/take' && a['action'] === 'Secure')) {
    shown++
    console.log(`\n# decision ${i}, ${f}, chapter ${r.state.chapter} round ${r.state.round} — took ${String(step.decision.action['label'] ?? step.decision.action['action'])}`)
    for (const c of [...(step.decision.considered ?? [])].sort((a, b) => b.score - a.score)) {
      console.log(`  ${c.score.toFixed(4)}  ${String(c.action['action'] ?? c.action.type).padEnd(10)} ${c.eligible === false ? '[ineligible] ' : ''}${c.note ?? ''}`)
    }
  }
  r = step.result
  asked = step.asked
}
