/**
 * "End your turn?": the turn's last move, held on this device until the player sends it.
 *
 * The store holds the move (`store.endTurnPending`) and the board already shows it, so this is only
 * the question: what the turn did, End turn, Undo last move, and Start over. Start over goes back
 * to the turn's start through the same take-back the Undo button uses, so it stops short of a
 * move that rolled dice or drew a card, and says so.
 */

import { store } from '../store.js'
import { LogPanel } from './LogPanel.js'

export function EndTurn({ log }: { log: readonly string[] }): JSX.Element {
  const plan = store.startOverPlan()
  // The held move is always undoable; Start over is worth offering only if it reaches further back.
  const further = plan !== null && plan.moves > 0
  return (
    <section className="end-turn" role="dialog" aria-label="End your turn?">
      <h3 className="end-turn-title">End your turn?</h3>
      <div className="end-turn-moves">
        <LogPanel log={log} only="last-turn" />
      </div>
      {plan?.blockedBy === undefined ? null : (
        <p className="end-turn-note">
          {further ? 'Start over goes back as far as it can: ' : "Can't go back further: "}
          {plan.blockedBy}.
        </p>
      )}
      <div className="end-turn-actions">
        {further ? (
          <button className="ghost" onClick={() => store.startOver()}>
            Start over
          </button>
        ) : null}
        <button className="ghost" onClick={() => store.undo()}>
          Undo last move
        </button>
        <button className="end-turn-send" onClick={() => store.endTurn()} autoFocus>
          End turn
        </button>
      </div>
    </section>
  )
}
