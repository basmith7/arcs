/**
 * Step A of the learned-policy spike: docs/19 §3i's interventional pairs, with the label averaged
 * over K cheap playouts per branch instead of one.
 *
 *   node dist-spike/pairs-collect.mjs <shard> <shards> <games> [K=370] [every=40]
 *
 * Positions come from 4p games walked by `normal` (seeds 700000+g, games g = shard, shard+shards…).
 * Every `every` decisions with >= 2 offers, take the first and last offered action (as §3i did).
 * Each branch is played to the end K times with `playoutFrom` under `playoutChoice`: salt k redeals
 * what the mover cannot see and fixes the dice, and both branches share salt k (common random
 * numbers). The label for salt k is rel(a) - rel(b), rel = mine minus the best rival's final power.
 * Features are §3i's: featuresOf(after a) - featuresOf(after b), from the mover's view.
 *
 * One JSON line per pair: { game, step, n, d, y: [K diffs, null where either branch did not finish] }.
 */
import {
  advance, botForLevel, botToAct, defaultRegistry, featuresOf, intentFor, observe, playoutChoice,
  playoutFrom, startGame, stepBot, FEATURES, NO_ASKS,
} from '@arcs/engine'
import type { Bot, FactionId } from '@arcs/engine'

const [shard, shards, games] = process.argv.slice(2, 5).map(Number) as [number, number, number]
const K = Number(process.argv[5] ?? 370)
const every = Number(process.argv[6] ?? 40)
const factions: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
const walker = botForLevel('normal')
const cheap: Bot = { id: 'cheap', decide: (_o, actions) => ({ action: playoutChoice(actions), because: '' }) }

for (let g = shard; g < games; g += shards) {
  let r = startGame({ board: 'Board4MixUp1', factions, seed: 700000 + g, bots: factions }, reg)
  let asked = NO_ASKS
  for (let step = 0; step < 20_000; step++) {
    const who = botToAct(r, factions)
    if (who === undefined) break
    const c = r.continue
    if (step % every === 0 && c.kind === 'ask' && c.actions.length >= 2) {
      const a = c.actions[0]!
      const b = c.actions[c.actions.length - 1]!
      try {
        const oa = observe(advance(r.state, a, reg).state, who)
        const ob = observe(advance(r.state, b, reg).state, who)
        const xa = featuresOf(oa, who, intentFor(oa, who))
        const xb = featuresOf(ob, who, intentFor(ob, who))
        const rel = (p: Readonly<Partial<Record<FactionId, number>>>): number =>
          (p[who] ?? 0) - Math.max(0, ...factions.filter((f) => f !== who).map((f) => p[f] ?? 0))
        const y: (number | null)[] = []
        for (let k = 0; k < K; k++) {
          const salt = 100_000 * (g + 1) + 1_000 * (step % 100) + k
          const pa = playoutFrom(r, who, a, { policy: cheap, horizon: 'game', salt }, reg)
          const pb = playoutFrom(r, who, b, { policy: cheap, horizon: 'game', salt }, reg)
          y.push(pa.finished && pb.finished ? rel(pa.power) - rel(pb.power) : null)
        }
        process.stdout.write(`${JSON.stringify({ game: g, step, n: c.actions.length, a: a.type, b: b.type, d: FEATURES.map((f) => xa[f] - xb[f]), y })}\n`)
      } catch (e) {
        process.stderr.write(`skip g${g} s${step}: ${(e as Error).message}\n`)
      }
    }
    const s = stepBot(r, walker, who, reg, asked)
    r = s.result
    asked = s.asked
  }
}
