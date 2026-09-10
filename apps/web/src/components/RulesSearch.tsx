/**
 * The rules as text, with a search box — the tab that answers "where does it say that?".
 *
 * The other tabs are page images, which are the rulebook as printed and cannot be searched. This
 * one reads `assets/rules/data/rules-text.json` (see `rules-text.ts`): the publisher's own codex,
 * numbered the way the codex numbers it, so `5.1.2` here is `5.1.2` at the table and `5.1.2` in
 * the library online.
 *
 * Three states, in the order a reader moves through them: the contents, a list of hits, and one
 * rule opened with everything under it. Opening a rule reads as a chapter rather than a card —
 * the descendants are drawn inline, because a rule with its sub-rules hidden behind another click
 * is how a rules reference becomes useless.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  erratumFor,
  loadRulesText,
  parseRulesBlocks,
  parseRulesMarkup,
  resolveRulesRef,
  searchRules,
  type RulesNode,
  type RulesSection,
  type RulesText,
} from '../rules-text.js'

/** The printed glyphs the text leans on, as the nearest thing a font can say. */
const SYMBOLS: Record<string, string> = {
  diamond: '◆',
  arrow: '→',
  hex: '⬡',
  moon: '☾',
  selfhit: '💥',
  intercept: '⤬',
  hit: '✦',
  buildinghit: '⌂',
  key: '🔑',
  player: '👤',
  crisis: '⚠',
  edict: '§',
}

function Inline({
  nodes,
  data,
  onOpen,
}: {
  nodes: readonly RulesNode[]
  data: RulesText
  onOpen: (number: string) => void
}): JSX.Element {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'text':
            return <span key={i}>{node.text}</span>
          case 'bold':
            return <strong key={i}>{node.text}</strong>
          case 'em':
            return (
              <strong key={i}>
                <em>{node.text}</em>
              </strong>
            )
          case 'break':
            return <br key={i} />
          case 'symbol':
            return (
              <span key={i} className="rules-symbol" title={node.name}>
                {SYMBOLS[node.name] ?? `[${node.name}]`}
              </span>
            )
          case 'link':
            return (
              <a key={i} href={node.href} target="_blank" rel="noreferrer">
                {node.text}
              </a>
            )
          case 'ref': {
            const target = resolveRulesRef(data, node)
            // A reference the file cannot resolve still reads as text; it just does not click.
            if (!target) return <span key={i}>{node.label}</span>
            return (
              <button key={i} className="rules-ref" onClick={() => onOpen(target.number)}>
                {node.label}
              </button>
            )
          }
        }
      })}
    </>
  )
}

/** One rule: its heading, its errata if any, its text. Used for the opened rule and its children. */
function Section({
  section,
  data,
  onOpen,
  depth,
}: {
  section: RulesSection
  data: RulesText
  onOpen: (number: string) => void
  depth: number
}): JSX.Element {
  const erratum = erratumFor(data, section.number)
  return (
    <section className="rules-section" style={{ marginLeft: `${Math.min(depth, 3) * 0.75}rem` }}>
      <h4 className="rules-section-head">
        <span className="rules-number">{section.number}</span> {section.title}
      </h4>
      {erratum && (
        <p className="rules-erratum">
          <span className="rules-erratum-tag">Errata</span>{' '}
          <Inline nodes={parseRulesMarkup(erratum.text)} data={data} onOpen={onOpen} />
        </p>
      )}
      {parseRulesBlocks(section.text).map((block, i) =>
        block.kind === 'li' ? (
          <li key={i} className="rules-li">
            <Inline nodes={block.nodes} data={data} onOpen={onOpen} />
          </li>
        ) : (
          <p key={i}>
            <Inline nodes={block.nodes} data={data} onOpen={onOpen} />
          </p>
        ),
      )}
    </section>
  )
}

export function RulesSearch(): JSX.Element {
  const [data, setData] = useState<RulesText | undefined>()
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | undefined>()
  /** The scroller, so opening a rule or a new search starts at the top rather than mid-page. */
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    loadRulesText().then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    )
    return () => void (live = false)
  }, [])

  const hits = useMemo(
    () => (data === undefined ? [] : searchRules(data, query, { limit: 40 })),
    [data, query],
  )

  const openSection = (number: string): void => {
    setOpen(number)
    body.current?.scrollTo({ top: 0 })
  }

  if (failed) return <p className="rules-blurb">The rules text could not be loaded.</p>
  if (data === undefined) return <p className="rules-blurb">Loading the rules…</p>

  const current = open === undefined ? undefined : data.sections.find((s) => s.number === open)
  /** Everything under the opened rule: its own subsections, in reading order. */
  const descendants =
    current === undefined
      ? []
      : data.sections.filter((s) => s.number.startsWith(`${current.number}.`))
  const contents = data.sections.filter((s) => !s.number.includes('.') && s.campaign !== true)

  return (
    <>
      <div className="rules-search">
        <input
          className="rules-search-input"
          type="search"
          value={query}
          placeholder="Search the rules — a word, a phrase, or a rule number"
          aria-label="Search the rules"
          autoFocus
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(undefined)
            body.current?.scrollTo({ top: 0 })
          }}
        />
        {current && (
          <button className="da-ghost" onClick={() => setOpen(undefined)}>
            ← {query.trim() === '' ? 'Contents' : 'Results'}
          </button>
        )}
      </div>

      <div className="rules-text-body" ref={body}>
        {current ? (
          <>
            {current.trail.length > 0 && <p className="rules-trail">{current.trail.join(' › ')}</p>}
            <Section section={current} data={data} onOpen={openSection} depth={0} />
            {descendants.map((s) => (
              <Section
                key={s.number}
                section={s}
                data={data}
                onOpen={openSection}
                depth={s.number.split('.').length - current.number.split('.').length}
              />
            ))}
          </>
        ) : query.trim() === '' ? (
          <ul className="rules-contents">
            {contents.map((s) => (
              <li key={s.number}>
                <button className="rules-hit" onClick={() => openSection(s.number)}>
                  <span className="rules-number">{s.number}</span>
                  <span className="rules-hit-title">{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : hits.length === 0 ? (
          <p className="rules-blurb">Nothing in the rules matches that.</p>
        ) : (
          <ul className="rules-hits">
            {hits.map((hit) => (
              <li key={hit.section.number}>
                <button className="rules-hit" onClick={() => openSection(hit.section.number)}>
                  <span className="rules-number">{hit.section.number}</span>
                  <span className="rules-hit-title">
                    {hit.section.trail.length > 0 && (
                      <span className="rules-trail">{hit.section.trail.join(' › ')} › </span>
                    )}
                    {hit.section.title}
                  </span>
                  <span className="rules-snippet">{hit.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="rules-credit">
        Rules text from the{' '}
        <a href={data.source} target="_blank" rel="noreferrer">
          {data.publisher} Rules Library
        </a>
        , updated {data.updated}.
      </p>
    </>
  )
}
