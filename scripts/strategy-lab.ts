/**
 * The committed-strategies experiment, run to its pre-registered protocol
 * (docs/spikes/2026-09-strategies.md, Part 1). Local shards only, resumable: a finished step's
 * output file is its checkpoint.
 *
 *   npx vite-node scripts/strategy-lab.ts               # probes -> gates -> mixed field
 *   npx vite-node scripts/strategy-lab.ts -- explore    # the exploratory board and leader runs
 *   npx vite-node scripts/strategy-lab.ts -- status
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { pairedGate } from '@arcs/engine'
import type { GameOutcome } from '@arcs/engine'

const DIR = 'runs/strategies'
mkdirSync(DIR, { recursive: true })
const SUMMARY = `${DIR}/summary.md`
const STATE = `${DIR}/state.json`
const JOBS = Number(process.env['LAB_JOBS'] ?? 14)
const NAMES = ['warlord', 'builder', 'court'] as const
const PLAN: Record<string, readonly string[]> = { warlord: ['Warlord', 'Tyrant'], builder: ['Tycoon'], court: ['Keeper', 'Empath'] }

type Tally = { offered: Record<string, number>; taken: Record<string, number> }
interface Probe { unfinished: number; tallies: Record<string, Tally> }
interface State { steps: Record<string, string>; config: Record<string, string> }
const state: State = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as State) : { steps: {}, config: {} }
const save = (): void => writeFileSync(STATE, JSON.stringify(state, null, 1))
const note = (line: string): void => {
  const stamped = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC — ${line}`
  appendFileSync(SUMMARY, stamped + '\n')
  console.log(stamped)
}
const current = (what: string): void => writeFileSync(`${DIR}/current.txt`, `${what} (since ${new Date().toISOString()})\n`)

function run(args: string[], log: string): void {
  const r = spawnSync('npm', ['run', '-s', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 })
  writeFileSync(log, (r.stdout ?? '') + '\n--- stderr ---\n' + (r.stderr ?? ''))
  if (r.status !== 0) throw new Error(`npm run ${args.join(' ')} failed (${r.status}); see ${log}`)
}

const lines = (f: string): GameOutcome[] =>
  readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as GameOutcome)
const outcomes = (files: string[]): GameOutcome[] => files.flatMap(lines)

function arena(key: string, seats: string, games: number, seed: number, extra: string[] = []): string {
  const out = `${DIR}/${key}.jsonl`
  if (existsSync(out) && lines(out).length >= games) return out
  current(`arena ${key}: ${games} games`)
  const t = Date.now()
  run(['arena', '--', '--seats', seats, '--games', String(games), '--jobs', String(JOBS), '--seed', String(seed), '--out', out, ...extra], `${DIR}/${key}.log`)
  note(`${key}: ${games} games in ${((Date.now() - t) / 60000).toFixed(1)} min`)
  return out
}

function probe(key: string, spec: string): Probe {
  const out = `${DIR}/probe-${key}.json`
  if (!existsSync(out)) {
    current(`probe ${key}: 100 games`)
    const t = Date.now()
    run(['coverage', '--', '--seats', `A=hard,B=${spec},B=${spec},A=hard`, '--games', '100', '--jobs', String(JOBS), '--seed', '91000', '--json', out], `${DIR}/probe-${key}.log`)
    note(`probe ${key}: 100 games in ${((Date.now() - t) / 60000).toFixed(1)} min`)
  }
  return JSON.parse(readFileSync(out, 'utf8')) as Probe
}

const sumKeys = (r: Record<string, number>, keys: readonly string[]): number => keys.reduce((n, k) => n + (r[k] ?? 0), 0)
const declareShare = (t: Tally, plan: readonly string[]): number => {
  const all = Object.entries(t.taken).filter(([k]) => k.startsWith('declare:')).reduce((n, [, v]) => n + v, 0)
  return all === 0 ? 0 : sumKeys(t.taken, plan.map((a) => `declare:${a}`)) / all
}
const battleRate = (t: Tally): number => ((t.offered['take:Battle'] ?? 0) === 0 ? 0 : (t.taken['take:Battle'] ?? 0) / t.offered['take:Battle']!)

/** The pre-registered probe criteria. */
function judge(name: string, p: Probe): { declaresOk: boolean; battlesOk: boolean; note: string } {
  const a = p.tallies['A']!
  const b = p.tallies['B']!
  const dA = declareShare(a, PLAN[name]!)
  const dB = declareShare(b, PLAN[name]!)
  const bA = battleRate(a)
  const bB = battleRate(b)
  const declaresOk = dB >= dA + 0.15
  const battlesOk = name === 'warlord' ? bB >= bA + 0.05 : bB <= bA + 0.02
  const pct = (x: number): string => `${(100 * x).toFixed(1)}%`
  return {
    declaresOk,
    battlesOk,
    note: `plan share of declares ${pct(dB)} vs hard ${pct(dA)} (need +15 pts: ${declaresOk ? 'met' : 'MISSED'}); ` +
      `Battle take rate ${pct(bB)} vs hard ${pct(bA)} (${name === 'warlord' ? 'need +5 pts' : 'allowed +2 pts'}: ${battlesOk ? 'met' : 'MISSED'}); ` +
      `${p.unfinished} unfinished`,
  }
}

