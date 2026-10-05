import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { defaultRegistry, gameFacts, replayGame } from '../src/index.js'
import type { NewGameOptions } from '../src/index.js'

const live = JSON.parse(readFileSync(new URL('./fixtures/game-158107d8.json', import.meta.url), 'utf8')) as {
  options: NewGameOptions
  journal: string[]
}
const state = replayGame(live.options, live.journal, defaultRegistry()).state
const facts = gameFacts(state, defaultRegistry())
const of = (f: string) => facts.factions.find((x) => x.faction === f)!

describe('gameFacts on game 158107d8 after 71 entries', () => {
  it('reads each player from what they have done', () => {
    expect(of('red')).toMatchObject({
      cities: 2,
      starports: 1,
      declared: ['Keeper'],
      taxBase: { Relic: 2 },
      court: ['Loyal Keepers'],
      handSize: 4,
    })
    expect(of('yellow')).toMatchObject({ declared: ['Tycoon'], taxBase: { Material: 1, Fuel: 1 }, resources: ['Material', 'Psionic'] })
    expect(of('blue').courting).toEqual([{ card: 'Prison Wardens', suit: 'Weapon', agents: 2 }])
    expect(of('white').declared).toEqual([])
  })
  it('ranks the ambition race', () => {
    const keeper = facts.ambitions.find((a) => a.ambition === 'Keeper')!
    expect(keeper.markers).toEqual([{ high: 5, low: 3 }])
    expect(keeper.holdings[0]).toEqual({ faction: 'red', value: 1 })
  })
  it('projects the chapter end with the real scoring', () => {
    const awards = facts.ifChapterEndedNow!.results.flatMap((r) => r.awards.map((a) => [r.ambition, a.faction, a.place, a.power]))
    expect(awards).toEqual([
      ['Tycoon', 'yellow', 'first', 3],
      ['Keeper', 'red', 'first', 5],
    ])
  })
  it('does not move the game', () => {
    expect(state.power).toEqual({ red: 0, yellow: 0, blue: 0, white: 0 })
    expect(facts.chapter).toBe(1)
  })
})
