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

describe('LogPanel', () => {
  it('draws the actor as a color, not as a repeated word', () => {
    const out = html({ log: ['red moved 2 ships 1-Gate → 1-Arrow'] })
    expect(out).toContain('#d94b3f')
    // The prefix is gone from the text; the sentence it introduced is not.
    expect(out).toContain('moved 2 ships')
    expect(out).not.toContain('>red moved')
  })

  it('folds the card play into the turn head instead of listing it twice', () => {
    const out = html({ log: LOG })
    expect(out).toContain('log-head')
    expect(out.match(/led with Aggression-2/g)).toHaveLength(1)
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
    expect(out).toContain('built a Ship in 1-Hex')
    expect(out).not.toContain('moved 2 ships')
  })

  it('renders nothing at all between turns, rather than an empty frame', () => {
    const out = html({ log: ['red built a Ship in 1-Hex', 'round over — 4 played cards discarded'], only: 'last-turn' })
    expect(out).toBe('')
  })
})
