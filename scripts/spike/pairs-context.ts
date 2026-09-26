/**
 * Step A, exploratory (not pre-registered): replay pairs-collect's walks (deterministic: same seeds,
 * same `normal` walker) and emit each sampled position's context from the mover's view — the 39
 * `featuresOf` values *at the position* plus chapter, round, power rank and gap to the leader.
 *
 *   node dist-spike/pairs-context.mjs <shard> <shards> <games> [every=40]
 */
import {
  botForLevel, botToAct, defaultRegistry, featuresOf, intentFor, observe, startGame, stepBot, FEATURES, NO_ASKS,
} from '@arcs/engine'
import type { FactionId } from '@arcs/engine'

const [shard, shards, games] = process.argv.slice(2, 5).map(Number) as [number, number, number]
const every = Number(process.argv[5] ?? 40)
const factions: FactionId[] = ['red', 'yellow', 'blue', 'white']
const reg = defaultRegistry()
const walker = botForLevel('normal')
for (let g = shard; g < games; g += shards) {
  let r = startGame({ board: 'Board4MixUp1', factions, seed: 700000 + g, bots: factions }, reg)
  let asked = NO_ASKS
  for (let step = 0; step < 20_000; step++) {
    const who = botToAct(r, factions)
    if (who === undefined) break
    const c = r.continue
    if (step % every === 0 && c.kind === 'ask' && c.actions.length >= 2) {
      const o = observe(r.state, who)
      const x = featuresOf(o, who, intentFor(o, who))
      const p = factions.map((f) => r.state.power[f] ?? 0)
      const mine = r.state.power[who] ?? 0
      const best = Math.max(...factions.filter((f) => f !== who).map((f) => r.state.power[f] ?? 0))
      process.stdout.write(`${JSON.stringify({
        game: g, step, chapter: r.state.chapter, round: r.state.round,
        rank: p.filter((v) => v > mine).length, gap: mine - best,
        x: FEATURES.map((f) => x[f]),
      })}\n`)
    }
    const s = stepBot(r, walker, who, reg, asked)
    r = s.result
    asked = s.asked
  }
}
