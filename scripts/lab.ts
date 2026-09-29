/**
 * The unattended lab (docs/19 §24): probe -> 2p pre-screen -> 4p gate for each candidate, every
 * decision fixed here in advance, so a weekend of arena time needs nobody watching it.
 *
 *   npm run lab            # run (resumable: completed steps are skipped)
 *   npm run lab -- status  # print runs/lab/summary.md and the current step
 *
 * Rules, all against today's `hard`:
 *   1. Probe — 100 4p games (`coverage`), candidate in two seats. Must finish every game, plus the
 *      candidate's own criterion (below). A guild-use candidate outside its band is retried once at
 *      the next weight in its ladder.
 *   2. Pre-screen — 400 2p games. Continues only if the win-share z is above 0.
 *   3. Gate — 4p, A,B,B,A, chunks of 400 games (100 deals). After 800 games: z <= 0.5 stops for
 *      futility ("not detected"); z >= 3.54 passes early (O'Brien-Fleming at half). After 1,600:
 *      pass at z >= 2.5 with power z >= -2, as every gate in §23.
 *   4. If more than one passed: the assembly (hard + every passing overlay) against hard, same rules.
 *
 * Arena runs use 14 local shards plus 6 capped shards on Tower (`--remote tower:6`); the repo is
 * rsynced there before each run.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { pairedGate } from '@arcs/engine'
import type { GameOutcome } from '@arcs/engine'

// LAB_SMOKE=1: the same pipeline at toy sizes in its own directory, to prove it end to end.
const SMOKE = process.env['LAB_SMOKE'] === '1'
const DIR = SMOKE ? 'runs/lab-smoke' : 'runs/lab'
const N = { probe: SMOKE ? 4 : 100, pre: SMOKE ? 8 : 400, chunk: SMOKE ? 8 : 400 }
mkdirSync(DIR, { recursive: true })
const SUMMARY = `${DIR}/summary.md`
const STATE = `${DIR}/state.json`
const REMOTE = process.env['LAB_REMOTE'] ?? 'tower:6'
const JOBS = Number(process.env['LAB_JOBS'] ?? 14)

type Tally = { offered: Record<string, number>; taken: Record<string, number>; reversals: number }
interface Probe { unfinished: number; tallies: Record<string, Tally> }
interface Candidate {
  readonly name: string
  /** Hard's weights overridden by these (`hardw:` spec), e.g. `garrison=0.25`. */
  readonly overlay: string
  readonly what: string
  /** Probe criterion: undefined = pass; otherwise why it failed ('high'/'low' steer a ladder retry). */
  readonly criterion: (p: Probe) => { ok: boolean; note: string; steer?: 'high' | 'low' }
  /** For a weight ladder: the experiment to try if the probe says the weight is too high / too low. */
  readonly lower?: string
  readonly higher?: string
}

const rate = (t: Tally, prefix: string): number => {
  let o = 0
  let k = 0
  for (const [key, v] of Object.entries(t.offered)) if (key.startsWith(prefix)) o += v
  for (const [key, v] of Object.entries(t.taken)) if (key.startsWith(prefix)) k += v
  return o === 0 ? 0 : k / o
}
const moveShare = (t: Tally): number => {
  const takes = Object.entries(t.taken).filter(([k]) => k.startsWith('take:'))
  const all = takes.reduce((n, [, v]) => n + v, 0)
  return all === 0 ? 0 : (t.taken['take:Move'] ?? 0) / all
}

const guild = (name: string, weight: number, lower?: string, higher?: string): Candidate => ({
  name,
  overlay: `guildUse=${weight}`,
  what: 'use guild Prelude abilities (flat bonus per ability)',
  criterion: (p) => {
    const r = rate(p.tallies['B']!, 'guild:')
    const note = `guild ability take rate ${(100 * r).toFixed(1)}% (hard ${(100 * rate(p.tallies['A']!, 'guild:')).toFixed(1)}%), band 5-50%`
    if (r > 0.5) return { ok: false, note, steer: 'high' }
    if (r < 0.05) return { ok: false, note, steer: 'low' }
    return { ok: true, note }
  },
  ...(lower === undefined ? {} : { lower }),
  ...(higher === undefined ? {} : { higher }),
})

