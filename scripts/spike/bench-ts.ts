/**
 * Step 5, TypeScript side: replay a recorded tracker trace through the step-4 tracker, and run the
 * BFS kernel over recorded inputs. Same files, same outputs as spike/rust (`cargo run --release`).
 *
 *   node dist-spike/bench-ts.mjs <trace.txt> <bfs.txt> [iterations=30]
 *
 * Parsing is outside the timed region. Every iteration is timed as CPU of this process; the first
 * 10 are reported as warm-up. The first iteration also checks every op result against the trace.
 */
import { readFileSync } from 'node:fs'
import { contentsOf, emptyTracker, has, locationOf, move, place, register } from '@arcs/engine'
import type { Tracker } from '@arcs/engine'
import { positional } from './bfs-kernel.js'
import type { BfsBoard, BfsInput } from './bfs-kernel.js'

const [tracePath, bfsPath] = process.argv.slice(2)
const iterations = Number(process.argv[4] ?? 30)

// --- trace -----------------------------------------------------------------------------------
const text = readFileSync(tracePath!, 'utf8').split('\n')
const [nStrings] = text[0]!.split(' ').map(Number) as [number]
const strings = text.slice(1, 1 + nStrings)
const ops = Int32Array.from(text[1 + nStrings]!.trim().split(' ').map(Number))

// Last use of each handle, so replay can drop trackers as the game did.
let maxHandle = 0
const lastUse = new Map<number, number>()
const created = new Map<number, number>()
for (let i = 0; i < ops.length; ) {
  const op = ops[i]!
  const len = op === 0 ? 2 : op === 1 || op === 5 ? 5 + ops[i + 3]! : op === 4 ? 5 : 4
  if (op !== 0) lastUse.set(ops[i + 1]!, i)
  if (op === 0 || op === 1 || op === 4 || op === 5) {
    maxHandle = Math.max(maxHandle, ops[i + len - 1]!)
    if (!created.has(ops[i + len - 1]!)) created.set(ops[i + len - 1]!, i)
  }
  i += len
}
const dropAt = new Int32Array(ops.length).fill(0)
for (const [h, i] of lastUse) dropAt[i] = h
// A tracker never read again is dropped as soon as it is made.
const dropNew = new Uint8Array(ops.length)
for (const [h, i] of created) if (!lastUse.has(h)) dropNew[i] = 1

function replay(verify: boolean): number {
  const table: (Tracker | undefined)[] = new Array(maxHandle + 1)
  let sum = 0
  for (let i = 0; i < ops.length; ) {
    const op = ops[i]!
    switch (op) {
      case 0:
        table[ops[i + 1]!] = emptyTracker()
        if (dropNew[i] === 1) table[ops[i + 1]!] = undefined
        i += 2
        continue
      case 1: case 5: {
        const n = ops[i + 3]!
        const es: string[] = []
        for (let k = 0; k < n; k++) es.push(strings[ops[i + 4 + k]!]!)
        const t = table[ops[i + 1]!]!
        const out = op === 1 ? register(t, strings[ops[i + 2]!]!, { contents: es }) : place(t, es, strings[ops[i + 2]!]!)
        table[ops[i + 4 + n]!] = out
        sum = (sum * 31 + n) | 0
        if (dropAt[i] !== 0 && dropAt[i] !== ops[i + 4 + n]) table[dropAt[i]!] = undefined
        if (dropNew[i] === 1) table[ops[i + 4 + n]!] = undefined
        i += 5 + n
        continue
      }
      case 2: {
        const c = contentsOf(table[ops[i + 1]!]!, strings[ops[i + 2]!]!)
        sum = (sum * 31 + c.length) | 0
        if (verify && c.length !== ops[i + 3]) throw new Error(`contentsOf mismatch at ${i}`)
        break
      }
      case 3: {
        const l = locationOf(table[ops[i + 1]!]!, strings[ops[i + 2]!]!)
        sum = (sum * 31 + (l === undefined ? -1 : l.length)) | 0
        if (verify && (l === undefined ? -1 : strings.indexOf(l)) !== ops[i + 3]) throw new Error(`locationOf mismatch at ${i}`)
        break
      }
      case 4: {
        const out = move(table[ops[i + 1]!]!, strings[ops[i + 2]!]!, strings[ops[i + 3]!]!)
        table[ops[i + 4]!] = out
        sum = (sum * 31 + 1) | 0
        if (dropAt[i] !== 0 && dropAt[i] !== ops[i + 4]) table[dropAt[i]!] = undefined
        if (dropNew[i] === 1) table[ops[i + 4]!] = undefined
        i += 5
        continue
      }
      case 6: {
        const b = has(table[ops[i + 1]!]!, strings[ops[i + 2]!]!)
        sum = (sum * 31 + (b ? 1 : 0)) | 0
        if (verify && (b ? 1 : 0) !== ops[i + 3]) throw new Error(`has mismatch at ${i}`)
        break
      }
      default:
        throw new Error(`bad op ${op} at ${i}`)
    }
    if (dropAt[i] !== 0) table[dropAt[i]!] = undefined
    i += 4
  }
  return sum >>> 0
}

