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

import { lastTurn, parseLog, systemsIn, tokenize } from '../src/log-format.js'
import type { LogPart } from '../src/log-format.js'

describe('parseLog', () => {
  it('reads the faction off the front of a line and drops it from the text', () => {
    const [head] = parseLog(['red built a Ship in 6-Hex'])
    expect(head).toEqual({ kind: 'head', faction: 'red', text: '', parts: expect.any(Array) })
    const [, entry] = parseLog(['red built a Ship in 6-Hex'])
    expect(entry).toMatchObject({ kind: 'entry', text: 'built a Ship in 6-Hex' })
  })

  it('folds a card play into the turn head rather than listing it', () => {
    const items = parseLog(['red led with Aggression-2 (3 pips)', 'red built a Ship in 6-Hex'])
    expect(items[0]).toEqual({
      kind: 'head',
      faction: 'red',
      text: 'led with Aggression-2 (3 pips)',
      parts: expect.any(Array),
    })
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
expect(items).toEqual([
      { kind: 'entry', faction: null, text: 'initiative passes to red', tone: '', icon: '', parts: expect.any(Array) },
    ])
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

/**
 * The log's proper nouns, found so the panel can make them do something.
 *
 * Three kinds of name appear in the engine's sentences and all three are already objects the app
 * can show you: an action card ("led with Construction-3"), a card that has a *name* — court, lore
 * or leader — and a system on the map. Finding them here rather than in the panel keeps the whole
 * of "reading the log" in one module and one test file; the panel's job stays deciding what a row
 * looks like.
 *
 * The risk is the mirror of the tone table's: an over-eager pattern that links an ordinary word.
 * The fixtures below are the collisions that actually exist in the data — a leader called `Elder`
 * inside a court card called `Elder Broker`, an action card id shaped almost exactly like a system
 * id — because those are what a careless regex gets wrong.
 */
describe('tokenize', () => {
  const kinds = (text: string): string[] => tokenize(text).map((p) => p.kind)
  const linked = (text: string): LogPart[] => tokenize(text).filter((p) => p.kind !== 'text')

  it('leaves a line with no names as a single run of text', () => {
    expect(tokenize('passed')).toEqual([{ kind: 'text', text: 'passed' }])
  })

  it('finds an action card by its id', () => {
    expect(linked('led with Construction-3 (2 pips)')).toEqual([
      { kind: 'card', text: 'Construction-3', card: { kind: 'action', id: 'Construction-3' } },
    ])
  })

  it('finds a system by its id', () => {
    expect(linked('built a Ship in 1-Hex')).toEqual([
      { kind: 'system', text: '1-Hex', system: '1-Hex' },
    ])
  })

  /*
   * `Construction-3` and `1-Hex` are the same shape — a word, a dash, a token — and a pattern
   * loose enough to catch one catches the other. They resolve to different surfaces, so getting
   * this backwards would open a card zoom for a system and reticle the map for a card.
   */
  it('tells a card id from a system id, which are nearly the same shape', () => {
    expect(linked('moved 2 ships 1-Gate → 1-Arrow, led with Mobilization-4')).toEqual([
      { kind: 'system', text: '1-Gate', system: '1-Gate' },
      { kind: 'system', text: '1-Arrow', system: '1-Arrow' },
      { kind: 'card', text: 'Mobilization-4', card: { kind: 'action', id: 'Mobilization-4' } },
    ])
  })

  it('finds court cards, lore and leaders by name', () => {
    expect(linked('influenced Mining Interest')).toEqual([
      { kind: 'card', text: 'Mining Interest', card: { kind: 'court', id: 'bc02' } },
    ])
    expect(linked('discarded Mirror Plating')).toEqual([
      { kind: 'card', text: 'Mirror Plating', card: { kind: 'lore', id: 'lore04' } },
    ])
    expect(linked('leads as the Archivist')).toEqual([
      { kind: 'card', text: 'Archivist', card: { kind: 'leader', id: 'leader09' } },
    ])
  })

  /*
   * `Elder` is a leader and `Elder Broker` a court card. A shortest-first alternation would take
   * the leader out of the middle of the guild's name and leave " Broker" as loose text.
   */
  it('prefers the longest name when one card’s name starts another’s', () => {
    expect(linked('secured Elder Broker')).toEqual([
      { kind: 'card', text: 'Elder Broker', card: { kind: 'court', id: 'bc23' } },
    ])
    expect(linked('took the Elder')).toEqual([
      { kind: 'card', text: 'Elder', card: { kind: 'leader', id: 'leader01' } },
    ])
  })

  it('handles a name with an apostrophe in it', () => {
    expect(linked('discarded Empath’s Vision'.replace('’', "'"))).toEqual([
      { kind: 'card', text: "Empath's Vision", card: { kind: 'lore', id: 'lore19' } },
    ])
  })

  it('keeps the text between the names, in order, so the sentence still reads', () => {
    expect(kinds('built a Ship in 1-Hex and taxed 2-Arrow')).toEqual([
      'text',
      'system',
      'text',
      'system',
    ])
    expect(tokenize('built a Ship in 1-Hex').map((p) => p.text).join('')).toBe(
      'built a Ship in 1-Hex',
    )
  })

  it('does not link an ambition, which is a name but not a card', () => {
    expect(linked('declared Warlord')).toEqual([])
    // ...though the lore card named after one still links, by its full name.
    expect(linked('discarded Warlord’s Cruelty'.replace('’', "'"))).toHaveLength(1)
  })
})

/**
 * The parts ride on the rows, so the panel gets them without a second pass over the same string.
 */
describe('parseLog parts', () => {
  it('gives every head and entry its parts alongside its text', () => {
    const items = parseLog(['red led with Aggression-2 (3 pips)', 'red built a Ship in 6-Hex'])
    const head = items[0] as { kind: 'head'; text: string; parts: LogPart[] }
    expect(head.parts.some((p) => p.kind === 'card')).toBe(true)
    const entry = items[1] as { kind: 'entry'; parts: LogPart[] }
    expect(entry.parts.some((p) => p.kind === 'system')).toBe(true)
  })

  it('strips the faction prefix before looking, so the actor is never a link', () => {
    const [, entry] = parseLog(['red built a Ship in 6-Hex']) as [
      unknown,
      { parts: LogPart[] },
    ]
    expect(entry.parts.map((p) => p.text).join('')).toBe('built a Ship in 6-Hex')
  })

  it('leaves a divider alone — it names nothing to open', () => {
    const [divider] = parseLog(['round over — 4 played cards discarded'])
    expect(divider).toEqual({ kind: 'divider', text: 'round over — 4 played cards discarded' })
  })
})

/**
 * What a row points the map at: every system it names, in the order it named them.
 *
 * Order matters to the caller — the map draws a route between the two ends of a move, and a move
 * runs from the first named system to the second. Reversing them would draw the arrow backwards.
 */
describe('systemsIn', () => {
  it('is empty for a row that names no system', () => {
    expect(systemsIn(tokenize('led with Aggression-2 (3 pips)'))).toEqual([])
  })

  it('lists the systems in the order the sentence names them', () => {
    expect(systemsIn(tokenize('moved 2 ships 1-Gate → 1-Arrow'))).toEqual(['1-Gate', '1-Arrow'])
  })

  it('ignores card names, which are not places', () => {
    expect(systemsIn(tokenize('built a Ship in 1-Hex with Cloud Cities'))).toEqual(['1-Hex'])
  })

  it('keeps a system named twice only once, so a reticle is not drawn on itself', () => {
    expect(systemsIn(tokenize('taxed 1-Hex and built a Ship in 1-Hex'))).toEqual(['1-Hex'])
  })
})
