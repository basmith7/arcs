/**
 * The rules as text: the half of the reader that can be searched.
 *
 * The page images (`rules.ts`) are the rulebook as it was printed, and they cannot be searched —
 * which is the one thing you want mid-turn, when you know the word and not the page. This is the
 * same rules from the publisher's own codex, numbered the way that codex numbers them:
 * `scripts/fetch_rules_text.mjs` pulls the tree from the Buried Giant Rules Library and writes
 * `assets/rules/data/rules-text.json`, committed beside the PDFs.
 *
 * Rule numbers here are the library's: `5.1.2` really is that library's `5.1.2-passing-initiative`,
 * so a number quoted at the table finds the same rule in both, and the errata — which the library
 * keys by number — land on the right sections. `test/rules-text.test.ts` holds that alignment.
 *
 * The file is fetched rather than imported so its ~170 KB stays out of the main bundle: nobody
 * pays for it until they open the reader and start typing.
 */
import { asset } from './assets.js'

/** One rule, at whatever depth the tree put it. */
export type RulesSection = {
  /** The library's number, e.g. `5.1.2`. Positional, so it also gives the reading order. */
  readonly number: string
  /** `5.1.2-passing-initiative` — what the library's own URLs point at. */
  readonly anchor: string
  readonly title: string
  /** The names of the sections above this one, outermost first. */
  readonly trail: readonly string[]
  /** The rule itself, in the library's markup — see `parseRulesMarkup`. */
  readonly text: string
  /** Set on everything under the Blighted Reach headings; the base game leaves those out. */
  readonly campaign?: true
}

/** A published correction, hung off the number of the rule it corrects. */
export type RulesErratum = {
  readonly number: string
  readonly text: string
}

export type RulesText = {
  readonly source: string
  readonly publisher: string
  /** The library's own "Updated ..." line, shown so the reader can say how current this is. */
  readonly updated: string
  readonly fetched: string
  readonly chunk: string
  readonly sections: readonly RulesSection[]
  readonly errata: readonly RulesErratum[]
}

export type RulesHit = {
  readonly section: RulesSection
  readonly score: number
  /** A window of the rule's text around the first match, for the results list. */
  readonly snippet: string
}

/** Fetched once and shared; the reader can open and close without paying again. */
let pending: Promise<RulesText> | undefined

export function loadRulesText(): Promise<RulesText> {
  pending ??= fetch(asset('rules/data/rules-text.json')).then((r) => {
    if (!r.ok) throw new Error(`rules text: ${r.status}`)
    return r.json() as Promise<RulesText>
  })
  return pending
}

/** A bare rule number typed into the box — `5.1`, `5.1.2` — rather than words to look for. */
const NUMBER = /^\d+(\.\d+)*$/

/** Words to match on: lowercased, stripped of the punctuation that clings to them. */
function words(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 0)
}

