/**
 * Tables for docs/spikes/2026-09-strategies.md from runs/strategies/*: probes, gates, the mixed
 * field, and the exploratory setup splits. Reads only; prints markdown.
 *
 *   npx vite-node scripts/strategy-report.ts
 */
import { existsSync, readFileSync } from 'node:fs'

import { CardLocation, contentsOf, defaultRegistry, pairedGate, parseCardId, reportFrom, startGame } from '@arcs/engine'
import type { FactionId, GameOutcome } from '@arcs/engine'

const DIR = 'runs/strategies'
const F4: FactionId[] = ['red', 'yellow', 'blue', 'white']
const NAMES = ['warlord', 'builder', 'court'] as const
type Name = (typeof NAMES)[number]
const PLAN: Record<Name, readonly string[]> = { warlord: ['Warlord', 'Tyrant'], builder: ['Tycoon'], court: ['Keeper', 'Empath'] }
/** Card strengths that can declare each plan's ambitions (Tycoon 2, Tyrant 3, Warlord 4, Keeper 5, Empath 6; 7 any). */
const DECLARES: Record<Name, readonly number[]> = { warlord: [3, 4, 7], builder: [2, 7], court: [5, 6, 7] }
const MIXED_ID: Record<string, Name | 'hard'> = { W: 'warlord', B: 'builder', C: 'court', H: 'hard' }

const lines = (f: string): GameOutcome[] =>
  existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as GameOutcome) : []
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`
const sign = (x: number, d = 1): string => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`
const state = existsSync(`${DIR}/state.json`) ? (JSON.parse(readFileSync(`${DIR}/state.json`, 'utf8')) as { steps: Record<string, string>; config: Record<string, string> }) : { steps: {}, config: {} }
const out: string[] = []
const p = (s = ''): void => void out.push(s)

// ---- probes
type Tally = { offered: Record<string, number>; taken: Record<string, number>; decisions: number }
p('## Probes (100 4p games each, seed 91000, `A=hard,B=strat,B=strat,A=hard`)\n')
p('| strategy | config | unfinished | declares/seat-game (strat / hard) | plan share of declares (strat / hard) | Battle take rate (strat / hard) | Influence take rate (strat / hard) | verdict |')
p('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const name of NAMES) {
  for (const key of [name, `${name}-0.95`]) {
    const f = `${DIR}/probe-${key}.json`
    if (!existsSync(f)) continue
    const j = JSON.parse(readFileSync(f, 'utf8')) as { games: number; unfinished: number; tallies: Record<string, Tally> }
    const [a, b] = [j.tallies['A']!, j.tallies['B']!]
    const decl = (t: Tally): number => Object.entries(t.taken).filter(([k]) => k.startsWith('declare:')).reduce((n, [, v]) => n + v, 0)
    const share = (t: Tally): number => PLAN[name].reduce((n, x) => n + (t.taken[`declare:${x}`] ?? 0), 0) / Math.max(1, decl(t))
    const rate = (t: Tally, k: string): number => (t.taken[k] ?? 0) / Math.max(1, t.offered[k] ?? 0)
    const seatGames = 2 * j.games
    p(`| ${name} | ${key.endsWith('0.95') ? 'commitment 0.95' : 'commitment 0.85'} | ${j.unfinished} | ${(decl(b) / seatGames).toFixed(2)} / ${(decl(a) / seatGames).toFixed(2)} | ${pct(share(b))} / ${pct(share(a))} | ${pct(rate(b, 'take:Battle'))} / ${pct(rate(a, 'take:Battle'))} | ${pct(rate(b, 'take:Influence'))} / ${pct(rate(a, 'take:Influence'))} | ${state.config[name] === (key.endsWith('0.95') ? `strat:${name}:0.95` : `strat:${name}`) ? state.steps[`probe-${name}`] ?? '' : 'retried'} |`)
    // Every ambition, for the record.
    const by = (t: Tally): string => ['Tycoon', 'Tyrant', 'Warlord', 'Keeper', 'Empath'].map((x) => `${x} ${t.taken[`declare:${x}`] ?? 0}`).join(', ')
    out.push(`<!-- ${key}: strat declares ${by(b)}; hard declares ${by(a)} -->`)
  }
}

// ---- gates
const fmtGate = (g: ReturnType<typeof pairedGate>): string =>
  `${sign(100 * g.winDiff)} ± ${(100 * g.winSe).toFixed(1)} (z ${g.winZ.toFixed(2)}) | ${sign(g.powerDiff, 2)} ± ${g.powerSe.toFixed(2)} (z ${g.powerZ.toFixed(2)})`
