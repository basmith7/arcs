/**
 * The Scoreboard (spec 2026-10-04-scoreboard-catchup-design.md): one glance at who stands where,
 * who is after what, and what the chapter end would pay if it came now. All of it is public and
 * computed here from the state the page already holds (`gameFacts`), so every seat and every
 * watcher sees the same thing and it updates with each move.
 *
 * Desktop opens it as a dialog from the header, in the Settings chrome; a phone shows the same
 * content as its fifth sheet. The projection says "would take": "won" belongs to the real chapter
 * end and its interlude.
 */

import { defaultRegistry, gameFacts } from '@arcs/engine'
import type { AmbitionAward, FactionId, GameFacts, GameState } from '@arcs/engine'
import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useModalDrag } from '../modal-drag.js'
import { store } from '../store.js'
import { colorOf } from '../theme.js'

const registry = defaultRegistry()

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function projected(name: string, ambition: string, a: AmbitionAward): string {
  const verb = a.place === 'first' ? 'would take' : a.place === 'second' ? 'would place second in' : 'would tie'
  return `${name} ${verb} ${ambition} (+${a.power})`
}

export function Scoreboard({ facts, name }: { facts: GameFacts; name: (f: FactionId) => string }): JSX.Element {
  const projection = facts.ifChapterEndedNow?.results.flatMap((r) => r.awards.map((a) => projected(name(a.faction), r.ambition, a)))
  const race = facts.ambitions.filter((a) => a.markers.length > 0 || a.holdings.some((h) => h.value > 0))
  return (
    <div className="sb">
      {projection === undefined ? null : (
        <p className="sb-projection">
          <span className="sb-label">If the chapter ended now:</span>{' '}
          {projection.length === 0 ? 'nobody would score' : projection.join(' · ')}
        </p>
      )}
      <div className="sb-players">
        {facts.factions.map((f) => (
          <section key={f.faction} className="sb-player" style={{ borderColor: colorOf(f.faction) }}>
            <h3 className="sb-name">
              <span style={{ color: colorOf(f.faction) }}>{name(f.faction)}</span>
              <span className="sb-power">{f.power} power</span>
            </h3>
            <dl>
              <dt>Pieces</dt>
              <dd>
                {count(f.cities, 'city', 'cities')} · {count(f.starports, 'starport', 'starports')} ·{' '}
                {count(f.ships, 'ship', 'ships')}
              </dd>
              <dt>Rules</dt>
              <dd>{f.rules.join(', ') || '—'}</dd>
              <dt>Declared</dt>
              <dd>{f.declared.join(', ') || '—'}</dd>
              <dt>Tax base</dt>
              <dd>
                {Object.entries(f.taxBase)
                  .map(([r, n]) => `${n} ${r}`)
                  .join(', ') || '—'}
              </dd>
              <dt>Courting</dt>
              <dd>{f.courting.map((c) => `${c.card} ×${c.agents}`).join(', ') || '—'}</dd>
              <dt>Resources</dt>
              <dd>{f.resources.join(', ') || '—'}</dd>
              <dt>Court</dt>
              <dd>{f.court.join(', ') || '—'}</dd>
              <dt>Hand</dt>
              <dd>{count(f.handSize, 'card', 'cards')}</dd>
            </dl>
          </section>
        ))}
      </div>
      <section className="sb-race">
        <h3 className="set-heading">Ambition race</h3>
        {race.length === 0 ? (
          <p className="sb-quiet">Nobody holds anything toward an ambition yet.</p>
        ) : (
          <ul>
            {race.map((a) => (
              <li key={a.ambition}>
                <span className="sb-ambition">
                  {a.ambition}{' '}
                  <span className="sb-marker">
                    {a.markers.length === 0 ? 'undeclared' : a.markers.map((m) => `${m.high}/${m.low}`).join(' + ')}
                  </span>
                </span>
                <span>
                  {a.holdings
                    .filter((h) => h.value > 0)
                    .map((h) => `${name(h.faction)} ${h.value}`)
                    .join(' · ') || 'nobody holds any'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** The Scoreboard for a state, with the table's names. Shared by the dialog and the phone sheet. */
export function ScoreboardPanel({ state }: { state: GameState }): JSX.Element {
  const facts = useMemo(() => {
    // A view, not a decision: a failure here costs the Scoreboard, never the game screen.
    try {
      return gameFacts(state, registry)
    } catch (e) {
      console.error('[scoreboard] facts failed', e)
      return null
    }
  }, [state])
  if (facts === null) return <p className="sb-quiet">The scoreboard could not be worked out for this position.</p>
  return <Scoreboard facts={facts} name={(f) => store.seatName(f) ?? f} />
}

/** The desktop dialog, in the Settings shell: ✕, Esc and a backdrop click close it. */
export function ScoreboardModal({ state, onClose }: { state: GameState; onClose: () => void }): JSX.Element {
  const drag = useModalDrag()
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
      <div ref={drag.ref} className="da-modal scoreboard-modal" style={drag.style}>
        <div className="da-head" {...drag.handle}>
          <span className="da-title">Scoreboard</span>
          <button className="da-ghost" onClick={onClose} aria-label="Close scoreboard">
            ✕
          </button>
        </div>
        <ScoreboardPanel state={state} />
      </div>
    </div>,
    document.body,
  )
}
