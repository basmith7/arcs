/** The turn catch-up card (spec 2026-10-04): bullets at once, the story below them, dismissal kept. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { catchupDismissed, dismissCatchup, reopenCatchup, shouldShowCatchup } from '../src/catchup.js'
import { CatchUp } from '../src/components/CatchUp.js'

const names: Record<string, string> = { red: 'Brian', blue: 'Ken' }
const headsUps = [
  { kind: 'rival-tax-base' as const, text: 'blue can now tax Relic — it counts toward Keeper.' },
  { kind: 'overtake-risk' as const, text: 'blue is one Tax from tying you on Keeper.' },
]
const card = (story: string | null, extra: { collapsed?: boolean; pending?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(CatchUp, {
      headsUps,
      story,
      pending: extra.pending ?? false,
      factions: ['red', 'blue'],
      name: (f: string) => names[f]!,
      collapsed: extra.collapsed ?? false,
      onDismiss: () => {},
    }),
  )

describe('CatchUp card', () => {
  it('shows the heads-ups with player names, and no story yet', () => {
    const html = card(null)
    expect(html).toContain('Ken can now tax Relic — it counts toward Keeper.')
    expect(html).toContain('Ken is one Tax from tying you on Keeper.')
    expect(html).not.toContain('cu-story')
  })
  it('reserves the story’s space while one is being written', () => {
    expect(card(null, { pending: true })).toContain('cu-story-slot')
  })
  it('puts the story below the bullets, so nothing moves when it arrives', () => {
    const html = card('Ken built on a Relic world.')
    expect(html.indexOf('Ken built on a Relic world.')).toBeGreaterThan(html.indexOf('tying you on Keeper'))
  })
  it('folds the story behind More on a phone', () => {
    expect(card('Ken built on a Relic world.', { collapsed: true })).toMatch(/<details[^>]*><summary[^>]*>More<\/summary>/)
  })
})

describe('dismissal', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('is remembered per game, seat and turn, and can be undone', () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    })
    dismissCatchup('g', 'red', 71)
    expect(catchupDismissed('g', 'red', 71)).toBe(true)
    expect(catchupDismissed('g', 'red', 72)).toBe(false)
    expect(catchupDismissed('h', 'red', 71)).toBe(false)
    expect(catchupDismissed('g', 'blue', 71)).toBe(false) // two seats in one browser
    reopenCatchup('g', 'red')
    expect(catchupDismissed('g', 'red', 71)).toBe(false)
  })
})

describe('shouldShowCatchup', () => {
  const ask = { kind: 'ask', faction: 'red', actions: [] } as never
  it('is for the seated player whose turn it is, only', () => {
    expect(shouldShowCatchup({ kind: 'seat', faction: 'red' }, ask)).toBe(true)
    expect(shouldShowCatchup({ kind: 'seat', faction: 'blue' }, ask)).toBe(false)
    expect(shouldShowCatchup({ kind: 'spectator' }, ask)).toBe(false)
    expect(shouldShowCatchup({ kind: 'hotseat' }, ask)).toBe(false)
  })
})