const fmt = (g: ReturnType<typeof pairedGate>): string =>
  `win ${(100 * g.winDiff).toFixed(1)} ± ${(100 * g.winSe).toFixed(1)} pts/side (z ${g.winZ.toFixed(2)}), power ${g.powerDiff >= 0 ? '+' : ''}${g.powerDiff.toFixed(2)} ± ${g.powerSe.toFixed(2)} (z ${g.powerZ.toFixed(2)}), ${g.games} games/${g.units} deals`

function gate(name: string, spec: string, seedBase = 1_110_000): string {
  const files: string[] = []
  for (let k = 0; k < 4; k++) {
    const seats = `A=hard,B=${spec},B=${spec},A=hard`
    const whole = `${DIR}/gate-${name}-${k}.jsonl`
    if (existsSync(whole) && lines(whole).length >= 400) files.push(whole)
    else {
      // Four 100-game pieces, each saved as it finishes: the same 400 games (deal = seed + floor(i/4),
      // so pieces at seed offsets 0/25/50/75 reproduce the chunk), but an interruption costs one piece.
      for (let j = 0; j < 4; j++) files.push(arena(`gate-${name}-${k}p${j}`, seats, 100, seedBase + 1000 * k + 25 * j))
    }
    const g = pairedGate(outcomes(files), 'B', 'A')
    note(`${name} gate after ${(k + 1) * 400} games: ${fmt(g)}`)
    if (k === 1) {
      if (g.winZ <= 0.5) return `not detected (futility at 800, z ${g.winZ.toFixed(2)})`
      if (g.winZ >= 3.54 && g.powerZ >= -2) return 'pass (early, at 800)'
    }
    if (k === 3) return g.pass ? 'pass' : `not detected (z ${g.winZ.toFixed(2)} at 1,600)`
  }
  return 'not detected'
}

const mixedSeats = (): string =>
  `W=${state.config['warlord'] ?? 'strat:warlord'},B=${state.config['builder'] ?? 'strat:builder'},C=${state.config['court'] ?? 'strat:court'},H=hard`

