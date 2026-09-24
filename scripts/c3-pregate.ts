/**
 * C3's pre-gate (spec 2026-09-23 rev 3): before `nearWin` gets arena time it must, at some sane
 * weight, flip at least 3 contested B2-corpus decisions toward the rollout-preferred candidate.
 * (The docs/19 §18 pinned game is checked by the suite, `search-rounds.test.ts`.)
 *
 *   npx vite-node scripts/c3-pregate.ts [c3a|c3b]
 *
 * Reads runs/b2/corpus.jsonl and runs/b2/selection.jsonl.
 */
import { readFileSync } from 'node:fs'

import { EXPERIMENTS, defaultRegistry, encodeAction, replayGame, stepBot } from '@arcs/engine'
import type { NewGameOptions } from '@arcs/engine'

const name = process.argv[2] ?? 'c3a'
const bot = EXPERIMENTS[name]!()
const reg = defaultRegistry()
const read = <T>(f: string): T[] =>
  readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as T)
const games = new Map(
  read<{ seed: number; options: NewGameOptions; journal: string[] }>('runs/b2/corpus.jsonl').map((g) => [g.seed, g]),
)
const sel = read<{ seed: number; idx: number; candidates: string[]; wins: number[][] }>('runs/b2/selection.jsonl')

let changed = 0
let toward = 0
let away = 0
for (const s of sel) {
  const g = games.get(s.seed)!
  const r = replayGame(g.options, g.journal.slice(0, s.idx), reg)
  if (r.continue.kind !== 'ask') continue
  const pick = encodeAction(stepBot(r, bot, r.continue.faction, reg).decision.action)
  if (pick === s.candidates[0]) continue
  changed++
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
  const best = s.wins.map(mean).reduce((bi, m, i, all) => (m > all[bi]! ? i : bi), 0)
  if (pick === s.candidates[best]) toward++
  else if (best === 0) away++
}
console.log(
  `${name}: ${sel.length} contested decisions; changed hard's pick in ${changed};` +
    ` toward the rollout-preferred candidate ${toward}, away from a rollout-endorsed hard pick ${away}` +
    ` — ${toward >= 3 ? 'PRE-GATE PASSES' : 'pre-gate fails'}`,
)
