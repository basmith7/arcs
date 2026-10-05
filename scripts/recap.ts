/**
 * A scoreboard for a game in progress: where everyone stands, the ambition races, and what each
 * player looks to be going for, followed by the log grouped by round to write a story from.
 *
 *   npm run recap -- <gameId | save.json> [--public]
 *
 * Spike (2026-10-04): a private report, to find out what an in-game scoreboard panel should show.
 * Reads a live game from Tower over ssh with `sqlite3 -readonly`, exactly as `advise` does — never a
 * write. It prints every hand unless `--public` is given; the panel could only show the public view.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
  AMBITIONS,
  Location,
  ScoreAmbitions,
  contentsOf,
  courtCard,
  defaultRegistry,
  loadGame,
  metric,
  parseFigureId,
  parseResourceToken,
  perform,
  planetResource,
  replayGame,
  rules,
  securedCards,
} from '@arcs/engine'
import type { FactionId, GameState, NewGameOptions } from '@arcs/engine'

const argv = process.argv.slice(2)
const source = argv.find((a) => !a.startsWith('--'))
const story = argv.includes('--story')
// The story is written from the public view only: what a table of players could all see.
const showHands = !argv.includes('--public') && !story
if (source === undefined) {
  console.error('usage: npm run recap -- <gameId | save.json> [--public] [--story]')
  process.exit(2)
}

const report: string[] = []
const say = (line: string): void => {
  report.push(line)
  if (!story) console.log(line)
}

const DB = '/mnt/cache/appdata/arcs/arcs.db'

function fromTower(id: string): { options: NewGameOptions; journal: string[]; names: Map<string, string> } {
  // The id is interpolated into SQL on the far side, so it must be exactly a UUID.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`not a game id: ${id}`)
  }
  const query = <T>(sql: string): T[] =>
    JSON.parse(
      execFileSync('ssh', ['tower', `sqlite3 -readonly -json ${DB} "${sql}"`], { encoding: 'utf8' }) || '[]',
    ) as T[]
  const game = query<{ options: string }>(`select options from game where id='${id}'`)
  if (game.length === 0) throw new Error(`no game ${id} on Tower`)
  const journal = query<{ action: string }>(`select action from journal where game_id='${id}' order by idx`)
  const seats = query<{ faction: string; name: string | null; is_bot: number }>(
    `select faction, name, is_bot from seat where game_id='${id}'`,
  )
  return {
    options: JSON.parse(game[0]!.options) as NewGameOptions,
    journal: journal.map((r) => r.action),
    names: new Map(seats.map((s) => [s.faction, s.is_bot ? 'bot' : (s.name ?? '')])),
  }
}

function load(): { options: NewGameOptions; journal: string[]; names: Map<string, string> } {
  if (source!.endsWith('.json')) {
    const { options, result } = loadGame(readFileSync(source!, 'utf8'))
    return { options, journal: [...result.state.journal], names: new Map() }
  }
  return fromTower(source!)
}

const { options, journal, names } = load()
const registry = defaultRegistry()
const s: GameState = replayGame(options, journal, registry).state
const who = (f: FactionId): string => (names.get(f) ? `${f} (${names.get(f)})` : f)

// --- scoreboard --------------------------------------------------------------

say(`${options.board} — chapter ${s.chapter}, round ${s.round}${s.isOver ? ' — game over' : ''}`)
say(`initiative: ${s.initiativeOrder.join(' → ')}\n`)

const pieces = (f: FactionId, piece: string): number =>
  s.board.systems.reduce(
    (n, sys) =>
      n +
      contentsOf(s.figures, Location.system(sys)).filter((id) => {
        const p = parseFigureId(id)
        return p.color === f && p.piece === piece
      }).length,
    0,
  )

const pieces1 = (f: FactionId, sys: string, piece: string): number =>
  contentsOf(s.figures, Location.system(sys)).filter((id) => {
    const p = parseFigureId(id)
    return p.color === f && p.piece === piece
  }).length

for (const f of s.factions) {
  const held = s.board.systems.filter((sys) => rules(s, f, sys))
  const res = [...s.resources.contents.entries()]
    .filter(([loc]) => loc.startsWith(`cityslot:${f}:`) || loc.startsWith(`cardslot:${f}:`))
    .flatMap(([, ids]) => ids.map((id) => parseResourceToken(id).resource))
  const court = securedCards(s, f).map((id) => courtCard(id).name)
  const hand = contentsOf(s.cards, `hand:${f}`)
  say(`${who(f)} — power ${s.power[f] ?? 0}`)
  say(
    `  ${pieces(f, 'City')} cities, ${pieces(f, 'Starport')} starports, ${pieces(f, 'Ship')} ships; rules ${held.join(', ') || 'nothing'}`,
  )
  say(`  resources: ${res.join(', ') || 'none'}; court: ${court.join(', ') || 'none'}`)
  say(`  hand: ${showHands ? hand.join(', ') || 'empty' : `${hand.length} cards`}`)
}

// --- ambition races ----------------------------------------------------------

say('\nambitions (holdings now):')
for (const a of AMBITIONS) {
  const marks = s.declared.filter((d) => d.ambition === a)
  const tag = marks.length === 0 ? 'undeclared' : `declared ${marks.map((d) => `${d.marker.high}/${d.marker.low}`).join(' + ')}`
  const row = s.factions.map((f) => ({ f, v: metric(s, f, a) })).sort((x, y) => y.v - x.v)
  say(`  ${a.padEnd(8)} ${tag.padEnd(16)} ${row.map((r) => `${r.f} ${r.v}`).join(', ')}`)
}

// The engine's own scoring, run on a copy of the state: what the chapter end would pay right now.
if (s.declared.length > 0 && !s.isOver) {
  const scored = perform(s, ScoreAmbitions(), registry).state
  say('\nif the chapter ended now:')
  for (const line of scored.log.slice(s.log.length)) say(`  ${line}`)
}

// --- what each player looks to be going for ---------------------------------

/*
 * Read from what each player has *done*, not from the bots' `intentFor`: that reads board structure
 * only, and on this spike's first game it said all four players were going hard for Keeper.
 */
