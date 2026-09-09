/**
 * `rules.ts` declares how many pages each document has; `scripts/build_rules_pages.py` decides
 * how many there actually are. Nothing in the app notices when those disagree — the reader just
 * stops early, or asks for a page that 404s — so this is where a re-render that changed a page
 * count has to fail.
 */
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { RULES } from '../src/rules.js'

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'rules')

describe('the rules documents match what was rendered', () => {
  for (const doc of RULES) {
    describe(doc.id, () => {
      it('has its source PDF', () => {
        expect(existsSync(join(RULES_DIR, `${doc.id}.pdf`))).toBe(true)
      })

      it(`has exactly its ${doc.pages} declared pages on disk`, () => {
        const files = readdirSync(join(RULES_DIR, 'pages', doc.id)).sort()
        expect(files).toEqual(
          Array.from({ length: doc.pages }, (_, i) => `${String(i + 1).padStart(2, '0')}.webp`),
        )
      })
    })
  }

  it('renders every document that was built', () => {
    expect(readdirSync(join(RULES_DIR, 'pages')).sort()).toEqual(RULES.map((d) => d.id).sort())
  })
})
