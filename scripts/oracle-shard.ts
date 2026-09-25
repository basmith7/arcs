/**
 * One shard of an oracle evaluation — spawned by `oracle-lib.ts`, not run by hand. Reads a
 * `ShardJob` on stdin, prints one `{ index, cell }` JSON line per work item.
 */
import { readFileSync } from 'node:fs'

import { botForLevel, decodeAction, defaultRegistry, playoutFrom, replayGame } from '@arcs/engine'

import type { OracleCell, ShardJob } from './oracle-lib.js'

const job = JSON.parse(readFileSync(0, 'utf8')) as ShardJob
const registry = defaultRegistry()
const start = replayGame(job.options, job.journal, registry)
const policy = botForLevel(job.policy)
const total = job.candidates.length * job.salts.length

for (let i = job.shard; i < total; i += job.shards) {
  const candidate = decodeAction(job.candidates[Math.floor(i / job.salts.length)]!)
  const salt = job.salts[i % job.salts.length]!
  const r = playoutFrom(start, job.self, candidate, { policy, horizon: job.horizon, salt }, registry)
  const mine = r.power[job.self] ?? 0
  const best = Math.max(...job.options.factions.filter((f) => f !== job.self).map((f) => r.power[f] ?? 0))
  const cell: OracleCell = { win: r.winner === job.self ? 1 : 0, margin: mine - best, finished: r.finished }
  process.stdout.write(`${JSON.stringify({ index: i, cell })}\n`)
}
