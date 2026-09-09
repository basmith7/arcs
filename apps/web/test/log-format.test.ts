/**
 * The log as structure rather than prose.
 *
 * The engine writes the log as ~80 hand-written sentences, each beginning with the actor's
 * faction id (`packages/engine/src/rules/*`). That prefix is data wearing prose's clothes, and
 * every line in a turn repeats it — which is what makes a long log a wall. `parseLog` reads the
 * prefix back off, groups consecutive lines by who acted, and classifies the verb, so the panel
 * can draw a color instead of a word and a glyph instead of a scan.
 *
 * The fixtures here are real lines, lifted verbatim from a played game (`npm run arena`), because
 * the parser's whole risk is that the engine's phrasing and the parser's regexes drift apart. A
 * fixture someone invented would agree with the parser by construction.
 */

import { describe, expect, it } from 'vitest'

import { lastTurn, parseLog } from '../src/log-format.js'

describe('parseLog', () => {
  it('reads the faction off the front of a line and drops it from the text', () => {
    const [head] = parseLog(['red built a Ship in 6-Hex'])
    expect(head).toEqual({ kind: 'head', faction: 'red', text: '' })
    const [, entry] = parseLog(['red built a Ship in 6-Hex'])
    expect(entry).toMatchObject({ kind: 'entry', text: 'built a Ship in 6-Hex' })
  })

  it('folds a card play into the turn head rather than listing it', () => {
    const items = parseLog(['red led with Aggression-2 (3 pips)', 'red built a Ship in 6-Hex'])
    expect(items[0]).toEqual({ kind: 'head', faction: 'red', text: 'led with Aggression-2 (3 pips)' })
    expect(items.filter((i) => i.kind === 'entry')).toHaveLength(1)
  })

  it('opens one head per actor, not one per line', () => {
    const items = parseLog([
      'red moved 2 ships 1-Gate → 1-Arrow',
      'red damaged white Ship',
      'yellow built a City in 5-Hex',
    ])
    expect(items.filter((i) => i.kind === 'head')).toHaveLength(2)
  })

  it('reopens a head when the same faction acts again after someone else', () => {
    const items = parseLog(['red taxed 4-Arrow (+Relic)', 'yellow built a City in 5-Hex', 'red built a Ship in 6-Hex'])
    expect(items.filter((i) => i.kind === 'head')).toHaveLength(3)
  })

  it('makes chapter and round lines dividers, outside any turn', () => {
    const items = parseLog(['red built a Ship in 6-Hex', 'round over — 4 played cards discarded', 'Chapter 2: dealt 6 cards each'])
    expect(items.filter((i) => i.kind === 'divider').map((i) => i.text)).toEqual([
      'round over — 4 played cards discarded',
      'Chapter 2: dealt 6 cards each',
    ])
  })

  it('a divider ends the turn, so the next line of the same faction opens a new head', () => {
    const items = parseLog(['red taxed 4-Arrow (+Relic)', 'round over — 4 played cards discarded', 'red built a Ship in 6-Hex'])
    expect(items.filter((i) => i.kind === 'head')).toHaveLength(2)
  })

  it('keeps an authorless line as an entry with no faction', () => {
    const items = parseLog(['initiative passes to red'])
    expect(items).toEqual([{ kind: 'entry', faction: null, text: 'initiative passes to red', tone: '', icon: '' }])
  })

  it('does not mistake a faction named mid-sentence for the actor', () => {
    const [head] = parseLog(['blue captured a white agent by taxing'])
    expect(head).toMatchObject({ faction: 'blue' })
  })
})

describe('tone', () => {
  const toneOf = (line: string): string => {
    const entry = parseLog([line]).find((i) => i.kind === 'entry')
    return entry?.kind === 'entry' ? entry.tone : 'no entry'
  }

  it('scores read as scores', () => {
    expect(toneOf('red won Tycoon for 14 power')).toBe('log-score')
    expect(toneOf('red placed second in Empath for 5 power')).toBe('log-score')
  })

  it('battles read as battles', () => {
    expect(toneOf('red destroyed white Ship (trophy)')).toBe('log-battle')
    expect(toneOf('blue attacks white in 4-Gate: rolled 0S/1A/0R → 1 hits, 0 bldg, 0 self, intercept, 0 keys')).toBe('log-battle')
  })

  it('a declaration is emphasis, not a score — the points are not in yet', () => {
    expect(toneOf('red declared Keeper (5/3)')).toBe('log-emph')
  })

  it('an ordinary move is plain', () => {
    expect(toneOf('red moved 2 ships 1-Gate → 1-Arrow')).toBe('')
  })
})

describe('icons', () => {
  const iconOf = (line: string): string => {
    const entry = parseLog([line]).find((i) => i.kind === 'entry')
    return entry?.kind === 'entry' ? entry.icon : 'no entry'
  }

  it('gives each action family its own glyph', () => {
    expect(iconOf('red attacks white in 1-Arrow: rolled 2S/0A/0R → 1 hits')).toBe('⚔')
    expect(iconOf('red built a Ship in 6-Hex')).toBe('⬢')
    expect(iconOf('red moved 2 ships 1-Gate → 1-Arrow')).toBe('➤')
    expect(iconOf('red influenced Loyal Empaths')).toBe('◈')
    expect(iconOf('red won Keeper for 5 power')).toBe('★')
    expect(iconOf('red taxed 4-Arrow (+Relic)')).toBe('◆')
  })

  it('leaves a line it cannot classify unglyphed rather than guessing', () => {
    expect(iconOf('red has no Construction action available (1 pip(s) lost)')).toBe('')
  })
})

describe('lastTurn', () => {
  it('is the final head and the entries under it', () => {
    const items = parseLog([
      'red built a Ship in 6-Hex',
      'yellow led with Aggression-3 (2 pips)',
      'yellow taxed 5-Hex (+Psionic)',
      'yellow influenced Loyal Pilots',
    ])
    expect(lastTurn(items).map((i) => (i.kind === 'head' ? i.text : i.kind === 'entry' ? i.text : ''))).toEqual([
      'led with Aggression-3 (2 pips)',
      'taxed 5-Hex (+Psionic)',
      'influenced Loyal Pilots',
    ])
  })

  it('is empty when a divider closed the last turn — there is nothing being done right now', () => {
    const items = parseLog(['red built a Ship in 6-Hex', 'round over — 4 played cards discarded'])
    expect(lastTurn(items)).toEqual([])
  })
})
