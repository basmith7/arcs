#!/usr/bin/env node
/**
 * Fetch the searchable rules text from the publisher's rules library.
 *
 * The reader shows page images (`build_rules_pages.py`), which cannot be searched. This pulls the
 * same rules as *text*, from the Buried Giant Rules Library — the official codex for Arcs since
 * the rights moved to Buried Giant Studios in January 2026:
 *
 *     https://rules.buriedgiant.com/?product=arcs&locale=en-US&printing=p1
 *
 * That site is an Angular app which bundles its content into a JS chunk rather than serving it
 * from an API, so this walks the bundle: find `var <name>={arcs:{...}}`, slice the object literal
 * out by balancing braces, and evaluate it. Three of those objects matter — the rules tree, the
 * errata keyed by rule number, and the i18n block that carries the "Updated <date>" line.
 *
 * Rule numbers are positional: the tree's 5th top-level section, its 1st child, that child's 2nd
 * child is `5.1.2`, and the library's own anchors are `5.1.2-passing-initiative`. Errata point at
 * those numbers, so the flattening here has to number sections exactly the same way or the errata
 * attach to the wrong rules.
 *
 * Output is `assets/rules/data/rules-text.json`, committed like the page images and read by
 * `apps/web/src/rules-text.ts`. Re-run when the library updates:
 *
 *     node scripts/fetch_rules_text.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = 'https://rules.buriedgiant.com'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets/rules/data/rules-text.json')

/**
 * Top-level sections belonging to the Blighted Reach campaign. The game is base-only (phase 1,
 * `docs/04-scope-and-phasing.md`), so these are kept in the file but flagged, and the reader
 * leaves them out until the campaign itself arrives.
 */
const CAMPAIGN = new Set([
  'The Campaign',
  'Campaign Rules & Terms',
  'The Empire',
  'Blight & the Free States',
  'Events & the Imperial Council',
  'Summits',
  'Crises',
  'Edicts',
  'Flagships',
  'Intermission',
])

async function bundle() {
  const index = await (await fetch(`${SITE}/`)).text()
  const names = [...index.matchAll(/(?:main|chunk)-[A-Z0-9]+\.js/g)].map((m) => m[0])
  const unique = [...new Set(names)]
  const chunks = await Promise.all(
    unique.map(async (n) => ({
      name: n,
      body: await (await fetch(`${SITE}/${n}`)).text(),
    })),
  )
  // The content chunk is the one carrying the rules object; it is also by far the largest.
  const hit = chunks.find((c) => c.body.includes('={arcs:{"en-US":{p1:{rules:['))
  if (!hit) throw new Error('no chunk on the page holds the arcs rules — the site changed')
  return hit
}

/** The object literal assigned to `var <name>=`, sliced out by balancing braces. */
function literal(source, name) {
  const head = `var ${name}={arcs:{`
  const start = source.indexOf(head)
  if (start < 0) throw new Error(`no object literal named ${name}`)
  let i = start + `var ${name}=`.length
  const from = i
  let depth = 0
  let quote = null
  let escaped = false
  for (; i < source.length; i++) {
    const c = source[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (quote !== null) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return source.slice(from, i + 1)
  }
  throw new Error(`unbalanced object literal for ${name}`)
}

/** Every `{arcs:{...}}` object in the chunk, by the variable it is bound to. */
function arcsObjects(source) {
  const out = {}
  for (const m of source.matchAll(/var ([A-Za-z_$][\w$]*)=\{arcs:\{/g)) {
    // eslint-disable-next-line no-eval -- the sliced literal is data, not the site's code.
    out[m[1]] = (0, eval)(`(${literal(source, m[1])})`)
  }
  return out
}

/** `Passing Initiative.` -> `passing-initiative`, the slug half of the library's own anchors. */
function slug(name) {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The rules tree as a flat list, in reading order, numbered the way the library numbers it.
 *
 * A section contributes its own `pretext` and `text` — the tree puts prose on parents as well as
 * leaves — and every section keeps the trail of names above it so a search hit can say where it
 * sits without the reader walking back up.
 */
function flatten(rules) {
  const out = []
  const walk = (nodes, prefix, trail, campaign) => {
    nodes.forEach((node, i) => {
      const number = [...prefix, i + 1].join('.')
      const title = node.name.replace(/\.$/, '')
      const body = [node.pretext, node.text].filter(Boolean).join('\n\n').trim()
      const inCampaign = campaign || (prefix.length === 0 && CAMPAIGN.has(node.name))
      out.push({
        number,
        anchor: `${number}-${slug(node.name)}`,
        title,
        trail,
        text: body,
        ...(inCampaign ? { campaign: true } : {}),
      })
      if (node.children?.length) {
        walk(node.children, [...prefix, i + 1], [...trail, title], inCampaign)
      }
    })
  }
  walk(rules, [], [], false)
  return out
}

const dryRun = process.argv.includes('--dry-run')
const { name, body } = await bundle()
const objects = arcsObjects(body)

const rulesJson = Object.values(objects).find((o) => o.arcs?.['en-US']?.p1?.rules)
const errataJson = Object.values(objects).find((o) => Array.isArray(o.arcs?.['en-US']))
const i18nJson = Object.values(objects).find((o) => o.arcs?.['en-US']?.App?.NavTitle)

if (!rulesJson) throw new Error('the chunk no longer holds a rules tree')

const sections = flatten(rulesJson.arcs['en-US'].p1.rules)
const byNumber = new Map(sections.map((s) => [s.number, s]))

/** Errata hang off rule numbers; a number the tree does not have means the two have drifted. */
const errata = []
for (const entry of errataJson?.arcs['en-US'] ?? []) {
  for (const number of entry.rules ?? []) {
    if (!byNumber.has(number)) {
      console.warn(`errata points at ${number}, which no rule has — skipped`)
      continue
    }
    errata.push({ number, text: entry.text.trim() })
  }
}

const data = {
  source: `${SITE}/?product=arcs&locale=en-US&printing=p1`,
  publisher: 'Buried Giant Studios',
  updated: i18nJson?.arcs['en-US'].App.NavTitleShort ?? 'unknown',
  fetched: new Date().toISOString().slice(0, 10),
  chunk: name,
  sections,
  errata,
}

const json = `${JSON.stringify(data, null, 1)}\n`
const base = sections.filter((s) => !s.campaign).length
console.log(
  `${sections.length} sections (${base} base, ${sections.length - base} campaign), ` +
    `${errata.length} errata, updated ${data.updated}, ${(json.length / 1024).toFixed(0)} KB`,
)
if (dryRun) process.exit(0)

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, json)
console.log(`wrote ${path.relative(ROOT, OUT)}`)
