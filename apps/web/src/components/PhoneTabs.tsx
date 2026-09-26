/**
 * The phone layout's tab bar: the panels that do not fit beside the map — court, ambitions, the
 * player boards and the log — each opened as a sheet over it. App.tsx keeps every panel mounted
 * and marks the open one on `.app[data-sheet]`; phone.css does the showing.
 *
 * Sheets follow the decision. When the ask is the ambition track's, its sheet opens by itself and
 * its tab carries a dot; when the ask moves to the map or the dock, an open sheet closes so what
 * is being asked about is in view. That happens once per new ask — a sheet the player opens
 * mid-decision stays open.
 */

import type { Continue } from '@arcs/engine'
import { useEffect } from 'react'

import type { Sheet } from '../phone.js'
import { surfaceFor } from '../surfaces.js'

const TABS: readonly (readonly [Sheet, string])[] = [
  ['court', 'Court'],
  ['ambitions', 'Ambitions'],
  ['boards', 'Players'],
  ['log', 'Log'],
]

interface Props {
  cont: Continue
  /** False while somebody else decides: nothing is asked of this screen, so nothing opens itself. */
  acting: boolean
  sheet: Sheet | null
  onSheet: (sheet: Sheet | null) => void
}

export function PhoneTabs({ cont, acting, sheet, onSheet }: Props): JSX.Element {
  const surface = acting ? surfaceFor(cont) : undefined
  const askKey =
    cont.kind === 'ask'
      ? `${surface}:${cont.faction}:${cont.actions.map((a) => a.type).join()}`
      : cont.kind
  useEffect(() => {
    if (surface === 'ambitions') onSheet('ambitions')
    else if (surface !== undefined) onSheet(null)
    // Once per ask, not on every render: see the header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey])

  return (
    <nav className="phone-tabs" aria-label="Panels">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          className={sheet === id ? 'on' : ''}
          aria-pressed={sheet === id}
          onClick={() => onSheet(sheet === id ? null : id)}
        >
          {label}
          {id === 'ambitions' && surface === 'ambitions' ? <span className="phone-dot" /> : null}
        </button>
      ))}
    </nav>
  )
}

/** The bar over an open sheet: its name and a way to put it away. */
export function SheetHead({ sheet, onClose }: { sheet: Sheet; onClose: () => void }): JSX.Element {
  const label = TABS.find(([id]) => id === sheet)?.[1] ?? ''
  return (
    <div className="phone-sheet-head">
      <span>{label}</span>
      <button className="ghost" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  )
}
