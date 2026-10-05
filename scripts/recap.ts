/**
 * A scoreboard for a game in progress: where everyone stands, the ambition races, and what each
 * player looks to be going for, followed by the log grouped by round to write a story from.
 *
 *   npm run recap -- <gameId | save.json> [--public] [--story] [--seat <faction>]
 *
 * Spike (2026-10-04): a private report, to find out what an in-game scoreboard panel should show.
 * Reads a live game from Tower over ssh with `sqlite3 -readonly`, exactly as `advise` does — never a
 * write. It prints every hand unless `--public` is given; the panel could only show the public view.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { contentsOf, defaultRegistry, gameFacts, loadGame, replayGame, seatFacts, sinceLastTurn } from '@arcs/engine'
import type { FactionId, GameState, NewGameOptions } from '@arcs/engine'

const argv = process.argv.slice(2)
const source = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--seat')
const story = argv.includes('--story')
const seatArg = argv.indexOf('--seat')
const seat = seatArg >= 0 ? (argv[seatArg + 1] as FactionId | undefined) : undefined
// The story is written from the public view only: what a table of players could all see.
const showHands = !argv.includes('--public') && !story
if (source === undefined) {
  console.error('usage: npm run recap -- <gameId | save.json> [--public] [--story] [--seat <faction>]')
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

// The same public fact model the Scoreboard and the turn catch-up use.
const facts = gameFacts(s, registry)

for (const f of facts.factions) {
  const hand = contentsOf(s.cards, `hand:${f.faction}`)
  say(`${who(f.faction)} — power ${f.power}`)
  say(`  ${f.cities} cities, ${f.starports} starports, ${f.ships} ships; rules ${f.rules.join(', ') || 'nothing'}`)
  say(`  resources: ${f.resources.join(', ') || 'none'}; court: ${f.court.join(', ') || 'none'}`)
  say(`  hand: ${showHands ? hand.join(', ') || 'empty' : `${f.handSize} cards`}`)
}

// --- ambition races ----------------------------------------------------------

say('\nambitions (holdings now):')
for (const a of facts.ambitions) {
  const tag = a.markers.length === 0 ? 'undeclared' : `declared ${a.markers.map((m) => `${m.high}/${m.low}`).join(' + ')}`
  say(`  ${a.ambition.padEnd(8)} ${tag.padEnd(16)} ${a.holdings.map((h) => `${h.faction} ${h.value}`).join(', ')}`)
}

// The engine's own scoring, run on a copy of the state: what the chapter end would pay right now.
if (facts.ifChapterEndedNow !== null) {
  say('\nif the chapter ended now:')
  for (const r of facts.ifChapterEndedNow.results) {
    if (r.awards.length === 0) say(`  no one would score ${r.ambition}`)
    for (const w of r.awards) {
      const verb = w.place === 'first' ? 'would take' : w.place === 'second' ? 'would place second in' : 'would tie'
      say(`  ${w.faction} ${verb} ${r.ambition} (+${w.power})`)
    }
  }
}

// --- what each player looks to be going for ---------------------------------

/*
 * Read from what each player has *done*, not from the bots' `intentFor`: that reads board structure
 * only, and on this spike's first game it said all four players were going hard for Keeper.
 */
say('\nwhat each player looks to be going for:')
for (const f of facts.factions) {
  const marker = (a: string): string => {
    const d = s.declared.find((x) => x.by === f.faction && x.ambition === a)
    return d === undefined ? a : `${a} (${d.marker.high}/${d.marker.low})`
  }
  say(`  ${who(f.faction)}:`)
  say(`    declared: ${f.declared.map(marker).join(', ') || 'nothing'}`)
  say(`    tax base: ${Object.entries(f.taxBase).map(([r, n]) => `${n} ${r}`).join(', ') || 'none'}`)
  say(`    courting: ${f.courting.map((c) => `${c.card}${c.suit ? ` (${c.suit})` : ''} ×${c.agents}`).join(', ') || 'nothing'}`)
}

// --- one seat's catch-up heads-ups ------------------------------------------

if (seat !== undefined) {
  const since = sinceLastTurn(journal, seat)
  const sf = seatFacts(replayGame(options, journal.slice(0, since), registry).state, s, seat, registry)
  say(`\ncatch-up for ${who(seat)} (journal since ${since}, ${sf.since.length} log lines):`)
  for (const h of sf.headsUps) say(`  - ${h.text}`)
  if (sf.headsUps.length === 0) say('  (no heads-ups)')
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
