/**
 * The round so far, in the phone layout's map corner: the lead and each follow as a small card
 * edged in its player's colour.
 *
 * The desktop's played-cards rail is a whole column, and on a phone it lives in the Court sheet —
 * but following a lead is the most common decision there is, and it cannot be made without seeing
 * what was led. So the round stays on screen in miniature; a tap opens the sheet for a proper look.
 */

import type { GameState } from '@arcs/engine'

import { smallArt } from '../assets.js'
import { colorOf } from '../theme.js'
import { CardFace } from './CardFace.js'

export function PhonePlays({
  state,
  onOpen,
}: {
  state: GameState
  onOpen: () => void
}): JSX.Element | null {
  const plays = state.roundPlays
  if (plays.length === 0) return null
  const zeroed = state.lead?.zeroed === true ? state.lead.cardId : undefined
  return (
    <button
      className="phone-plays"
      onClick={onOpen}
      aria-label="This round's plays — open the court"
    >
      {plays.map((p) => (
        <span
          key={`${p.faction}-${p.cardId}`}
          className={`pp-card${p.cardId === zeroed ? ' zeroed' : ''}`}
          style={{ borderColor: colorOf(p.faction) }}
        >
          {p.kind === 'copy' ? (
            <img
              className="cardface"
              src={smallArt('game-assets/action/card-back.webp')}
              alt="face down"
            />
          ) : (
            <CardFace cardId={p.cardId} />
          )}
          <span className="pp-tag" style={{ background: colorOf(p.faction) }}>
            {p.kind}
          </span>
        </span>
      ))}
    </button>
  )
}
