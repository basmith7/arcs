/**
 * Extract `positionalUncached` inputs from replayed golden `normal` games (every `every`-th
 * journal step, every faction), check the kernel against the engine function on each, and write
 * them in a line format both the TS and Rust benches read.
 *
 *   node dist-spike/bfs-record.mjs <out.txt> [every=5]
 *
 * Format: "B <boardIdx> <nSys>" then per system "<sys> <gate> <nAdj> <adj...>"; then per case
 * "C <boardIdx> <self> <expectGates> <expectThreat>", "S <n> <id sys>...", "D <n> <ids>...",
 * "U <n> <systems>...", "K" + per system "<ncolors> <colors...> <resource 0|1>" in board order.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  applyExternal, connectedSystems, decodeAction, defaultRegistry, observe,
  planetResource, positionalUncached, startGame, system as systemInfo,
} from '@arcs/engine'
import type { NewGameOptions } from '@arcs/engine'
import { colorsIn, figuresOf } from '../../packages/engine/src/figure-index.js'
import { positional } from './bfs-kernel.js'
import type { BfsBoard } from './bfs-kernel.js'

const out = process.argv[2] ?? 'runs-spike/trace/bfs.txt'
const every = Number(process.argv[3] ?? 5)
interface Golden { name: string; options: NewGameOptions; level: string; journal: string[] }
const { games } = JSON.parse(readFileSync('packages/engine/test/fixtures/golden-journals.json', 'utf8')) as { games: Golden[] }
const registry = defaultRegistry()
const boards = new Map<string, { idx: number; b: BfsBoard }>()
const lines: string[] = []
let cases = 0
for (const g of games.filter((x) => x.level === 'normal')) {
  let r = startGame(g.options, registry)
  for (let i = 0; i <= g.journal.length; i++) {
    if (i % every === 0) {
      for (const self of r.state.factions) {
        const o = observe(r.state, self)
        const key = o.board.name
        let bb = boards.get(key)
        if (bb === undefined) {
          const b: BfsBoard = {
            systems: o.board.systems,
            gate: new Map(o.board.systems.map((s) => [s, systemInfo(s).isGate === true])),
            adj: new Map(o.board.systems.map((s) => [s, [...connectedSystems(o.board, s)]])),
          }
          bb = { idx: boards.size, b }
          boards.set(key, bb)
          lines.push(`B ${bb.idx} ${b.systems.length}`)
          for (const s of b.systems) lines.push(`${s} ${b.gate.get(s) ? 1 : 0} ${b.adj.get(s)!.length} ${b.adj.get(s)!.join(' ')}`)
        }
        const systems = o.board.systems
        const input = {
          board: bb.b, self,
          ships: figuresOf(o.figures, systems, self, 'Ship').map((p) => ({ id: p.id, system: p.system })),
          damaged: [...o.damaged],
          built: [...figuresOf(o.figures, systems, self, 'City'), ...figuresOf(o.figures, systems, self, 'Starport')].map((p) => p.system),
          colors: new Map(systems.map((s) => [s, colorsIn(o.figures, systems, s)] as const)),
          resource: new Map(systems.map((s) => [s, planetResource(o, s) !== undefined] as const)),
        }
        const want = positionalUncached(o, self)
        const got = positional(input)
        if (want.gatesHeld !== got.gatesHeld || want.fleetThreat !== got.fleetThreat) throw new Error(`kernel mismatch ${g.name}@${i}/${self}`)
        for (const id of [...input.damaged, ...input.ships.map((p) => p.id)]) if (/\s/.test(id)) throw new Error(`space in id ${id}`)
        lines.push(`C ${bb.idx} ${self} ${want.gatesHeld} ${want.fleetThreat}`)
        // Token lists joined once, so an empty list never leaves a double space.
        const line = (...w: (string | number)[]): number => lines.push(w.join(' '))
        line('S', input.ships.length, ...input.ships.flatMap((p) => [p.id, p.system]))
        line('D', input.damaged.length, ...input.damaged)
        line('U', input.built.length, ...input.built)
        line('K', ...systems.flatMap((s) => { const c = [...input.colors.get(s)!]; return [c.length, ...c, input.resource.get(s) ? 1 : 0] }))
        cases++
      }
    }
    if (i < g.journal.length) r = applyExternal(r, decodeAction(g.journal[i]!), registry)
  }
}
writeFileSync(out, lines.join('\n') + '\n')
console.log(JSON.stringify({ cases, boards: boards.size, out }))
