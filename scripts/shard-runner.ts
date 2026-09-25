/**
 * How shard processes are launched: as plain JavaScript bundled with esbuild, not through vite-node.
 *
 * Measured with B2 paused (docs/19 §25): the same two 4p `normal` games cost 50.6-51.1 s of CPU
 * under vite-node and 38.1-39.0 s compiled — about 25% less per game, on every arena, coverage,
 * oracle and corpus run. The bundle is rebuilt from the current source the first time a process
 * asks for it (esbuild takes well under a second), so a stale bundle can never run old code.
 *
 * `LAB_NO_COMPILE=1` falls back to vite-node.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, renameSync } from 'node:fs'

export type Shard = 'arena-shard' | 'tally-shard' | 'oracle-shard' | 'b2-corpus-shard'

const built = new Set<Shard>()

function build(shard: Shard): void {
  if (built.has(shard)) return
  mkdirSync('dist-lab', { recursive: true })
  // Build to a temporary name and rename, so a shard starting mid-build never reads half a file.
  const tmp = `dist-lab/${shard}.${process.pid}.tmp.mjs`
  const r = spawnSync(
    'node_modules/.bin/esbuild',
    [`scripts/${shard}.ts`, '--bundle', '--platform=node', '--format=esm', '--target=node22', `--outfile=${tmp}`, '--log-level=warning'],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) throw new Error(`esbuild failed for ${shard}: ${r.stderr}`)
  renameSync(tmp, `dist-lab/${shard}.mjs`)
  built.add(shard)
}

/** The command and leading arguments that run `shard`; append the shard's own arguments. */
export function shardCommand(shard: Shard): [string, string[]] {
  if (process.env['LAB_NO_COMPILE'] === '1') return ['npx', ['vite-node', `scripts/${shard}.ts`]]
  build(shard)
  return ['node', [`dist-lab/${shard}.mjs`]]
}