/** Sections in reading order — `5.10` after `5.9`, which a string sort gets backwards. */
function byNumber(a: RulesSection, b: RulesSection): number {
  const left = a.number.split('.').map(Number)
  const right = b.number.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const d = (left[i] ?? 0) - (right[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * A rule with its markup taken off: what the text would read as aloud.
 *
 * Both the search and the snippets run on this rather than the raw text. Searching the raw text
 * matches inside the library's own tokens — `key` would hit every `` `symbol:key` `` in the book —
 * and a snippet cut from it shows the reader backticks and asterisks instead of a sentence.
 */
export function plainRulesText(text: string): string {
  return parseRulesMarkup(text)
    .map((node) => {
      switch (node.kind) {
        case 'break':
          return ' '
        // The glyph itself cannot be typed and does not read as a word; the sentence survives it.
        case 'symbol':
          return ''
        case 'ref':
          return node.label
        default:
          return node.text
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `plainRulesText` per section, kept because the search runs it on every section per keystroke. */
const plain = new WeakMap<RulesSection, string>()

function plainOf(section: RulesSection): string {
  let cached = plain.get(section)
  if (cached === undefined) {
    cached = plainRulesText(section.text)
    plain.set(section, cached)
  }
  return cached
}

const SNIPPET = 160

/**
 * A window of `text` around the first hit, cut at word boundaries and elided on both sides.
 *
 * The results list shows the rule's name and this; a long rule shown whole would push every other
 * result off the screen, which is the opposite of what searching was for.
 */
function snippetAround(text: string, word: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= SNIPPET) return flat
  const at = flat.toLowerCase().indexOf(word)
  if (at < 0) return `${flat.slice(0, SNIPPET).trimEnd()}…`
  const start = Math.max(0, at - SNIPPET / 3)
  const cut = flat.slice(start, start + SNIPPET)
  // Don't start or end mid-word — the ellipsis should be the only sign of what was dropped.
  const head = start === 0 ? cut : cut.slice(cut.indexOf(' ') + 1)
  const tail = start + SNIPPET >= flat.length ? head : head.slice(0, head.lastIndexOf(' '))
  return `${start === 0 ? '' : '…'}${tail}${start + SNIPPET >= flat.length ? '' : '…'}`
}

/**
 * The rules matching `query`, best first.
 *
 * Every word has to appear somewhere in the section — a search that ORed them would return most
 * of the rulebook for any two-word question. Where a word appears decides the order: the title is
 * worth more than the trail above it, which is worth more than the body, so "battle" leads with
 * the rule called Battle rather than the first rule that happens to mention battles.
 *
 * The campaign rules are in the file but out of the search by default: this game is the base game
 * (`docs/04-scope-and-phasing.md`), and a hit on a Blighted Reach rule is a wrong answer here.
 */
export function searchRules(
  data: RulesText,
  query: string,
  opts: { readonly campaign?: boolean; readonly limit?: number } = {},
): RulesHit[] {
  const pool = data.sections.filter((s) => opts.campaign === true || s.campaign !== true)
  const terms = words(query)
  if (terms.length === 0) return []

  if (NUMBER.test(query.trim())) {
    const prefix = query.trim()
    return pool
      .filter((s) => s.number === prefix || s.number.startsWith(`${prefix}.`))
      .sort(byNumber)
      .slice(0, opts.limit ?? 50)
      .map((section) => ({
        section,
        score: 100,
        snippet: snippetAround(plainOf(section), ''),
      }))
  }

  const hits: RulesHit[] = []
  for (const section of pool) {
    const title = section.title.toLowerCase()
    const trail = section.trail.join(' ').toLowerCase()
    const text = plainOf(section).toLowerCase()
    let score = 0
    let missed = false
    for (const term of terms) {
      const inTitle = title.includes(term)
      const inTrail = trail.includes(term)
      const inText = text.includes(term)
      if (!inTitle && !inTrail && !inText) {
        missed = true
        break
      }
      score += (inTitle ? 6 : 0) + (inTrail ? 2 : 0) + (inText ? 1 : 0)
    }
    if (missed) continue
    // A section whose title *is* the phrase beats one that merely contains all of its words.
    const phrase = query.trim().toLowerCase()
    if (title === phrase) score += 8
    else if (text.includes(phrase)) score += 2
    hits.push({
      section,
      score,
      snippet: snippetAround(plainOf(section), terms[0]!),
    })
  }

  return hits
    .sort((a, b) => b.score - a.score || byNumber(a.section, b.section))
    .slice(0, opts.limit ?? 50)
}

/** The correction published against a rule, if there is one. */
export function erratumFor(data: RulesText, number: string): RulesErratum | undefined {
  return data.errata.find((e) => e.number === number)
}

/**
 * The section a cross-reference points at, if the reader can follow it.
 *
 * References come two ways. By number is exact. By name is a `$`-separated path — `Standard
 * Actions$Move` — which the library resolves against the rule doing the pointing; here it is
 * matched against the tail of each section's own path, so `Move` finds the Move under Standard
 * Actions without the reference having to spell out where it started. The shallowest match wins,
 * which is the one a reader following a link means: the section itself, not a subsection of it
 * that repeats the name.
 */
export function resolveRulesRef(
  data: RulesText,
  ref: { readonly number?: string; readonly name?: string },
): RulesSection | undefined {
  if (ref.number !== undefined) return data.sections.find((s) => s.number === ref.number)
  if (ref.name === undefined) return undefined
  const parts = ref.name
    .split('$')
    .map((p) => p.trim().replace(/\.$/, '').toLowerCase())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return undefined
  const matches = data.sections.filter((s) => {
    const path = [...s.trail, s.title].map((p) => p.replace(/\.$/, '').toLowerCase())
    return parts.every((part, i) => path[path.length - parts.length + i] === part)
  })
  return matches.sort((a, b) => a.number.split('.').length - b.number.split('.').length)[0]
}

/** One piece of a rule's text, in the order it should be drawn. */
export type RulesNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  /** `***like this***` — the library's strongest emphasis, used for the words that catch people. */
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'symbol'; readonly name: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }
  /** A cross-reference: `number` when the library gave one, `name` when it named the rule. */
  | {
      readonly kind: 'ref'
      readonly label: string
      readonly number?: string
      readonly name?: string
    }

/**
 * Split the library's markup into things a component can draw.
 *
 * The text is Markdown-ish with three tokens of the library's own, all in backticks:
 *
 *   - `` `rule:3.2.1` `` — a cross-reference by number.
 *   - `` `rule-relative:Standard Actions$Move` `` — one by name, `$`-separated down the tree; the
 *     leaf is what reads best as the link's label.
 *   - `` `symbol:diamond` `` — an icon standing in for a printed glyph.
 *
 * Everything else it uses is ordinary: `**bold**`, `***emphasis***`, `[text](href)`, and `<br>`.
 * The three-star form has to be tried first, or the two-star rule eats its opening pair and leaves
 * the stray stars in the text. Lists are handled a level up, by `parseRulesBlocks`.
 */
export function parseRulesMarkup(text: string): RulesNode[] {
  const out: RulesNode[] = []
  const push = (t: string): void => void (t.length > 0 && out.push({ kind: 'text', text: t }))
  // One pass, one alternation: whichever token comes first wins, and the gap before it is text.
  const token = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|<br\s*\/?>/gi
  let last = 0
  for (let m = token.exec(text); m !== null; m = token.exec(text)) {
    push(text.slice(last, m.index))
    last = m.index + m[0].length
    const [, em, bold, code, linkText, href] = m
    if (em !== undefined) out.push({ kind: 'em', text: em })
    else if (bold !== undefined) out.push({ kind: 'bold', text: bold })
    else if (linkText !== undefined && href !== undefined)
      out.push({ kind: 'link', text: linkText, href })
    else if (code !== undefined) {
      const rule = /^rule:(.+)$/.exec(code)
      const relative = /^rule-relative:(.+)$/.exec(code)
      const symbol = /^symbol:(.+)$/.exec(code)
      if (rule) out.push({ kind: 'ref', number: rule[1]!, label: rule[1]! })
      else if (relative)
        out.push({
          kind: 'ref',
          name: relative[1]!,
          label: relative[1]!.slice(relative[1]!.lastIndexOf('$') + 1),
        })
      else if (symbol) out.push({ kind: 'symbol', name: symbol[1]! })
      else push(code)
    } else out.push({ kind: 'break' })
  }
  push(text.slice(last))
  return out
}

/** A rule's text as paragraphs and list items, each already parsed into nodes. */
export type RulesBlock = {
  readonly kind: 'p' | 'li'
  readonly nodes: readonly RulesNode[]
}

/** Split on blank lines, with `- ` lines becoming list items. */
export function parseRulesBlocks(text: string): RulesBlock[] {
  const blocks: RulesBlock[] = []
  for (const chunk of text.split(/\n{2,}/)) {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      const item = /^[-*]\s+(.*)$/.exec(trimmed)
      blocks.push(
        item
          ? { kind: 'li', nodes: parseRulesMarkup(item[1]!) }
          : { kind: 'p', nodes: parseRulesMarkup(trimmed) },
      )
    }
  }
  return blocks
}