function main(): void {
  const mode = process.argv[2]
  if (mode === 'status') {
    console.log(existsSync(SUMMARY) ? readFileSync(SUMMARY, 'utf8') : '(no summary yet)')
    console.log(`current: ${existsSync(`${DIR}/current.txt`) ? readFileSync(`${DIR}/current.txt`, 'utf8').trim() : '—'}`)
    return
  }
  if (!existsSync(SUMMARY)) appendFileSync(SUMMARY, `# Committed strategies — run log\n\n`)

  // docs/spikes/2026-09-pip-menu.md: probe then gate `exp:s1` against `hard`.
  if (mode === 's1') {
    if (state.steps['probe-s1'] === undefined) {
      const p = probe('s1', 'exp:s1')
      const t = (id: string): Tally => p.tallies[id]!
      const rate = (x: Tally, k: string): number => (x.taken[k] ?? 0) / Math.max(1, x.offered[k] ?? 0)
      const secure = rate(t('B'), 'take:Secure')
      const ok = p.unfinished === 0 && secure >= 0.05
      const pct = (x: number): string => `${(100 * x).toFixed(1)}%`
      note(`s1 probe: ${p.unfinished} unfinished; take:Secure ${pct(secure)} vs hard ${pct(rate(t('A'), 'take:Secure'))} (need >= 5%); ` +
        `Battle ${pct(rate(t('B'), 'take:Battle'))} vs ${pct(rate(t('A'), 'take:Battle'))}, Move ${pct(rate(t('B'), 'take:Move'))} vs ${pct(rate(t('A'), 'take:Move'))}, ` +
        `Influence ${pct(rate(t('B'), 'take:Influence'))} vs ${pct(rate(t('A'), 'take:Influence'))}`)
      state.steps['probe-s1'] = ok ? 'pass' : 'fail'
      save()
      note(`**s1 probe: ${state.steps['probe-s1']!.toUpperCase()}**`)
    }
    if (state.steps['probe-s1'] === 'pass' && state.steps['gate-s1'] === undefined) {
      state.steps['gate-s1'] = gate('s1', 'exp:s1', 1_210_000)
      save()
      note(`**s1 gate: ${state.steps['gate-s1']!.toUpperCase()}**`)
    }
    current('s1 done')
    return
  }

  if (mode === 'explore') {
    for (const board of ['Board4MixUp2', 'Board4Frontiers', 'Board4MixUp3']) {
      arena(`explore-${board}`, mixedSeats(), 400, 1_400_000, ['--board', board])
    }
    arena('explore-leaders', mixedSeats(), 400, 1_500_000, ['--lore', '1'])
    current('explore done')
    note('EXPLORE DONE')
    return
  }

  // 1. Probes, with the one pre-registered retry at commitment 0.95 if declares miss.
  for (const name of NAMES) {
    if (state.steps[`probe-${name}`] !== undefined) continue
    let spec = `strat:${name}`
    let p = probe(name, spec)
    let j = judge(name, p)
    note(`${name} probe: ${j.note}`)
    if (p.unfinished === 0 && !j.declaresOk && j.battlesOk) {
      spec = `strat:${name}:0.95`
      p = probe(`${name}-0.95`, spec)
      j = judge(name, p)
      note(`${name} probe retry at 0.95: ${j.note}`)
    }
    state.config[name] = spec
    state.steps[`probe-${name}`] = p.unfinished === 0 && j.declaresOk && j.battlesOk ? 'pass' : 'fail'
    save()
    note(`**${name} probe: ${state.steps[`probe-${name}`]!.toUpperCase()}** (${spec})`)
  }

  // 2. Gates for the strategies that passed their probes.
  for (const name of NAMES) {
    const key = `gate-${name}`
    if (state.steps[key] !== undefined) continue
    if (state.steps[`probe-${name}`] !== 'pass') {
      state.steps[key] = 'no gate (probe failed)'
      save()
      continue
    }
    const verdict = gate(name, state.config[name]!)
    state.steps[key] = verdict
    save()
    note(`**${name} gate: ${verdict.toUpperCase()}**`)
  }

  // 3. The mixed field: one look at 1,600 games.
  if (state.steps['mixed'] === undefined) {
    const out = arena('mixed', mixedSeats(), 1600, 1_300_000)
    const all = lines(out)
    for (const [id, name] of [['W', 'warlord'], ['B', 'builder'], ['C', 'court']] as const) {
      const g = pairedGate(all, id, 'H')
      const tested = state.steps[`probe-${name}`] === 'pass'
      note(`mixed field ${name} vs hard: ${fmt(g)} — ${tested ? (g.pass ? 'PASS' : 'no pass') : 'untested (probe failed)'}`)
    }
    state.steps['mixed'] = 'done'
    save()
  }
  current('done')
  note('MAIN RUNS DONE')
}

main()