const winsPerSeat = (os: readonly GameOutcome[], id: string): string => {
  let n = 0
  let w = 0
  for (const o of os) for (const f of F4) if (o.finished && o.seats[f] === id) { n++; if (o.winner === f) w++ }
  return pct(w / Math.max(1, n))
}
p('\n## Gates (4p, A,B,B,A, clustered by deal; win Δ is per side, power Δ per seat)\n')
for (const name of NAMES) {
  const files = [0, 1, 2, 3].map((k) => `${DIR}/gate-${name}-${k}.jsonl`).filter(existsSync)
  if (files.length === 0) { p(`**${name}**: ${state.steps[`gate-${name}`] ?? 'not run'}\n`); continue }
  p(`**${name}** (${state.config[name]}) — ${state.steps[`gate-${name}`] ?? 'running'}\n`)
  p('| chunk | games (deals) | strat / hard wins per seat | win share Δ per side | power Δ per seat |')
  p('| --- | --- | --- | --- | --- |')
  const all: GameOutcome[] = []
  files.forEach((f, k) => {
    const os = lines(f)
    all.push(...os)
    const g = pairedGate(os, 'B', 'A')
    p(`| ${k} | ${g.games} (${g.units}) | ${winsPerSeat(os, 'B')} / ${winsPerSeat(os, 'A')} | ${fmtGate(g).split(' | ').join(' | ')} |`)
  })
  const g = pairedGate(all, 'B', 'A')
  p(`| **pooled** | **${g.games} (${g.units})** | ${winsPerSeat(all, 'B')} / ${winsPerSeat(all, 'A')} | **${fmtGate(g).split(' | ')[0]}** | **${fmtGate(g).split(' | ')[1]}** |\n`)
}

// ---- mixed field
const tableFor = (os: readonly GameOutcome[], title: string): void => {
  if (os.length === 0) return
  const r = reportFrom(os, ['W', 'B', 'C', 'H'], F4, 0)
  p(`${title} — ${r.finished} of ${os.length} finished\n`)
  p('| bot | seat-games | wins | outright | mean rank | mean power | vs `hard`: win Δ | vs `hard`: power Δ |')
  p('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const rec of [...r.records].sort((a, b) => 'WBCH'.indexOf(a.id) - 'WBCH'.indexOf(b.id))) {
    const g = rec.id === 'H' ? undefined : pairedGate(os, rec.id, 'H')
    p(`| ${MIXED_ID[rec.id]} | ${rec.games} | ${pct(rec.wins / rec.games)} | ${pct(rec.outrightWins / rec.games)} | ${rec.meanRank.toFixed(2)} | ${rec.meanPower.toFixed(2)} | ${g === undefined ? '—' : fmtGate(g).split(' | ')[0]} | ${g === undefined ? '—' : fmtGate(g).split(' | ')[1]} |`)
  }
  p()
}
p('\n## Mixed field (one seat each, rotated through all seats; Δ vs `hard` is paired by deal)\n')
tableFor(lines(`${DIR}/mixed.jsonl`), '**Board4MixUp1, 1,600 games (confirmatory: M1-M3)**')

// ---- setup splits (exploratory)
interface SeatGame { bot: Name | 'hard'; source: string; board: string; seed: number; faction: FactionId; won: boolean; power: number; hand: readonly string[]; leader?: string }
const reg = defaultRegistry()
const hands = new Map<string, Record<string, readonly string[]>>()
const handsFor = (board: string, seed: number): Record<string, readonly string[]> => {
  const key = `${board}:${seed}`
  let h = hands.get(key)
  if (h === undefined) {
    const s = startGame({ board, factions: F4, seed, bots: F4 }, reg).state
    h = Object.fromEntries(F4.map((f) => [f, contentsOf(s.cards, CardLocation.hand(f))]))
    hands.set(key, h)
  }
  return h
}
const seatGames: SeatGame[] = []
const collect = (os: readonly GameOutcome[], source: string, board: string, idOf: (id: string) => Name | 'hard' | undefined, withHands: boolean): void => {
  for (const o of os) {
    if (!o.finished) continue
    for (const f of F4) {
      const bot = idOf(o.seats[f] ?? '')
      if (bot === undefined) continue
      seatGames.push({
        bot, source, board, seed: o.seed, faction: f, won: o.winner === f, power: o.power[f] ?? 0,
        hand: withHands ? handsFor(board, o.seed)[f]! : [],
        ...(o.leaders?.[f] === undefined ? {} : { leader: o.leaders[f]! }),
      })
    }
  }
}
for (const name of NAMES) {
  for (let k = 0; k < 4; k++) collect(lines(`${DIR}/gate-${name}-${k}.jsonl`), `gate-${name}`, 'Board4MixUp1', (id) => (id === 'B' ? name : id === 'A' ? 'hard' : undefined), true)
}
collect(lines(`${DIR}/mixed.jsonl`), 'mixed', 'Board4MixUp1', (id) => MIXED_ID[id], true)
for (const board of ['Board4MixUp2', 'Board4Frontiers', 'Board4MixUp3']) collect(lines(`${DIR}/explore-${board}.jsonl`), 'explore', board, (id) => MIXED_ID[id], true)
collect(lines(`${DIR}/explore-leaders.jsonl`), 'leaders', 'Board4MixUp1+L&L', (id) => MIXED_ID[id], false)