say('\nwhat each player looks to be going for:')
for (const f of s.factions) {
  const declared = s.log.filter((l) => l.startsWith(`${f} declared `)).map((l) => l.slice(f.length + 10))
  // Taxing a city yields its planet's resource, so cities by planet type are the income.
  const taxBase = new Map<string, number>()
  for (const sys of s.board.systems) {
    if (pieces1(f, sys, 'City') === 0) continue
    const r = planetResource(s, sys)
    if (r !== undefined) taxBase.set(r, (taxBase.get(r) ?? 0) + pieces1(f, sys, 'City'))
  }
  // Agents sitting on court cards: what they are trying to win next.
  const courting = [...s.figures.contents.entries()]
    .filter(([loc, ids]) => loc.startsWith('court:agents:') && ids.some((id) => parseFigureId(id).color === f))
    .map(([loc, ids]) => {
      const card = contentsOf(s.courtCards, `court:slot:${loc.slice('court:agents:'.length)}`)[0]
      const c = card === undefined ? undefined : courtCard(card)
      const mine = ids.filter((id) => parseFigureId(id).color === f).length
      return `${c?.name ?? '?'}${c?.suit ? ` (${c.suit})` : ''} ×${mine}`
    })
  say(`  ${who(f)}:`)
  say(`    declared: ${declared.join(', ') || 'nothing'}`)
  say(`    tax base: ${[...taxBase].map(([r, n]) => `${n} ${r}`).join(', ') || 'none'}`)
  say(`    courting: ${courting.join(', ') || 'nothing'}`)
}

// --- the story so far --------------------------------------------------------

say('\nlog by round:')
let heading = 'setup'
let lines: string[] = []
const flush = (): void => {
  if (lines.length > 0) say(`\n[${heading}]\n${lines.map((l) => `  ${l}`).join('\n')}`)
  lines = []
}
let round = 0
for (const line of s.log) {
  const chapter = /^Chapter (\d+):/.exec(line)
  if (chapter) {
    flush()
    round = 1
    heading = `chapter ${chapter[1]}, round ${round}`
    continue
  }
  if (line.startsWith('round over')) {
    flush()
    heading = heading.replace(/round \d+/, `round ${++round}`)
    continue
  }
  lines.push(line)
}
flush()

// --- the story, by DeepSeek --------------------------------------------------

const PROMPT = `You are the narrator for a game of Arcs (Leder Games), a space strategy card game, being
played online by friends. Below is a factual report of the game so far: a scoreboard, the ambition
races, what each player looks to be going for, and the full log grouped by round.

Write a short, lively recap for the players:
- A one-line headline.
- "The story so far": 1-3 sentences per round, in order, naming players by name and colour.
- "Where things stand": who leads, who would score what if the chapter ended now, and one line per
  player on what they seem to be building toward and what threatens it.

Arcs basics for reading the report: taxing a city gains its planet's resource, so "tax base" is the
cities a player *could* tax — future income, not resources already held ("resources" lists those). Relics score Keeper, Material and Fuel score Tycoon, Psionics score Empath; a
secured Guild card counts as one of its resource. Weapons score no ambition (they help in battle).
Trophies score Warlord, captives Tyrant. A rival with tax base in a declared ambition's resource is
a threat to whoever leads it.

Rules: use only facts in the report — never invent moves, cards, motives or numbers. Hands are
hidden; do not guess what anyone holds. Plain markdown, under 350 words, no preamble.`

if (story) {
  const out = execFileSync(
    `${process.env.HOME}/.opencode/bin/opencode`,
    ['run', '-m', process.env.RECAP_MODEL ?? 'deepseek/deepseek-v4-pro', PROMPT],
    { input: report.join('\n'), encoding: 'utf8', timeout: 300_000, stdio: ['pipe', 'pipe', 'ignore'] },
  )
  // opencode prints its own banner (`> build · model`) and colour codes before the answer.
  const text = out.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\s*> .*\n/m, '')
  console.log(text.trim())
}
