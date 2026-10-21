/**
 * "End your turn?": the turn's last move, held on this device until the player sends it.
 *
 * The store holds the move (`store.endTurnPending`) and the board already shows it, so this is only
 * the question: what the turn did, split where Start over would land, End turn, Undo last move and
 * Start over. Start over goes back through the same take-back the Undo button uses, so it stops
 * short of a move that rolled dice or drew a card. Nobody else can move until the turn is sent,
 * so End turn sends itself when the countdown on it runs out.
 */

import { useEffect, useState } from 'react'

import { store } from '../store.js'
import { LogPanel } from './LogPanel.js'

export function EndTurn(): JSX.Element | null {
  const plan = store.startOverPlan()
  const left = useCountdown(store.endTurnAt())
  if (plan === null) return null
  // The held move is always undoable; Start over is worth offering only if it reaches further back.
  const further = plan.moves > 0
  return (
    <section className="end-turn" role="dialog" aria-label="End your turn?">
      <h3 className="end-turn-title">End your turn?</h3>
      <div className="end-turn-moves">
        {plan.locked.length === 0 ? null : (
          <div className="end-turn-locked">
            <p className="end-turn-label">Locked in: {plan.blockedBy}</p>
            <LogPanel log={plan.locked} />
          </div>
        )}
        <p className="end-turn-label">
          {plan.locked.length === 0 ? 'Start over goes back to the start of your turn' : 'Start over takes back'}
        </p>
        <LogPanel log={plan.undone} />
      </div>
      <div className="end-turn-actions">
        {further ? (
          <button className="ghost" onClick={() => store.startOver()}>
            Start over
          </button>
        ) : null}
        <button className="ghost" onClick={() => store.undo()}>
          Undo last move
        </button>
        <button
          className="end-turn-send"
          onClick={() => store.endTurn()}
          title="Sends itself when the clock runs out, or when you leave the page"
          autoFocus
        >
          End turn <span className="end-turn-clock">{clock(left)}</span>
        </button>
      </div>
    </section>
  )
}

/** Milliseconds until `at`, re-rendered each second. */
function useCountdown(at: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return at === null ? 0 : Math.max(0, at - now)
}

function clock(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