const CANDIDATES: readonly Candidate[] = [
  {
    name: 'c6',
    overlay: 'garrison=0.25',
    what: 'keep a garrison home when rival ships are near our buildings (fleet size)',
    criterion: (p) => {
      const a = p.tallies['A']!.reversals
      const b = p.tallies['B']!.reversals
      return { ok: b <= a + 2, note: `reversals ${b} vs hard ${a} (allowed +2)` }
    },
  },
  guild('c8a', 1, 'c8b', 'c8c'),
  {
    name: 'c7',
    overlay: 'takeMove=0.02',
    what: 'nudge the pip menu toward Move when a fleet can close on a target (tie-break)',
    criterion: (p) => {
      const d = moveShare(p.tallies['B']!) - moveShare(p.tallies['A']!)
      return { ok: Math.abs(d) <= 0.03, note: `Move share of pips ${(100 * d).toFixed(1)} pts vs hard (allowed ±3)` }
    },
  },
]
const LADDER = new Map<string, Candidate>([
  ['c8b', guild('c8b', 0.5)],
  ['c8c', guild('c8c', 2)],
])

interface State { steps: Record<string, unknown>; passed: string[]; done: boolean }
const state: State = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as State) : { steps: {}, passed: [], done: false }
const save = (): void => writeFileSync(STATE, JSON.stringify(state, null, 1))
const note = (line: string): void => {
  const stamped = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC — ${line}`
  appendFileSync(SUMMARY, stamped + '\n')
  console.log(stamped)
}
const current = (what: string): void => writeFileSync(`${DIR}/current.txt`, `${what} (since ${new Date().toISOString()})\n`)

function run(cmd: string, args: string[], log: string): void {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 })
  writeFileSync(log, (r.stdout ?? '') + '\n--- stderr ---\n' + (r.stderr ?? ''))
  if (r.status !== 0 && !existsSync(log.replace('.log', '.jsonl'))) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}); see ${log}`)
}

function sync(): void {
  spawnSync('rsync', ['-a', '--delete', '--exclude', '.git', '--exclude', 'runs', '--exclude', '.superpowers',
    '--exclude', 'apps/web/dist', '--exclude', 'assets', './', 'tower:/mnt/cache/appdata/arcs-lab/'], { stdio: 'ignore' })
}

const outcomes = (files: string[]): GameOutcome[] =>
  files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as GameOutcome))

/** One arena run to a jsonl, skipped if already complete. */
function arena(key: string, seats: string, games: number, seed: number): string {
  const out = `${DIR}/${key}.jsonl`
  if (existsSync(out) && readFileSync(out, 'utf8').split('\n').filter((l) => l.startsWith('{')).length >= games) return out
  current(`arena ${key}: ${games} games`)
  sync()
  run('npm', ['run', '-s', 'arena', '--', '--seats', seats, '--games', String(games), '--jobs', String(JOBS),
    '--remote', REMOTE, '--seed', String(seed), '--out', out], `${DIR}/${key}.log`)
  return out
}

function probe(name: string, overlay: string): Probe {
  const out = `${DIR}/probe-${name}.json`
  if (!existsSync(out)) {
    current(`probe ${name}: 100 games`)
    run('npm', ['run', '-s', 'coverage', '--', '--seats', `A=hard,B=hardw:${overlay},B=hardw:${overlay},A=hard`, '--games', String(N.probe),
      '--jobs', String(JOBS), '--seed', '91000', '--json', out], `${DIR}/probe-${name}.log`)
  }
  return JSON.parse(readFileSync(out, 'utf8')) as Probe
}

const fmt = (g: ReturnType<typeof pairedGate>): string =>
  `win ${(100 * g.winDiff).toFixed(1)} ± ${(100 * g.winSe).toFixed(1)} pts/side (z ${g.winZ.toFixed(2)}), power ${g.powerDiff >= 0 ? '+' : ''}${g.powerDiff.toFixed(2)} (z ${g.powerZ.toFixed(2)}), ${g.games} games/${g.units} deals`

