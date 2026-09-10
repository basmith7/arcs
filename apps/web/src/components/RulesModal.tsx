/**
 * The rules reader: the rulebook and the two player aids, as pages you scroll.
 *
 * The documents are PDFs (`assets/rules`), but this shows the WebP pages
 * `scripts/build_rules_pages.py` renders from them rather than embedding the files. A browser's
 * own PDF viewer arrives with its own toolbar and its own idea of a page, which reads as another
 * program opened on top of this one, and on a phone it barely works at all. Pages as images wear
 * the same console chrome as every other dialog here and scroll like anything else. What that
 * loses is text search, which the last tab gives back: the same rules as text, from the
 * publisher's codex (`RulesSearch`). The header still links the source PDF, for anyone who wants
 * the rulebook open on a second screen.
 *
 * Like `SettingsModal`, and for the same reason, this is not wrapped in `Watching`: reading the
 * rules is not a decision, and a spectator is often the person most in need of them.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useModalDrag } from '../modal-drag.js'
import { RULES, rulesPage, rulesPdf, type RulesDoc } from '../rules.js'
import { RulesSearch } from './RulesSearch.js'

export function RulesModal({ onClose }: { onClose: () => void }): JSX.Element {
  const drag = useModalDrag()
  /**
   * Which tab is showing: one of the page-image documents, or the searchable text (`'text'`).
   * The text tab is not a `RulesDoc` because it has no pages and no PDF — it is the same rules
   * from the publisher's codex, and the header's PDF link has nothing to point at while it is up.
   */
  const [doc, setDoc] = useState<RulesDoc | 'text'>(RULES[0]!)
  /** The scroller, so switching documents starts the new one at its first page. */
  const pages = useRef<HTMLDivElement>(null)
  /** Where the press that might close this started — see `SettingsModal`. */
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className={`da-backdrop${drag.dragged ? ' aside' : ''}`}
      onPointerDown={(e) => void (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose()
      }}
    >
      <div ref={drag.ref} className="da-modal rules-modal" style={drag.style}>
        <div className="da-head" {...drag.handle}>
          <span className="da-title">Rules</span>
          {doc !== 'text' && (
            <a
              className="da-ghost rules-pdf"
              href={rulesPdf(doc)}
              target="_blank"
              rel="noreferrer"
              // Dragging the dialog by its header must not also count as clicking the link.
              draggable={false}
            >
              PDF ↓
            </a>
          )}
          <button className="da-ghost" onClick={onClose} aria-label="Close rules">
            ✕
          </button>
        </div>

        <div className="rules-tabs" role="tablist" aria-label="Rules documents">
          {RULES.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={doc !== 'text' && d.id === doc.id}
              className={`rules-tab${doc !== 'text' && d.id === doc.id ? ' on' : ''}`}
              onClick={() => {
                setDoc(d)
                pages.current?.scrollTo({ top: 0 })
              }}
            >
              {d.title}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={doc === 'text'}
            className={`rules-tab${doc === 'text' ? ' on' : ''}`}
            onClick={() => setDoc('text')}
          >
            Search
          </button>
        </div>
        {doc !== 'text' && <p className="rules-blurb">{doc.blurb}</p>}

        {doc === 'text' ? (
          <RulesSearch />
        ) : (
          <div className="rules-pages" ref={pages}>
            {Array.from({ length: doc.pages }, (_, i) => i + 1).map((n) => (
              <img
                key={`${doc.id}-${n}`}
                className="rules-page"
                src={rulesPage(doc, n)}
                alt={`${doc.title}, page ${n}`}
                style={{ aspectRatio: doc.aspect }}
                /*
                 * The first page is what the reader opens on, so it is worth the round trip
                 * immediately; the other 23 wait until they are scrolled towards.
                 */
                loading={n === 1 ? 'eager' : 'lazy'}
                decoding="async"
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