// --- BFS ---------------------------------------------------------------------------------------
const boards: BfsBoard[] = []
const cases: { input: BfsInput; want: [number, number] }[] = []
{
  const L = readFileSync(bfsPath!, 'utf8').split('\n')
  for (let i = 0; i < L.length; ) {
    const w = L[i]!.split(' ')
    if (w[0] === 'B') {
      const n = Number(w[2])
      const systems: string[] = []
      const gate = new Map<string, boolean>()
      const adj = new Map<string, string[]>()
      for (let k = 1; k <= n; k++) {
        const v = L[i + k]!.split(' ')
        systems.push(v[0]!)
        gate.set(v[0]!, v[1] === '1')
        adj.set(v[0]!, v.slice(3, 3 + Number(v[2])))
      }
      boards[Number(w[1])] = { systems, gate, adj }
      i += n + 1
    } else if (w[0] === 'C') {
      const board = boards[Number(w[1])]!
      const S = L[i + 1]!.split(' '), D = L[i + 2]!.split(' '), U = L[i + 3]!.split(' '), K = L[i + 4]!.split(' ')
      const ships = [...Array(Number(S[1])).keys()].map((k) => ({ id: S[2 + 2 * k]!, system: S[3 + 2 * k]! }))
      const colors = new Map<string, Set<string>>()
      const resource = new Map<string, boolean>()
      let p = 1
      for (const s of board.systems) {
        const n = Number(K[p++])
        colors.set(s, new Set(K.slice(p, p + n)))
        p += n
        resource.set(s, K[p++] === '1')
      }
      cases.push({
        input: { board, self: w[2]!, ships, damaged: D.slice(2, 2 + Number(D[1])), built: U.slice(2, 2 + Number(U[1])), colors, resource },
        want: [Number(w[3]), Number(w[4])],
      })
      i += 5
    } else i++
  }
}
// Interned like the engine's strings: every equal id is one string object.
function bfsAll(verify: boolean): number {
  let sum = 0
  for (const c of cases) {
    const r = positional(c.input)
    if (verify && (r.gatesHeld !== c.want[0] || r.fleetThreat !== c.want[1])) throw new Error('bfs mismatch')
    sum = (sum * 31 + r.gatesHeld * 7 + r.fleetThreat) | 0
  }
  return sum >>> 0
}

// --- timing ------------------------------------------------------------------------------------
const cpu = (f: () => number): [number, number] => {
  const t = process.cpuUsage()
  const v = f()
  const c = process.cpuUsage(t)
  return [(c.user + c.system) / 1000, v]
}
let nOps = 0
for (let i = 0; i < ops.length; nOps++) {
  const op = ops[i]!
  i += op === 0 ? 2 : op === 1 || op === 5 ? 5 + ops[i + 3]! : op === 4 ? 5 : 4
}
const traceCheck = replay(true)
const bfsCheck = bfsAll(true)
const traceMs: number[] = []
const bfsMs: number[] = []
for (let k = 0; k < iterations; k++) {
  const [a, va] = cpu(() => replay(false))
  const [b, vb] = cpu(() => bfsAll(false))
  if (va !== traceCheck || vb !== bfsCheck) throw new Error('checksum drift')
  traceMs.push(a)
  bfsMs.push(b)
}
console.log(JSON.stringify({ lang: 'ts', ops: nOps, bfsCases: cases.length, traceCheck, bfsCheck, traceMs: traceMs.map((x) => +x.toFixed(2)), bfsMs: bfsMs.map((x) => +x.toFixed(2)) }))
