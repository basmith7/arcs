/** The Scoreboard's wording, rendered from the live game's facts (spec 2026-10-04). */

import { readFileSync } from 'node:fs'

import { defaultRegistry, gameFacts, replayGame } from '@arcs/engine'
import type { FactionId, NewGameOptions } from '@arcs/engine'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'

import { Scoreboard } from '../src/components/Scoreboard.js'

const live = JSON.parse(
  readFileSync(new URL('../../../packages/engine/test/fixtures/game-158107d8.json', import.meta.url), 'utf8'),
) as { options: NewGameOptions; journal: string[] }
const facts = gameFacts(replayGame(live.options, live.journal, defaultRegistry()).state, defaultRegistry())
const names: Record<string, string> = { red: 'Brian', yellow: 'Neal', blue: 'Ken', white: 'Tim' }
const html = renderToStaticMarkup(createElement(Scoreboard, { facts, name: (f: FactionId) => names[f]! }))

it('shows the projection as a projection', () => {
  expect(html).toContain('Brian would take Keeper (+5)')
  expect(html).toContain('Neal would take Tycoon (+3)')
  expect(html).not.toMatch(/\bwins?\b|\bwon\b/)
})
it('shows who declared what, their tax base and courting', () => {
  expect(html).toContain('2 Relic')
  expect(html).toContain('Prison Wardens ×2')
})
