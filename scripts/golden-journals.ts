/**
 * Golden journals: the speed work must not change a single bot decision.
 *
 *   npm run golden -- --record <name>   # play one planned game, write runs/golden/<name>.json
 *   npm run golden -- --assemble        # merge runs/golden/*.json into the committed fixture
 *   npm run golden [-- --only=<prefix>] # re-play fixture games and diff journals + power
 *   npm run golden -- --list            # the planned game names, for `xargs -P`
 *
 * Recording is one game per process so the fixture can be built across cores:
 *   npm run -s golden -- --list | xargs -P 14 -I{} npm run -s golden -- --record {}
 *
 * The fixture must be recorded on a commit whose bots are the reference (before an optimisation),
 * because the check compares every decision, not just winners.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { botForLevel, defaultRegistry, runBots, startGame } from '@arcs/engine'
import type { FactionId, NewGameOptions } from '@arcs/engine'

const PATH = 'packages/engine/test/fixtures/golden-journals.json'
const RUNS = 'runs/golden'
type Level = 'normal' | 'hard'
interface Planned { name: string; options: NewGameOptions; level: Level }
interface Golden extends Planned { journal: string[]; power: Record<string, number> }

const F4: FactionId[] = ['red', 'yellow', 'blue', 'white']
const F2: FactionId[] = ['red', 'yellow']
const plan: Planned[] = []
const add = (prefix: string, n: number, level: Level, board: string, factions: FactionId[], seed: number): void => {
  for (let i = 0; i < n; i++) plan.push({ name: `${prefix}-${i}`, level, options: { board, factions, seed: seed + i, bots: factions } })
}
add('n2', 10, 'normal', 'Board2Frontiers', F2, 9000)
add('n4', 10, 'normal', 'Board4MixUp1', F4, 9100)
add('h2', 3, 'hard', 'Board2Frontiers', F2, 9200)
add('h4', 3, 'hard', 'Board4MixUp1', F4, 9300)

function play(p: Planned): { journal: string[]; power: Record<string, number> } {
  const reg = defaultRegistry()
  const out = runBots(startGame(p.options, reg), p.options.factions, botForLevel(p.level), reg, 50_000)
  return { journal: [...out.result.state.journal], power: { ...out.result.state.power } as Record<string, number> }
}

const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const only = argv.find((a) => a.startsWith('--only='))?.slice(7)

if (argv.includes('--list')) {
  for (const p of plan) console.log(p.name)
} else if (arg('record') !== undefined) {
  const p = plan.find((x) => x.name === arg('record'))
  if (p === undefined) throw new Error(`no planned game ${arg('record')}`)
  const t = Date.now()
  const r = play(p)
  mkdirSync(RUNS, { recursive: true })
  writeFileSync(`${RUNS}/${p.name}.json`, JSON.stringify({ ...p, ...r }))
  console.log(`${p.name}: ${r.journal.length} entries, ${Date.now() - t} ms`)
} else if (argv.includes('--assemble')) {
  const have = new Set(readdirSync(RUNS))
  const games: Golden[] = plan.map((p) => {
    if (!have.has(`${p.name}.json`)) throw new Error(`missing ${p.name}; record it first`)
    return JSON.parse(readFileSync(`${RUNS}/${p.name}.json`, 'utf8')) as Golden
  })
  writeFileSync(PATH, JSON.stringify({ games }) + '\n')
  console.log(`${games.length} games -> ${PATH}`)
} else {
  const { games } = JSON.parse(readFileSync(PATH, 'utf8')) as { games: Golden[] }
  let bad = 0
  for (const g of games) {
    if (only !== undefined && !g.name.startsWith(only)) continue
    const t = Date.now()
    const r = play(g)
    const i = r.journal.findIndex((e, k) => e !== g.journal[k])
    const same =
      i === -1 && r.journal.length === g.journal.length && JSON.stringify(r.power) === JSON.stringify(g.power)
    if (!same) bad++
    console.log(`${same ? 'ok  ' : 'DIFF'} ${g.name} ${Date.now() - t}ms${same ? '' : ` first diff at ${i === -1 ? Math.min(r.journal.length, g.journal.length) : i}`}`)
  }
  process.exit(bad === 0 ? 0 : 1)
}
