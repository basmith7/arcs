/**
 * B2 — the offline power test for the rollout rule (spec 2026-09-23 rev 3, section B2).
 *
 *   npm run b2 -- corpus  [--games 40] [--jobs 14]   # 4p hard self-play, every card play logged
 *   npm run b2 -- select  [--cores 14] [--max 400]   # 32 normal-policy salts per candidate
 *   npm run b2 -- evaluate [--cores 14] [--salts 32] # held out, all-hard continuation, flips only
 *   npm run b2 -- report
 *
 * Every stage appends JSONL under runs/b2/ and skips work already done, so it can be stopped and
 * resumed. The decision rule, the sample and the pass criterion are the spec's, fixed in advance:
 *
 *   - contested decisions only: hard's top-two tier-1 margin below the corpus median;
 *   - candidates: top 3 roots by tier-1 value, plus hard's pick;
 *   - selection: displace hard's pick with the best challenger whose paired win-share difference
 *     over 32 common salts has z >= 1.0;
 *   - evaluation: displaced decisions only, 32 fresh salts (1000+), every seat `hard`;
 *   - pass: net held-out gain per decision (non-displaced count as 0), game-clustered, z >= 2.
 *     Early stop after 150 decisions if gain < +0.5% with se < 2%.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'

import { evaluate, paired } from './oracle-lib.js'
import type { FactionId, NewGameOptions } from '@arcs/engine'

// B2_DIR lets a smoke run use its own directory.
const DIR = process.env['B2_DIR'] ?? 'runs/b2'
mkdirSync(DIR, { recursive: true })
const argv = process.argv.slice(2)
const stage = argv[0]
const flag = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? d : Number(argv[i + 1])
}
const lines = <T>(f: string): T[] =>
  existsSync(`${DIR}/${f}`)
    ? readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as T)
    : []

interface Decision { idx: number; faction: FactionId; cands: { a: string; t1: number }[]; pick: string }
interface Game { seed: number; options: NewGameOptions; journal: string[]; finished: boolean; decisions: Decision[] }
interface Selected { key: string; seed: number; idx: number; candidates: string[]; wins: number[][]; margins: number[][]; rule: number; z: number }
interface Evaluated { key: string; seed: number; hard: number[]; rule: number[] }

const keyOf = (seed: number, idx: number): string => `${seed}:${idx}`

/** The contested sample, deterministic: margin below the median, <= 10 per game, spread by index. */
function sample(games: Game[], max: number): { game: Game; d: Decision; candidates: string[] }[] {
  const all: { game: Game; d: Decision; margin: number; candidates: string[] }[] = []
  for (const game of games) {
    if (!game.finished) continue
    for (const d of game.decisions) {
      const ranked = [...d.cands].sort((a, b) => b.t1 - a.t1)
      if (ranked.length < 2) continue
      const top3 = ranked.slice(0, 3).map((c) => c.a)
      const chosen = [d.pick, ...top3.filter((a) => a !== d.pick)]
      all.push({ game, d, margin: ranked[0]!.t1 - ranked[1]!.t1, candidates: chosen })
    }
  }
  const sorted = [...all].map((x) => x.margin).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const out: { game: Game; d: Decision; candidates: string[] }[] = []
  const byGame = new Map<number, typeof all>()
  for (const x of all) if (x.margin < median) byGame.set(x.game.seed, [...(byGame.get(x.game.seed) ?? []), x])
  // Round-robin across games so an early stop still spans many games.
  const queues = [...byGame.values()].map((q) => {
    const step = Math.max(1, Math.floor(q.length / 10))
    return q.filter((_, i) => i % step === 0).slice(0, 10)
  })
  for (let round = 0; out.length < max; round++) {
    let any = false
    for (const q of queues) {
      const x = q[round]
      if (x === undefined) continue
      any = true
      out.push({ game: x.game, d: x.d, candidates: x.candidates })
      if (out.length >= max) break
    }
    if (!any) break
  }
  return out
}

async function corpus(): Promise<void> {
  const games = flag('games', 40)
  const jobs = flag('jobs', 14)
  const seed = 50_000
  const have = new Set(lines<Game>('corpus.jsonl').map((g) => g.seed))
  if (have.size >= games) return console.log(`corpus: ${have.size} games already`)
  await Promise.all(
    [...Array(jobs).keys()].map(
      (shard) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn('npx', ['vite-node', 'scripts/b2-corpus-shard.ts', JSON.stringify({ games, shard, jobs, seed })], {
            stdio: ['ignore', 'pipe', 'inherit'],
          })
          let buffer = ''
          child.stdout.setEncoding('utf8')
          child.stdout.on('data', (chunk: string) => {
            buffer += chunk
            const ls = buffer.split('\n')
            buffer = ls.pop() ?? ''
            for (const l of ls) {
              if (!l.startsWith('{')) continue
              const g = JSON.parse(l) as Game
              if (have.has(g.seed)) continue
              appendFileSync(`${DIR}/corpus.jsonl`, l + '\n')
              process.stderr.write(`corpus: game ${g.seed}, ${g.decisions.length} card plays\n`)
            }
          })
          child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`corpus shard ${shard} exited ${c}`))))
        }),
    ),
  )
}

