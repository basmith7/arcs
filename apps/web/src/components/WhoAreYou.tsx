import { useEffect, useRef, useState } from 'react'

import type { PublicSeat } from '../multiplayer/client.js'
import { colorOf } from '../theme.js'
import type { FactionId } from '@arcs/engine'

interface Props {
  /** Human seats only — a bot's seat is not anyone's to sit in. */
  seats: readonly PublicSeat[]
  onPick: (faction: string) => Promise<void>
  /** "Just watching", or Escape: stay a spectator for the rest of the session. */
  onWatch: () => void
}

/**
 * Asked when a game link is opened with no seat token and none stashed in this browser — the bare
 * link the Discord pings post, opened on a new phone. Without it the visitor lands as a spectator
 * and cannot tell why their hand is missing.
 */
export function WhoAreYou({ seats, onPick, onWatch }: Props): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Synchronous, unlike `busy`: a second click or an Escape before React re-renders must not
  // start a second claim, or dismiss a prompt whose claim is still going to seat them.
  const inFlight = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !inFlight.current) onWatch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onWatch])

  async function pick(faction: string): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(faction)
    setError(null)
    try {
      await onPick(faction)
    } catch {
      // The watching session is untouched on failure (`store.claimSeat`), so the prompt is still up.
      // A seat locked to an account is refused to everyone else (`/claim` answers seat-locked).
      setError(
        seats.find((s) => s.faction === faction)?.owner !== undefined
          ? 'That seat is locked to a signed-in player. Sign in as them, or pick another.'
          : "Couldn't take that seat. Try again, or open your own seat link.",
      )
      setBusy(null)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <div className="name-backdrop" role="dialog" aria-modal="true" aria-labelledby="who-title">
      <div className="name-card who-card">
        <h2 id="who-title">Who are you?</h2>
        <p>This link doesn't say which seat is yours.</p>
        <div className="who-seats">
          {seats.map((s) => {
            const tint = colorOf(s.faction as FactionId)
            return (
              <button
                key={s.faction}
                type="button"
                className="who-seat"
                style={{ borderColor: tint }}
                disabled={busy !== null}
                onClick={() => void pick(s.faction)}
              >
                <span className={s.name === undefined ? 'who-name who-open' : 'who-name'}>{s.name ?? 'Open seat'}</span>
                <span className="who-faction" style={{ color: tint }}>
                  {busy === s.faction ? 'Sitting down…' : s.owner === undefined ? s.faction : `${s.faction} · signed in`}
                </span>
              </button>
            )
          })}
        </div>
        {error === null ? null : <p className="name-error">{error}</p>}
        <button type="button" className="who-watch" disabled={busy !== null} onClick={onWatch}>
          Just watching
        </button>
      </div>
    </div>
  )
}