p('\n## Setup-dependence — EXPLORATORY (no tests; cells are descriptive)\n')
p('Win share per seat-game (chance = 25%). Each strategy is shown beside `hard` *in the same games* (its gate games plus the mixed field), so a cell compares like with like.\n')
const cell = (xs: readonly SeatGame[]): string => (xs.length === 0 ? '—' : `${pct(xs.filter((x) => x.won).length / xs.length)} (${xs.length})`)
const splitTable = (title: string, key: (g: SeatGame, name: Name) => string | undefined, order?: readonly string[]): void => {
  p(`**${title}** — win share (seat-games)\n`)
  p('| strategy | cell | strategy | `hard` in the same games | Δ |')
  p('| --- | --- | --- | --- | --- |')
  for (const name of NAMES) {
    const sources = new Set([`gate-${name}`, 'mixed'])
    const mine = seatGames.filter((g) => sources.has(g.source) && g.bot === name)
    const hard = seatGames.filter((g) => sources.has(g.source) && g.bot === 'hard')
    const cells = order ?? [...new Set(mine.map((g) => key(g, name)).filter((k): k is string => k !== undefined))].sort()
    for (const c of cells) {
      const a = mine.filter((g) => key(g, name) === c)
      const b = hard.filter((g) => key(g, name) === c)
      const d = a.length && b.length ? sign(100 * (a.filter((x) => x.won).length / a.length - b.filter((x) => x.won).length / b.length)) + ' pts' : '—'
      p(`| ${name} | ${c} | ${cell(a)} | ${cell(b)} | ${d} |`)
    }
  }
  p()
}
splitTable('By seat (red leads first)', (g) => g.faction, F4)
splitTable('By plan-declaring cards in the opening hand (strengths that can declare the strategy\'s plan)', (g, name) => {
  const n = g.hand.filter((c) => DECLARES[name].includes(parseCardId(c).strength)).length
  return n >= 3 ? '3+' : String(n)
}, ['0', '1', '2', '3+'])
splitTable('By majority suit of the opening hand', (g) => {
  const counts = new Map<string, number>()
  for (const c of g.hand) counts.set(parseCardId(c).suit, (counts.get(parseCardId(c).suit) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return top.length === 0 ? undefined : top[1] !== undefined && top[1][1] === top[0]![1] ? 'tied' : top[0]![0]
})

p('**By board** (mixed-field runs; Board4MixUp1 is the confirmatory 1,600, the others 400 each) — win share (seat-games)\n')
p('| board | warlord | builder | court | hard |')
p('| --- | --- | --- | --- | --- |')
for (const board of ['Board4MixUp1', 'Board4MixUp2', 'Board4Frontiers', 'Board4MixUp3']) {
  const src = board === 'Board4MixUp1' ? 'mixed' : 'explore'
  const at = seatGames.filter((g) => g.source === src && g.board === board)
  if (at.length === 0) continue
  p(`| ${board} | ${(['warlord', 'builder', 'court', 'hard'] as const).map((b) => cell(at.filter((g) => g.bot === b))).join(' | ')} |`)
}
p()
for (const board of ['Board4MixUp2', 'Board4Frontiers', 'Board4MixUp3']) tableFor(lines(`${DIR}/explore-${board}.jsonl`), `Exploratory mixed field, ${board}, 400 games`)
tableFor(lines(`${DIR}/explore-leaders.jsonl`), 'Exploratory mixed field, Board4MixUp1 with Leaders & Lore (1 lore each), 400 games')

const led = seatGames.filter((g) => g.source === 'leaders' && g.leader !== undefined)
if (led.length > 0) {
  p('**By leader** (Leaders & Lore run; bots draft their own leaders) — win share (seat-games)\n')
  p('| leader | warlord | builder | court | hard |')
  p('| --- | --- | --- | --- | --- |')
  for (const l of [...new Set(led.map((g) => g.leader!))].sort()) {
    p(`| ${l} | ${(['warlord', 'builder', 'court', 'hard'] as const).map((b) => cell(led.filter((g) => g.leader === l && g.bot === b))).join(' | ')} |`)
  }
  p()
}

console.log(out.join('\n'))
