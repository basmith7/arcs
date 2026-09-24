/**
 * "What should I do?" for a seat a human is playing (spec 2026-09-23 rev 3, section B3).
 *
 *   npm run advise -- <gameId | save.json> <faction> [--cores N] [--oracle]
 *
 * Reads a save file, or a live game's options and journal from Tower over ssh with
 * `sqlite3 -readonly` — never a write. Replays, and if it is `faction`'s decision prints `hard`'s
 * analysis: every root it weighed, labelled by the horizon it was valued at (tier-1 = its own
 * turn; reply-checked = after a sampled rival reply — the two are not on one scale), then the rest
 * of the turn as `hard` would play it.
 *
 * `--oracle` adds full-game rollouts of the leading candidates across cores. It is only switched on
 * by the B2 power test (`ORACLE_VERDICT` below): until that test shows rollouts improve on
 * `hard`'s pick, the flag says so and does nothing else.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'

import {
  botForLevel,
  defaultRegistry,
  encodeAction,
  loadGame,
  replayGame,
  stepBot,
} from '@arcs/engine'
import type { Action, AskedThisTurn, FactionId, NewGameOptions, RuleResult } from '@arcs/engine'

import { evaluate, meanSe, paired } from './oracle-lib.js'

/**
 * The B2 verdict (docs/19): `undefined` until the power test passes, then the section that
 * recorded it. While undefined the advisor never lets rollouts override `hard`.
 */
const ORACLE_VERDICT: string | undefined = undefined
const NOT_DETECTED = 'rollout check: not detected to help — the offline power test (spec B2) has not passed'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--cores'))
const [source, factionArg] = positional
if (source === undefined || factionArg === undefined) {
  console.error('usage: npm run advise -- <gameId | save.json> <faction> [--cores N] [--oracle]')
  process.exit(2)
}
const faction = factionArg as FactionId
const cores = Number(flag('cores') ?? Math.max(1, availableParallelism() - 2))

const DB = '/mnt/cache/appdata/arcs/arcs.db'

function fromTower(id: string): { options: NewGameOptions; journal: string[] } {
  // The id is interpolated into SQL on the far side, so it must be exactly a UUID.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`not a game id: ${id}`)
  }
  const query = (sql: string): string =>
    execFileSync('ssh', ['tower', `sqlite3 -readonly -json ${DB} "${sql}"`], { encoding: 'utf8' })
  const game = JSON.parse(query(`select options from game where id='${id}'`) || '[]') as { options: string }[]
  if (game.length === 0) throw new Error(`no game ${id} on Tower`)
  const rows = JSON.parse(
    query(`select action from journal where game_id='${id}' order by idx`) || '[]',
  ) as { action: string }[]
  return { options: JSON.parse(game[0]!.options) as NewGameOptions, journal: rows.map((r) => r.action) }
}

function load(): { options: NewGameOptions; journal: string[] } {
  if (source!.endsWith('.json')) {
    const { options, result } = loadGame(readFileSync(source!, 'utf8'))
    return { options, journal: [...result.state.journal] }
  }
  return fromTower(source!)
}

const label = (a: Action): string => String(a['label'] ?? a.type)
const registry = defaultRegistry()
const hard = botForLevel('hard')

let loaded: { options: NewGameOptions; journal: string[] }
try {
  loaded = load()
} catch (e) {
  console.log(`could not load ${source}: ${(e as Error).message.split('\n')[0]}`)
  process.exit(1)
}
const { options, journal } = loaded
let result: RuleResult
try {
  result = replayGame(options, journal, registry)
} catch (e) {
  // Find the entry that broke, so the message points somewhere.
  let n = 0
  for (; n <= journal.length; n++) {
    try {
      replayGame(options, journal.slice(0, n), registry)
    } catch {
      break
    }
  }
  console.log(`journal failed to replay at entry ${n - 1}: ${(e as Error).message}`)
  process.exit(1)
}