async function select(): Promise<void> {
  const cores = flag('cores', 14)
  const max = flag('max', 400)
  const saltsN = flag('salts', 32)
  const done = new Set(lines<Selected>('selection.jsonl').map((s) => s.key))
  const todo = sample(lines<Game>('corpus.jsonl'), max)
  for (const { game, d, candidates } of todo) {
    const key = keyOf(game.seed, d.idx)
    if (done.has(key)) continue
    const t = Date.now()
    const cells = await evaluate(
      {
        options: game.options,
        journal: game.journal.slice(0, d.idx),
        self: d.faction,
        candidates,
        salts: [...Array(saltsN).keys()],
        policy: 'normal',
        horizon: 'game',
      },
      cores,
    )
    const wins = cells.map((r) => r.map((c) => c.win))
    const margins = cells.map((r) => r.map((c) => c.margin))
    let rule = 0
    let z = 1.0
    for (let i = 1; i < candidates.length; i++) {
      const p = paired(wins[i]!, wins[0]!)
      if (p.z >= z) {
        z = p.z
        rule = i
      }
    }
    const row: Selected = { key, seed: game.seed, idx: d.idx, candidates, wins, margins, rule, z: rule === 0 ? 0 : z }
    appendFileSync(`${DIR}/selection.jsonl`, JSON.stringify(row) + '\n')
    done.add(key)
    process.stderr.write(`select ${done.size}/${todo.length} ${key}: rule ${rule === 0 ? 'keeps hard' : `flips (z ${z.toFixed(2)})`} ${Math.round((Date.now() - t) / 1000)}s\n`)
  }
}

async function evaluateStage(): Promise<void> {
  const cores = flag('cores', 14)
  const saltsN = flag('salts', 32)
  const games = new Map(lines<Game>('corpus.jsonl').map((g) => [g.seed, g]))
  const done = new Set(lines<Evaluated>('evaluation.jsonl').map((e) => e.key))
  for (const s of lines<Selected>('selection.jsonl')) {
    if (s.rule === 0 || done.has(s.key)) continue
    const game = games.get(s.seed)!
    const d = game.decisions.find((x) => x.idx === s.idx)!
    const t = Date.now()
    const cells = await evaluate(
      {
        options: game.options,
        journal: game.journal.slice(0, s.idx),
        self: d.faction,
        candidates: [s.candidates[0]!, s.candidates[s.rule]!],
        salts: [...Array(saltsN).keys()].map((i) => 1000 + i),
        policy: 'hard',
        horizon: 'game',
      },
      cores,
    )
    const row: Evaluated = { key: s.key, seed: s.seed, hard: cells[0]!.map((c) => c.win), rule: cells[1]!.map((c) => c.win) }
    appendFileSync(`${DIR}/evaluation.jsonl`, JSON.stringify(row) + '\n')
    done.add(s.key)
    process.stderr.write(`evaluate ${s.key}: ${Math.round((Date.now() - t) / 1000)}s\n`)
  }
}

function report(): void {
  const sel = lines<Selected>('selection.jsonl')
  const ev = new Map(lines<Evaluated>('evaluation.jsonl').map((e) => [e.key, e]))
  const flips = sel.filter((s) => s.rule !== 0)
  const scored = sel.filter((s) => s.rule === 0 || ev.has(s.key))
  // Per decision: held-out gain of the rule's pick over hard's (0 where the rule kept hard's pick).
  const gain = (s: Selected): number => {
    if (s.rule === 0) return 0
    const e = ev.get(s.key)!
    return paired(e.rule, e.hard).mean
  }
  const bySeed = new Map<number, number[]>()
  for (const s of scored) bySeed.set(s.seed, [...(bySeed.get(s.seed) ?? []), gain(s)])
  const n = scored.length
  const total = scored.reduce((a, s) => a + gain(s), 0)
  const mean = n === 0 ? 0 : total / n
  // Cluster-robust se of a ratio mean: games are the independent unit.
  const G = bySeed.size
  let v = 0
  for (const gs of bySeed.values()) v += (gs.reduce((a, b) => a + b, 0) - mean * gs.length) ** 2
  const se = n === 0 || G < 2 ? Infinity : Math.sqrt((G / (G - 1)) * v) / n
  const falseFlips = flips.filter((s) => ev.has(s.key) && gain(s) < 0).length
  const secondary = (pick: (s: Selected) => number[][]): string => {
    let flipsSec = 0
    for (const s of sel) {
      const m = pick(s)
      for (let i = 1; i < m.length; i++) if (paired(m[i]!, m[0]!).z >= 1) { flipsSec++; break }
    }
    return `${flipsSec}/${sel.length}`
  }
  console.log(`B2: ${sel.length} decisions selected from ${new Set(sel.map((s) => s.seed)).size} games; ${scored.length} scored`)
  console.log(`  displacement rate ${(100 * flips.length / Math.max(1, sel.length)).toFixed(1)}%  (${flips.length})`)
  console.log(`  false flips (held-out gain < 0) ${falseFlips}/${flips.filter((s) => ev.has(s.key)).length}`)
  console.log(`  net held-out win-share gain per decision ${(100 * mean).toFixed(2)}% ± ${(100 * se).toFixed(2)} (z ${(mean / se).toFixed(2)}), ${G} games`)
  console.log(`  secondary (description only): power-margin estimator would flip ${secondary((s) => s.margins)}`)
  if (n >= 150 && mean < 0.005 && se < 0.02) console.log('  EARLY STOP criterion met: not detected')
  console.log(mean / se >= 2 ? '  PASS (z >= 2)' : '  no pass')
}

if (stage === 'corpus') await corpus()
else if (stage === 'select') await select()
else if (stage === 'evaluate') await evaluateStage()
else if (stage === 'report') report()
else console.error('usage: npm run b2 -- corpus | select | evaluate | report')