/** Pre-screen + gate for one bot spec against hard. Returns 'pass' or a reason. */
function measure(label: string, spec: string, seedBase: number): string {
  const pre = pairedGate(outcomes([arena(`${label}-2p`, `A=hard,B=${spec}`, N.pre, seedBase)]), 'B', 'A')
  note(`${label} 2p pre-screen: ${fmt(pre)}`)
  if (pre.winZ <= 0) return 'not detected (2p pre-screen z <= 0)'
  const files: string[] = []
  for (let k = 0; k < 4; k++) {
    files.push(arena(`${label}-4p-${k}`, `A=hard,B=${spec},B=${spec},A=hard`, N.chunk, seedBase + 10_000 + k * 1000))
    const g = pairedGate(outcomes(files), 'B', 'A')
    note(`${label} 4p gate after ${files.length * N.chunk} games: ${fmt(g)}`)
    if (k === 1) {
      if (g.winZ <= 0.5) return `not detected (futility at half, z ${g.winZ.toFixed(2)})`
      if (g.winZ >= 3.54 && g.powerZ >= -2) return 'pass'
    }
    if (k === 3) return g.pass ? 'pass' : `not detected (z ${g.winZ.toFixed(2)} at 1,600)`
  }
  return 'not detected'
}

function main(): void {
  if (process.argv[2] === 'status') {
    console.log(existsSync(SUMMARY) ? readFileSync(SUMMARY, 'utf8') : '(no summary yet)')
    console.log(`current: ${existsSync(`${DIR}/current.txt`) ? readFileSync(`${DIR}/current.txt`, 'utf8').trim() : '—'}`)
    console.log(`passed so far: ${state.passed.join(', ') || 'none'}${state.done ? ' — LAB DONE' : ''}`)
    return
  }
  if (!existsSync(SUMMARY)) appendFileSync(SUMMARY, `# Weekend lab — ${new Date().toISOString().slice(0, 10)}\n\n`)
  let seed = 700_000
  for (const base of CANDIDATES) {
    let c: Candidate | undefined = base
    let retried = false
    while (c !== undefined) {
      seed += 100_000
      const key = `result-${c.name}`
      if (state.steps[key] !== undefined) break
      const p = probe(c.name, c.overlay)
      const crit: ReturnType<Candidate['criterion']> = c.criterion(p)
      note(`${c.name} (${c.what}) probe: ${p.unfinished} unfinished; ${crit.note}`)
      if (p.unfinished > 0 || !crit.ok) {
        const next: string | undefined = !retried && crit.steer === 'high' ? c.lower : !retried && crit.steer === 'low' ? c.higher : undefined
        state.steps[key] = `probe failed: ${crit.note}`
        save()
        note(`${c.name}: PROBE FAILED${next === undefined ? '' : ` — retrying at ${next}`}`)
        c = next === undefined ? undefined : LADDER.get(next)
        retried = true
        continue
      }
      const verdict = measure(c.name, `hardw:${c.overlay}`, seed)
      state.steps[key] = verdict
      if (verdict === 'pass') state.passed.push(`${c.name}:${c.overlay}`)
      save()
      note(`**${c.name}: ${verdict.toUpperCase()}**`)
      break
    }
  }
  // The assembly: every passing overlay together, against hard, under the same rules — only
  // needed when more than one passed (a single pass already is its own assembly).
  if (state.passed.length > 1 && state.steps['result-assembly'] === undefined) {
    const overlay = state.passed.map((p) => p.slice(p.indexOf(':') + 1)).join('/')
    note(`assembly (${overlay}) — measuring against hard`)
    const verdict = measure('assembly', `hardw:${overlay}`, 1_900_000)
    state.steps['result-assembly'] = verdict
    save()
    note(`**assembly: ${verdict.toUpperCase()}**`)
  }
  state.done = true
  save()
  current('done')
  note(`LAB DONE. Passed: ${state.passed.join(', ') || 'none'}.`)
}

main()
