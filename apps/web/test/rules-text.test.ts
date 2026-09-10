/**
 * The searchable rules: what the reader indexes, and what the search has to be able to find.
 *
 * Two halves. The pure ones — search and the markup parser — run against fixtures small enough to
 * read here. The last block runs against the real `assets/rules/data/rules-text.json`, because the
 * invariants that matter (numbering matches the publisher's own anchors, errata land on rules that
 * exist) are properties of the fetched file, and nothing else in the app would notice them break.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  erratumFor,
  parseRulesMarkup,
  plainRulesText,
  resolveRulesRef,
  searchRules,
  type RulesText,
} from '../src/rules-text.js'

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'assets',
  'rules',
  'data',
  'rules-text.json',
)

const section = (
  number: string,
  title: string,
  text: string,
  extra: { trail?: string[]; campaign?: true } = {},
) => ({ number, anchor: `${number}-${title.toLowerCase()}`, title, trail: [], text, ...extra })

const FIXTURE: RulesText = {
  source: 'https://example.test',
  publisher: 'Buried Giant Studios',
  updated: 'Oct 8, 2025',
  fetched: '2026-09-09',
  chunk: 'chunk-TEST.js',
  sections: [
    section('5.1.2', 'Passing Initiative', 'You must pass the initiative marker clockwise.'),
    section(
      '7.3',
      'Battle',
      'Collect dice up to the number of attacking ships. You may collect zero. Raiding steals resources.',
    ),
    section('9.1', 'Resources', 'Resources are held in slots on your player board.', {
      trail: ['Resources'],
    }),
    section('13.2', 'Imperial Trust', 'The Trust holds resources for the Empire.', {
      campaign: true,
    }),
    section(
      '9.2.2',
      'Raid Cost',
      'Each slot has a **raid cost**: the number of `symbol:key` to spend, see `rule:7.3`.',
    ),
  ],
  errata: [{ number: '7.3', text: 'Added "This counts as stealing."' }],
}

describe('searching the rules text', () => {
  it('finds a section by a word in its body', () => {
    expect(searchRules(FIXTURE, 'clockwise').map((h) => h.section.number)).toEqual(['5.1.2'])
  })

  it('ignores case and surrounding punctuation', () => {
    expect(searchRules(FIXTURE, 'DICE.').map((h) => h.section.number)).toEqual(['7.3'])
  })

  it('ranks a title match above a body match', () => {
    const hits = searchRules(FIXTURE, 'resources')
    expect(hits.map((h) => h.section.number)).toEqual(['9.1', '7.3'])
  })

  it('requires every word of a multi-word query', () => {
    expect(searchRules(FIXTURE, 'attacking ships').map((h) => h.section.number)).toEqual(['7.3'])
    expect(searchRules(FIXTURE, 'attacking clockwise')).toEqual([])
  })

  it('matches a rule number typed directly', () => {
    expect(searchRules(FIXTURE, '5.1.2').map((h) => h.section.number)).toEqual(['5.1.2'])
  })

  it('leaves campaign rules out unless they are asked for', () => {
    expect(searchRules(FIXTURE, 'trust')).toEqual([])
    expect(searchRules(FIXTURE, 'trust', { campaign: true }).map((h) => h.section.number)).toEqual([
      '13.2',
    ])
  })

  it('returns a snippet around the first match rather than the whole section', () => {
    const [hit] = searchRules(FIXTURE, 'zero')
    expect(hit?.snippet).toContain('zero')
    expect(hit?.snippet.length).toBeLessThan(FIXTURE.sections[1]!.text.length + 1)
  })

  it('finds nothing for an empty query', () => {
    expect(searchRules(FIXTURE, '   ')).toEqual([])
  })

  it('attaches errata to the rule they correct', () => {
    expect(erratumFor(FIXTURE, '7.3')?.text).toContain('counts as stealing')
    expect(erratumFor(FIXTURE, '5.1.2')).toBeUndefined()
  })
})

describe('parsing the library’s markup', () => {
  it('reads bold spans', () => {
    expect(parseRulesMarkup('you must **pass** it')).toEqual([
      { kind: 'text', text: 'you must ' },
      { kind: 'bold', text: 'pass' },
      { kind: 'text', text: ' it' },
    ])
  })

  it('reads an absolute rule reference', () => {
    expect(parseRulesMarkup('see `rule:3.2.1`')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'ref', number: '3.2.1', label: '3.2.1' },
    ])
  })

  it('reads a relative rule reference, keeping the leaf as its label', () => {
    expect(parseRulesMarkup('`rule-relative:Standard Actions$Move`')).toEqual([
      { kind: 'ref', name: 'Standard Actions$Move', label: 'Move' },
    ])
  })

  it('reads a symbol token', () => {
    expect(parseRulesMarkup('`symbol:diamond`')).toEqual([{ kind: 'symbol', name: 'diamond' }])
  })

  it('reads a line break', () => {
    expect(parseRulesMarkup('one<br>two')).toEqual([
      { kind: 'text', text: 'one' },
      { kind: 'break' },
      { kind: 'text', text: 'two' },
    ])
  })

  it('reads a markdown link', () => {
    expect(parseRulesMarkup('[Pirate Hoard](https://cards.example/ARCS-F1202)')).toEqual([
      { kind: 'link', text: 'Pirate Hoard', href: 'https://cards.example/ARCS-F1202' },
    ])
  })

  it('leaves plain text alone', () => {
    expect(parseRulesMarkup('nothing to see')).toEqual([{ kind: 'text', text: 'nothing to see' }])
  })
})

describe('the fetched rules file', () => {
  const data = JSON.parse(readFileSync(DATA, 'utf8')) as RulesText

  it('numbers sections the way the publisher’s anchors do', () => {
    const passing = data.sections.find((s) => s.number === '5.1.2')
    expect(passing?.anchor).toBe('5.1.2-passing-initiative')
  })

  it('points every erratum at a rule that exists', () => {
    const numbers = new Set(data.sections.map((s) => s.number))
    expect(data.errata.filter((e) => !numbers.has(e.number))).toEqual([])
  })

  it('carries the base game as well as the campaign', () => {
    expect(data.sections.filter((s) => !s.campaign).length).toBeGreaterThan(200)
    expect(data.sections.filter((s) => s.campaign).length).toBeGreaterThan(100)
  })

  it('can find the rule the search box exists for', () => {
    const hits = searchRules(data, 'seize the initiative')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.section.trail.concat(hits[0].section.title).join(' > ')).toMatch(
      /[Ii]nitiative/,
    )
  })
})

describe('following a cross-reference', () => {
  it('resolves a reference by number', () => {
    expect(resolveRulesRef(FIXTURE, { kind: 'ref', number: '7.3', label: '7.3' })?.title).toBe(
      'Battle',
    )
  })

  it('resolves a reference by name, matching the tail of a section’s path', () => {
    expect(
      resolveRulesRef(FIXTURE, { kind: 'ref', name: 'Resources', label: 'Resources' })?.number,
    ).toBe('9.1')
  })

  it('is undefined when nothing matches', () => {
    expect(resolveRulesRef(FIXTURE, { kind: 'ref', name: 'Nowhere', label: 'Nowhere' })).toBe(
      undefined,
    )
  })
})

describe('taking the markup off', () => {
  it('reads emphasis as its strongest form, not as stray asterisks', () => {
    expect(parseRulesMarkup('there are ***defending buildings***')).toEqual([
      { kind: 'text', text: 'there are ' },
      { kind: 'em', text: 'defending buildings' },
    ])
  })

  it('drops the glyphs and the markers from a plain reading', () => {
    expect(plainRulesText('spend a `symbol:key` to **steal** it — see `rule:9.2.2`')).toBe(
      'spend a to steal it — see 9.2.2',
    )
  })

  it('searches the plain text, so a glyph token is not a word to match', () => {
    expect(searchRules(FIXTURE, 'symbol')).toEqual([])
    expect(searchRules(FIXTURE, 'key')).toEqual([])
  })

  it('snippets the plain text, so the reader never sees the markup', () => {
    const [hit] = searchRules(FIXTURE, 'raid cost')
    expect(hit?.section.number).toBe('9.2.2')
    expect(hit?.snippet).toBe('Each slot has a raid cost: the number of to spend, see 7.3.')
  })
})
