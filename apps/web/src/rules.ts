/**
 * The rules documents the in-game reader offers.
 *
 * The PDFs live in `assets/rules` and their pages are rendered beside them by
 * `scripts/build_rules_pages.py`; `public/rules` is a symlink to that directory, the same
 * arrangement `public/game-assets` uses for the card art. `page` and `pdf` therefore go through
 * `asset()` so the deployment's base path is honoured.
 *
 * `pages` is written by hand and checked against what the script actually rendered by
 * `test/rules.test.ts` — the reader has no way to notice a document that grew or shrank.
 *
 * Pages cannot be searched. The reader's other tab can: `rules-text.ts` holds the same rules as
 * text, from the publisher's codex. These are the printed documents; that is the index of them.
 */
import { asset } from './assets.js'

export type RulesDoc = {
  /** Basename of the PDF, and the directory its pages were rendered into. */
  readonly id: string
  readonly title: string
  /** One line under the tabs, saying what this document is for. */
  readonly blurb: string
  readonly pages: number
  /**
   * Page width over height, as rendered. The reader hands this to `aspect-ratio` so an unloaded
   * page still occupies its full height: without it the whole document collapses to a stack of
   * zero-height images, every one of them inside the viewport at once, and `loading="lazy"`
   * fetches all 24 rulebook pages the moment the tab opens.
   */
  readonly aspect: number
}

/** Tab order: shortest first, since the quick reference is what you open mid-turn. */
export const RULES: readonly RulesDoc[] = [
  {
    id: 'condensed-aid',
    title: 'Player Aid',
    blurb: 'One page: every action, what it costs, and what it does.',
    pages: 1,
    aspect: 1166 / 1654,
  },
  {
    id: 'aid-booklet',
    title: 'Aid Booklet',
    blurb: 'Four pages walking a chapter through, turn by turn.',
    pages: 4,
    aspect: 1205 / 1812,
  },
  {
    id: 'base-rulebook',
    title: 'Rulebook',
    blurb: 'The full base rulebook, August 27 2025 — including the glossary and index.',
    pages: 24,
    aspect: 1418 / 2048,
  },
]

/** The image for one page, numbered from 1 as the reader displays it. */
export function rulesPage(doc: RulesDoc, page: number): string {
  return asset(`rules/pages/${doc.id}/${String(page).padStart(2, '0')}.webp`)
}

/** The source PDF — what the reader links for anyone who wants to search the text. */
export function rulesPdf(doc: RulesDoc): string {
  return asset(`rules/${doc.id}.pdf`)
}
