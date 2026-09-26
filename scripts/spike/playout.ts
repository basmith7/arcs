/**
 * Engine-speed spike, step 2: the training-data unit cost.
 *
 *   node dist-spike/playout.mjs <2|4> <shard> <shards> [perGame=10]
 *
 * Positions: `perGame` evenly spaced points of each golden `normal` journal at that player count
 * (replayed; the first ask at or after each point). One `playoutFrom(result, self, undefined,
 * { policy: normal, horizon: 'game', salt })` per position, timed as CPU of this process; replay
 * is outside the timed region. One JSON line per position.
 */
import { readFileSync } from 'node:fs'
import { botForLevel, decodeAction, defaultRegistry, applyExternal, playoutFrom, startGame } from '@arcs/engine'
import type { NewGameOptions, RuleResult } from '@arcs/engine'
import { SPIKE_COUNTS } from '../../packages/engine/src/spike-count.js'

const players = Number(process.argv[2])
const shard = Number(process.argv[3] ?? 0)
const shards = Number(process.argv[4] ?? 1)
const perGame = Number(process.argv[5] ?? 10)

interface Golden { name: string; options: NewGameOptions; level: string; journal: string[] }
const { games } = JSON.parse(readFileSync('packages/engine/test/fixtures/golden-journals.json', 'utf8')) as { games: Golden[] }
const pick = games.filter((g) => g.level === 'normal' && g.options.factions.length === players)
const registry = defaultRegistry()
const policy = botForLevel('normal')

let item = 0
for (const g of pick) {
  const at = new Set([...Array(perGame).keys()].map((k) => Math.floor(((k + 0.5) / perGame) * g.journal.length)))
  let r: RuleResult = startGame(g.options, registry)
  let pending = false
  for (let i = 0; i <= g.journal.length; i++) {
    if (at.has(i)) pending = true
    if (pending && r.continue.kind === 'ask') {
      pending = false
      if (item++ % shards === shard) {
        const self = r.continue.faction
        const salt = 1000 * games.indexOf(g) + i
        const c0 = { ...SPIKE_COUNTS }
        const t0 = process.cpuUsage()
        const out = playoutFrom(r, self, undefined, { policy, horizon: 'game', salt }, registry)
        const t = process.cpuUsage(t0)
        console.log(
          JSON.stringify({
            game: g.name, at: i, of: g.journal.length, chapter: r.state.chapter, self, salt,
            cpuMs: +((t.user + t.system) / 1000).toFixed(1), finished: out.finished, winner: out.winner,
            advance: SPIKE_COUNTS.advance - c0.advance, featuresOfUncached: SPIKE_COUNTS.featuresOfUncached - c0.featuresOfUncached,
          }),
        )
      }
    }
    if (i < g.journal.length) r = applyExternal(r, decodeAction(g.journal[i]!), registry)
  }
}
