/**
 * The court-card knowledge table (spec 2026-09-23 rev 3, C2): per-card holding bonuses, authored
 * from each card's implemented effect, restricted by the coverage report (docs/19 §22) to cards
 * whose effect is passive or whose ability the bots actually use.
 */
import { describe, expect, it } from 'vitest'

import { BASE_COURT, courtCard } from '../src/court.js'
import { COURT_KNOWLEDGE, courtTextFor } from '../src/ai/court-knowledge.js'
import { CourtPile, contentsOf, defaultRegistry, featuresOf, intentFor, mobileBot, observe, startGame, stepBots } from '../src/index.js'
import { feasibility } from '../src/ai/feasibility.js'
import type { ChapterIntent, FactionId } from '../src/index.js'

const flat: ChapterIntent = { pursuing: new Map(), leading: 'Tycoon', summary: '' }

describe('court knowledge', () => {
  it('names only base guild cards — never a Vox card, never an unknown id', () => {
    for (const row of COURT_KNOWLEDGE) {
      expect(BASE_COURT.some((c) => c.id === row.id), row.id).toBe(true)
      expect(courtCard(row.id).kind).toBe('guild')
      expect(row.why.length).toBeGreaterThan(10)
    }
  })

  it('leaves out the cards whose abilities the bots never use', () => {
    const ids = new Set(COURT_KNOWLEDGE.map((r) => r.id))
    for (const unused of ['bc04', 'bc05', 'bc10', 'bc11', 'bc16', 'bc17', 'bc24', 'bc08']) {
      expect(ids.has(unused), unused).toBe(false)
    }
  })

  it('is zero for no cards and adds held cards at half weight under no pursuit', () => {
    expect(courtTextFor([], flat)).toBe(0)
    const [a, b] = COURT_KNOWLEDGE
    // bias() with no pursuit is 0.5 for an ambition-linked card; unlinked cards count in full.
    const w = (r: typeof a): number => r!.bonus * (r!.ambition === undefined ? 1 : 0.5)
    expect(courtTextFor([a!.id, b!.id, 'bc26'], flat)).toBeCloseTo(w(a) + w(b), 9)
  })
})

describe('the courtText feature', () => {
  it('is the table value of held cards plus a quarter for cards the faction leads on', () => {
    const F: FactionId[] = ['red', 'yellow', 'blue', 'white']
    const reg = defaultRegistry()
    let r = startGame({ board: 'Board4MixUp1', factions: F, seed: 29, bots: F }, reg)
    const at0 = observe(r.state, 'red')
    expect(featuresOf(at0, 'red', intentFor(at0, 'red', feasibility)).courtText).toBe(0)
    // Somewhere in a long game someone holds a table card; every faction's feature must be at
    // least the held part, which is the part this test can compute independently.
    let seen = false
    for (let i = 0; i < 60 && !r.state.isOver; i++) {
      r = stepBots(r, F, mobileBot, 25, reg).result
      for (const f of F) {
        const view = observe(r.state, f)
        const intent = intentFor(view, f, feasibility)
        const held = courtTextFor([...contentsOf(view.courtCards, CourtPile.secured(f))], intent)
        const x = featuresOf(view, f, intent).courtText
        expect(x).toBeGreaterThanOrEqual(held - 1e-9)
        if (held > 0) seen = true
      }
    }
    expect(seen).toBe(true)
  }, 300_000)
})