const s = result.state
console.log(`${options.board}, chapter ${s.chapter} round ${s.round}, ${journal.length} journal entries`)
console.log(`power: ${s.factions.map((f) => `${f} ${s.power[f] ?? 0}`).join(', ')}`)
if (s.isOver) {
  console.log(`game over — winner ${s.winners.join(', ')}`)
  process.exit(0)
}
const c = result.continue
if (c.kind !== 'ask' || c.faction !== faction) {
  const who = c.kind === 'ask' ? `${c.faction}${c.prompt === undefined ? '' : ` (${c.prompt})`}` : c.kind
  console.log(`not ${faction}'s decision — waiting on ${who}`)
  process.exit(0)
}

// The first decision, with hard's reasoning in full.
let asked: AskedThisTurn | undefined
const first = stepBot(result, hard, faction, registry)
console.log(`\n${faction} to act${c.prompt === undefined ? '' : `: ${c.prompt}`}`)
const considered = [...(first.decision.considered ?? [])].sort((a, b) => b.score - a.score)
if (considered.length > 0) {
  console.log('hard weighed:')
  for (const k of considered) {
    const horizon = String(k.note ?? '').includes('after replies') ? 'reply-checked' : 'tier-1'
    const mark = k.action === first.decision.action ? ' <' : ''
    console.log(`  ${label(k.action).padEnd(34)} ${k.score.toFixed(2).padStart(7)}  [${horizon}]${mark}`)
  }
}

if (argv.includes('--oracle')) {
  if (ORACLE_VERDICT === undefined) {
    console.log(`\n${NOT_DETECTED}`)
  } else {
    const tier1 = considered.filter((k) => !String(k.note ?? '').includes('after replies'))
    const picks = [first.decision.action, ...tier1.map((k) => k.action)]
      .filter((a, i, all) => all.findIndex((b) => encodeAction(b) === encodeAction(a)) === i)
      .slice(0, 4)
    const salts = [...Array(32).keys()]
    console.log(`\nrollouts (${ORACLE_VERDICT}): ${picks.length} candidates x ${salts.length} worlds on ${cores} cores…`)
    const cells = await evaluate(
      { options, journal, self: faction, candidates: picks.map(encodeAction), salts, policy: 'normal', horizon: 'game' },
      cores,
    )
    const wins = cells.map((row) => row.map((x) => x.win))
    let chosen = 0
    let bestZ = 1.0 // the B2 selection rule: displace hard's pick only at paired z >= 1
    picks.forEach((a, i) => {
      const { mean, se } = meanSe(wins[i]!)
      const p = i === 0 ? undefined : paired(wins[i]!, wins[0]!)
      if (p !== undefined && p.z >= bestZ) {
        bestZ = p.z
        chosen = i
      }
      console.log(
        `  ${label(a).padEnd(34)} win ${(100 * mean).toFixed(0).padStart(3)}% ± ${(100 * se).toFixed(0)}` +
          (p === undefined ? '  (hard’s pick)' : `  vs hard ${(100 * p.mean).toFixed(0)} pts, z ${p.z.toFixed(2)}`),
      )
    })
    console.log(chosen === 0 ? 'rollouts keep hard’s pick' : `rollouts prefer: ${label(picks[chosen]!)}`)
  }
}

// The rest of the turn, as hard would play it.
console.log(`\nthe line:`)
let at = first.result
asked = first.asked
console.log(`  - ${label(first.decision.action)} | ${first.decision.because}`)
const turnOf = (r: RuleResult): string => `${r.state.chapter}:${r.state.round}`
const turn = turnOf(result)
for (let i = 0; i < 60; i++) {
  const k = at.continue
  if (k.kind !== 'ask' || k.faction !== faction || turnOf(at) !== turn || at.state.isOver) break
  const step = stepBot(at, hard, faction, registry, asked)
  console.log(`  - ${label(step.decision.action)} | ${step.decision.because}`)
  at = step.result
  asked = step.asked
}
