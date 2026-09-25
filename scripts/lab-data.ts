/**
 * The numbers behind the lab page (`scripts/lab-ui.ts`), as pure functions over the lab's own
 * output files — so they can be tested on sample lines and never touch a running experiment.
 */
import { existsSync, readFileSync } from 'node:fs'

import { pairedGate } from '@arcs/engine'
import type { GameOutcome, GateResult } from '@arcs/engine'

interface Selected { key: string; seed: number; rule: number }
interface Evaluated { key: string; hard: number[]; rule: number[] }

export interface B2Point { readonly n: number; readonly mean: number; readonly se: number }
export interface B2Stats {
  readonly target: number
  readonly selected: number
  readonly flips: number
  readonly evaluated: number
  /** Decisions with a held-out answer: every kept-hard decision, plus every evaluated flip. */
  readonly scored: number
  readonly mean: number
  readonly se: number
  readonly falseFlips: number
  readonly trajectory: readonly B2Point[]
}

const parse = <T>(lines: readonly string[]): T[] => lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as T)

/** Net held-out win-share gain per decision, clustered by game — the B2 report's statistic. */
function clustered(rows: readonly { seed: number; gain: number }[]): { mean: number; se: number } {
  const n = rows.length
  if (n === 0) return { mean: 0, se: 0 }
  const mean = rows.reduce((a, r) => a + r.gain, 0) / n
  const bySeed = new Map<number, number[]>()
  for (const r of rows) bySeed.set(r.seed, [...(bySeed.get(r.seed) ?? []), r.gain])
  const G = bySeed.size
  if (G < 2) return { mean, se: 0 }
  let v = 0
  for (const gs of bySeed.values()) v += (gs.reduce((a, b) => a + b, 0) - mean * gs.length) ** 2
  return { mean, se: Math.sqrt((G / (G - 1)) * v) / n }
}

export function b2Stats(selectionLines: readonly string[], evaluationLines: readonly string[], target: number): B2Stats {
  const sel = parse<Selected>(selectionLines)
  const ev = new Map(parse<Evaluated>(evaluationLines).map((e) => [e.key, e]))
  const avg = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
  const rows: { seed: number; gain: number }[] = []
  const trajectory: B2Point[] = []
  let falseFlips = 0
  for (const s of sel) {
    let gain: number | undefined
    if (s.rule === 0) gain = 0
    else {
      const e = ev.get(s.key)
      if (e !== undefined) {
        gain = avg(e.rule) - avg(e.hard)
        if (gain < 0) falseFlips++
      }
    }
    if (gain === undefined) continue
    rows.push({ seed: s.seed, gain })
    const c = clustered(rows)
    trajectory.push({ n: rows.length, mean: c.mean, se: c.se })
  }
  const c = clustered(rows)
  return {
    target,
    selected: sel.length,
    flips: sel.filter((s) => s.rule !== 0).length,
    evaluated: sel.filter((s) => s.rule !== 0 && ev.has(s.key)).length,
    scored: rows.length,
    mean: c.mean,
    se: c.se,
    falseFlips,
    trajectory,
  }
}

const lines = (f: string): string[] => (existsSync(f) ? readFileSync(f, 'utf8').split('\n') : [])

export function b2FromDisk(dir = 'runs/b2', target = 150): B2Stats {
  return b2Stats(lines(`${dir}/selection.jsonl`), lines(`${dir}/evaluation.jsonl`), target)
}

/** One idea's measured outcome, as the page's table row. */
export interface IdeaRow {
  readonly id: string
  readonly idea: string
  readonly against: string
  readonly probe: string
  readonly gate?: GateResult
  readonly verdict: 'pass' | 'not detected' | 'worse' | 'probe failed' | 'running' | 'pending' | 'shipped, no pass'
  readonly note?: string
}

/** Pairs the challenger (B) against the control (A) across a gate's chunk files. */
export function gateOf(files: readonly string[]): GateResult | undefined {
  const outcomes = files
    .filter(existsSync)
    .flatMap((f) => parse<GameOutcome>(readFileSync(f, 'utf8').split('\n')))
  return outcomes.length === 0 ? undefined : pairedGate(outcomes, 'B', 'A')
}
