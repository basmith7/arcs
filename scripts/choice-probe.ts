/**
 * Same-position choice probe (spec 2026-09-23 rev 3, C2 probe criterion): drive a 4p game with
 * `hard`, and at every decision whose menu touches the court (Influence/Secure on the pip menu, or
 * the card to Influence/Secure), also ask the candidate what it would do in the identical position.
 * Prints one JSON line per game: { seed, court, differ }.
 *
 *   npx vite-node scripts/choice-probe.ts <experiment> <seed>
 */
import { EXPERIMENTS, NO_ASKS, botForLevel, botToAct, defaultRegistry, encodeAction, startGame, stepBot } from '@arcs/engine'
import type { AskedThisTurn, FactionId, RuleResult } from '@arcs/engine'

const [name, seedArg] = process.argv.slice(2)
const candidate = EXPERIMENTS[name!]!()
const hard = botForLevel('hard')
const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
let r: RuleResult = startGame({ board: 'Board4MixUp1', factions: F, seed: Number(seedArg), bots: F }, reg)
let asked: AskedThisTurn = NO_ASKS
let court = 0
let differ = 0
for (let i = 0; i < 20_000; i++) {
  const f = botToAct(r, F)
  if (f === undefined) break
  const c = r.continue
  const touches =
    c.kind === 'ask' &&
    c.actions.some(
      (a) =>
        a.type === 'action/influence' ||
        a.type === 'action/secure' ||
        (a.type === 'action/take' && (a['action'] === 'Influence' || a['action'] === 'Secure')),
    )
  const step = stepBot(r, hard, f, reg, asked)
  if (touches) {
    court++
    const alt = stepBot(r, candidate, f, reg, asked)
    if (encodeAction(alt.decision.action) !== encodeAction(step.decision.action)) differ++
  }
  r = step.result
  asked = step.asked
}
console.log(JSON.stringify({ seed: Number(seedArg), court, differ }))
