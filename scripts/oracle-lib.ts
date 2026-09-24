/**
 * The oracle: full rollouts of candidate moves from a real position, fanned out over processes
 * (spec 2026-09-23 rev 3, section B1). A rebuild of the docs/19 section 17 instrument, which never
 * reached the repo.
 *
 * Processes rather than `worker_threads` for the reason `arena-shard.ts` gives: the scripts are
 * TypeScript under vite-node, and a process boundary needs no second TS pipeline. Each shard replays
 * the game from options + journal (a few ms) rather than receiving a cloned state.
 *
 * **Results do not depend on the core count.** Work item `i` is (candidate `i / salts`, salt
 * `salts[i % salts]`) and shard `k` of `n` takes items `k, k+n, …`; the answer for an item is a pure
 * function of (journal, candidate, salt, policy, horizon), and results are reassembled by index.
 */

import { spawn } from 'node:child_process'

import type { FactionId, NewGameOptions } from '@arcs/engine'

export interface OracleJob {
  readonly options: NewGameOptions
  readonly journal: readonly string[]
  readonly self: FactionId
  /** Encoded actions (`encodeAction`), each answering the position's current ask. */
  readonly candidates: readonly string[]
  readonly salts: readonly number[]
  readonly policy: 'normal' | 'hard'
  readonly horizon: 'chapter' | 'game'
}

export interface OracleCell {
  /** 1 if `self` won (tie-break wins included), else 0. */
  readonly win: number
  /** `self`'s power minus the best rival's at the end of the playout. */
  readonly margin: number
  readonly finished: boolean
}

export interface ShardJob extends OracleJob {
  readonly shard: number
  readonly shards: number
}

/** `[candidate][saltIndex]`. */
export async function evaluate(job: OracleJob, cores: number): Promise<OracleCell[][]> {
  const total = job.candidates.length * job.salts.length
  const shards = Math.max(1, Math.min(cores, total))
  const cells = new Array<OracleCell | undefined>(total)
  await Promise.all(
    [...Array(shards).keys()].map(
      (shard) =>
        new Promise<void>((resolve, reject) => {
          const payload: ShardJob = { ...job, shard, shards }
          const child = spawn('npx', ['vite-node', 'scripts/oracle-shard.ts'], {
            stdio: ['pipe', 'pipe', 'inherit'],
          })
          child.stdin.end(JSON.stringify(payload))
          let buffer = ''
          child.stdout.setEncoding('utf8')
          child.stdout.on('data', (chunk: string) => {
            buffer += chunk
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('{')) continue
              const { index, cell } = JSON.parse(line) as { index: number; cell: OracleCell }
              cells[index] = cell
            }
          })
          child.on('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`oracle shard ${shard} exited ${code}`)),
          )
        }),
    ),
  )
  const out: OracleCell[][] = job.candidates.map(() => [])
  for (let i = 0; i < total; i++) {
    const cell = cells[i]
    if (cell === undefined) throw new Error(`oracle item ${i} produced no result`)
    out[Math.floor(i / job.salts.length)]!.push(cell)
  }
  return out
}

/** Mean and standard error of a sample. */
export function meanSe(xs: readonly number[]): { mean: number; se: number } {
  const n = xs.length
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, n)
  if (n < 2) return { mean, se: Number.POSITIVE_INFINITY }
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  return { mean, se: Math.sqrt(v / n) }
}

/** Paired comparison over common salts: `a[j] - b[j]`. */
export function paired(a: readonly number[], b: readonly number[]): { mean: number; se: number; z: number } {
  const d = a.map((x, j) => x - (b[j] ?? 0))
  const { mean, se } = meanSe(d)
  return { mean, se, z: se === 0 || !Number.isFinite(se) ? 0 : mean / se }
}
