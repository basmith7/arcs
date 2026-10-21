/**
 * "Can't be undone": a move that draws or peeks, waiting for Go ahead.
 *
 * Online, Undo refuses such a move (`takeBackBlock`), so a misclick on one is permanent. The store
 * holds it unsent and unseen (`store.riskyMove`) until the player says so; Cancel forgets it. The
 * battle window's Roll skips this: it says so beside the button instead (`apply`'s `warned`).
 *
 * Portalled over everything: the move can come from inside another dialog (a raid's card pick in
 * the battle window), which would otherwise cover the question it raised.
 */

import { createPortal } from 'react-dom'

import { store } from '../store.js'

export function RiskyMove({ why }: { why: string }): JSX.Element {
  return createPortal(
    <div className="risky-backdrop" role="presentation">
      <section className="end-turn risky" role="alertdialog" aria-label="This can't be undone">
        <h3 className="end-turn-title">This can't be undone</h3>
        <p className="end-turn-note">Undo won't be able to take this move back ({why}).</p>
        <div className="end-turn-actions">
          <button className="ghost" onClick={() => store.undo()}>
            Cancel
          </button>
          <button className="end-turn-send" onClick={() => store.confirmRisky()} autoFocus>
            Go ahead
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
