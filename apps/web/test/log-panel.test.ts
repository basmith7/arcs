/**
 * The log as it is drawn — one renderer, two mounts.
 *
 * The drawer and the watch-mode turn feed show the same rows under different framing, and the
 * point of these tests is that they stay one component: a feed that drifted into its own markup
 * would be a second place to teach every new log line about, which is the failure `surfaces.ts`
 * documents at length for decision surfaces.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LogPanel } from '../src/components/LogPanel.js'

const LOG = [
  'red led with Aggression-2 (3 pips)',
  'red moved 2 ships 1-Gate → 1-Arrow',
  'round over — 4 played cards discarded',
  'blue led with Construction-3 (2 pips)',
  'blue built a Ship in 1-Hex',
]

const html = (props: Parameters<typeof LogPanel>[0]): string =>
  renderToStaticMarkup(createElement(LogPanel, props))

/*
 * The rendered sentence with the markup taken back off. A row's text is no longer one text node —
 * the names inside it are their own elements now (see "LogPanel names" below) — so an assertion
 * about what a line *says* has to read it the way a player does rather than as a substring of the
 * markup.
 */
const text = (props: Parameters<typeof LogPanel>[0]): string =>
  html(props).replace(/<[^>]*>/g, '')

describe('LogPanel', () => {
  it('draws the actor as a color, not as a repeated word', () => {
    const out = html({ log: ['red moved 2 ships 1-Gate → 1-Arrow'] })
    expect(out).toContain('#d94b3f')
    // The prefix is gone from the text; the sentence it introduced is not.
    expect(text({ log: ['red moved 2 ships 1-Gate → 1-Arrow'] })).toContain('moved 2 ships')
    expect(out).not.toContain('>red moved')
  })

  it('folds the card play into the turn head instead of listing it twice', () => {
    const out = html({ log: LOG })
    expect(out).toContain('log-head')
    expect(text({ log: LOG }).match(/led with Aggression-2/g)).toHaveLength(1)
  })

  it('marks up dividers so they can rule across the panel', () => {
    expect(html({ log: LOG })).toContain('log-divider')
  })

  it('carries the emphasis class and the glyph the tone table names', () => {
    const out = html({ log: ['red won Keeper for 5 power'] })
    expect(out).toContain('log-score')
    expect(out).toContain('★')
  })
})

describe('LogPanel in turn-feed mode', () => {
  it('shows only the turn in progress', () => {
    const out = html({ log: LOG, only: 'last-turn' })
    // The system is drawn rather than spelled, so the name is read off the mark's title.
    expect(out).toContain('built a Ship in')
    expect(out).toContain('title="1-Hex"')
    expect(text({ log: LOG, only: 'last-turn' })).not.toContain('moved 2 ships')
  })

  it('renders nothing at all between turns, rather than an empty frame', () => {
    const out = html({ log: ['red built a Ship in 1-Hex', 'round over — 4 played cards discarded'], only: 'last-turn' })
    expect(out).toBe('')
  })
})

/**
 * The rows as things you can point at.
 *
 * `log-format.ts` finds the names; this is the half that turns them into targets — a card name you
 * can open and a system name the map answers to. Asserted as markup because that is what this
 * component is for, and because the two mounts (drawer and turn feed) go through the same `Row`:
 * a feed whose names were inert would be the drift these tests exist to catch.
 */
describe('LogPanel names', () => {
  it('makes a card name something you can open', () => {
    const out = html({ log: ['red led with Aggression-2 (3 pips)'] })
    expect(out).toContain('log-card')
    expect(out).toContain('Aggression-2')
  })

  it('makes a system name something the map can answer', () => {
    const out = html({ log: ['red built a Ship in 1-Hex'] })
    expect(out).toContain('log-sys')
    expect(out).toContain('1-Hex')
  })

  /*
   * The board prints "1" and a hexagon; so does this. The assertion is on the symbol's *name*
   * rather than on its path data, because the path is art and will be redrawn — what must not
   * change is that the row still says which symbol it means, in the markup and out loud.
   */
  it('draws a system the way the board does — a numeral and its symbol', () => {
    const out = html({ log: ['red built a Ship in 1-Hex'] })
    expect(out).toContain('sys-glyph')
    expect(out).toContain('aria-label="Hex"')
    // The word is gone from the sentence; the numeral it belonged to is not.
    expect(text({ log: ['red built a Ship in 1-Hex'] })).toContain('built a Ship in 1')
  })

  it('marks up court, lore and leader names too, not just the ids', () => {
    expect(html({ log: ['red influenced Mining Interest'] })).toContain('log-card')
    expect(html({ log: ['red discarded Mirror Plating'] })).toContain('log-card')
  })

  /*
   * The reason `tokenize` is lossless. Splitting a sentence to decorate part of it must not lose
   * the rest of it, and a stray double space or a dropped preposition is the kind of thing that
   * reads as a rendering bug long before anyone suspects the parser.
   */
  it('keeps the sentence intact around the names', () => {
    const line = 'red moved 2 ships 1-Gate → 1-Arrow'
    // The prose between the names, including the arrow and both spaces around it.
    expect(text({ log: [line] })).toContain('moved 2 ships 1 → 1')
    // And each name in full, on the mark that replaced it.
    expect(html({ log: [line] })).toContain('title="1-Gate"')
    expect(html({ log: [line] })).toContain('title="1-Arrow"')
  })

  it('leaves a divider as plain text — it names nothing', () => {
    const out = html({ log: ['round over — 4 played cards discarded'] })
    expect(out).toContain('log-divider')
    expect(out).not.toContain('log-card')
  })

  it('gives the feed the same targets as the drawer', () => {
    const feed = html({ log: ['red built a Ship in 1-Hex'], only: 'last-turn' })
    expect(feed).toContain('log-sys')
  })
})
