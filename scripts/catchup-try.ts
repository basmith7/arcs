/**
 * Re-run a seat's turn catch-up story and print every draft with the checker's verdict.
 *
 *   npm run catchup-try -- <gameId> <faction> [--at N]
 *
 * What the server actually wrote is in Tower's `catchup_attempt` table; this is for trying the
 * prompts again. It rebuilds the facts for the seat's latest hand-off (or the one at journal length
 * `--at`), then runs the server's own write-and-check loop (`draftStory`) against DeepSeek and
 * prints the fresh drafts here. It stores nothing.
 *
 * Reads the game and the server's DEEPSEEK_API_KEY from Tower over ssh, read-only. Prints the seat's
 * hand: run it for your own seat. Each run costs two to four DeepSeek calls.
 */

import { execFileSync } from 'node:child_process'

import { defaultRegistry, replayGame, seatFacts, seatTurn } from '@arcs/engine'
import type { FactionId, NewGameOptions } from '@arcs/engine'

import { draftStory } from '../packages/server-node/src/catchup.js'
import { deepseekChat } from '../packages/server-node/src/deepseek.js'

const argv = process.argv.slice(2)
const atArg = argv.indexOf('--at')
const at = atArg >= 0 ? Number(argv[atArg + 1]) : undefined
const [id, factionArg] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--at')
if (id === undefined || factionArg === undefined || (at !== undefined && !Number.isInteger(at))) {
  console.error('usage: npm run catchup-try -- <gameId> <faction> [--at N]')
  process.exit(2)
}
// The id is interpolated into SQL on the far side, so it must be exactly a UUID.
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
  throw new Error(`not a game id: ${id}`)
}
const faction = factionArg as FactionId

const DB = '/mnt/cache/appdata/arcs/arcs.db'
const tower = (cmd: string): string => execFileSync('ssh', ['tower', cmd], { encoding: 'utf8' })
const query = <T>(sql: string): T[] => JSON.parse(tower(`sqlite3 -readonly -json ${DB} "${sql}"`) || '[]') as T[]

const game = query<{ options: string }>(`select options from game where id='${id}'`)
if (game.length === 0) throw new Error(`no game ${id} on Tower`)
const options = JSON.parse(game[0]!.options) as NewGameOptions
const full = query<{ action: string }>(`select action from journal where game_id='${id}' order by idx`).map(
  (r) => r.action,
)
const apiKey = tower('docker exec arcs printenv DEEPSEEK_API_KEY').trim()
if (apiKey === '') throw new Error('no DEEPSEEK_API_KEY in the arcs container')

const registry = defaultRegistry()
// The hand-off: the journal as it stood when the seat was asked to open the turn.
const journal = full.slice(0, at ?? seatTurn(options, full, faction, registry).start)
const { since } = seatTurn(options, journal, faction, registry)
const before = replayGame(options, journal.slice(0, since), registry).state
const after = replayGame(options, journal, registry).state
const facts = seatFacts(before, after, faction, registry)
console.log(`${faction}'s hand-off at journal length ${journal.length} (events since ${since})\n`)
if (facts.since.length === 0) {
  console.log('nothing happened since its last turn: the server writes no story here')
  process.exit(0)
}

const chat = deepseekChat(apiKey)
const writerModel = process.env['CATCHUP_WRITER_MODEL'] || 'deepseek-v4-pro'
const checkerModel = process.env['CATCHUP_CHECKER_MODEL'] || 'deepseek-flash'
const ask = (model: string, p: { system: string; user: string }, reason = false): Promise<string> =>
  chat(model, p.system, p.user, AbortSignal.timeout(60_000), { reason })

const story = await draftStory(ask, facts, { writerModel, checkerModel }, (a, i) => {
  console.log(`--- draft ${i + 1} (${writerModel}) ---\n${a.draft}\n`)
  console.log(`--- verdict (${checkerModel}) ---\n${a.verdict}\n`)
})
console.log(story === undefined ? 'result: bullets only' : 'result: story kept')
