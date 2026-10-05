/**
 * The turn catch-up card (spec 2026-10-04-scoreboard-catchup-design.md): what to be aware of since
 * your last turn, and a short story with you as the hero once the server has written one.
 *
 * The heads-ups are the page's own (`seatFacts`), so they show at once; the story arrives later and
 * goes *below* them, into space held for it while it is being written, so nothing moves under a
 * thumb. On a phone the story folds behind "More". Never advice: the bullets state facts, and the
 * server's checker turns away any story that tells the player what to do.
 */

import type { FactionId, HeadsUp } from '@arcs/engine'
import { turnStart, withNames } from '@arcs/engine'
import { useEffect, useState } from 'react'

import { dismissCatchup } from '../catchup.js'
import { store } from '../store.js'

interface Props {
  headsUps: readonly HeadsUp[]
  /** Null until the server's story arrives (or for good, when stories are off). */
  story: string | null
  /** Hold the story's space: one is being written. */
  pending: boolean
  factions: readonly FactionId[]
  name: (f: FactionId) => string
  collapsed: boolean
  onDismiss: () => void
}

export function CatchUp({ headsUps, story, pending, factions, name, collapsed, onDismiss }: Props): JSX.Element {
  return (
    <aside className={collapsed ? 'cu-card collapsed' : 'cu-card'} aria-label="Catch-up">
      <div className="cu-head">
        <span className="cu-title">Since your last turn</span>
        <button className="da-ghost" onClick={onDismiss} aria-label="Dismiss catch-up">
          ✕
        </button>
      </div>
      {headsUps.length === 0 ? (
        <p className="cu-quiet">Nothing to flag.</p>
      ) : (
        <ul className="cu-list">
          {headsUps.map((h) => (
            <li key={h.text}>{withNames(h.text, factions, name)}</li>
          ))}
        </ul>
      )}
      {story !== null ? (
        collapsed ? (
          <details className="cu-story">
            <summary>More</summary>
            <p>{story}</p>
          </details>
        ) : (
          <p className="cu-story">{story}</p>
        )
      ) : pending ? (
        <div className="cu-story-slot" aria-hidden="true" />
      ) : null}
    </aside>
  )
}

/** How long the story's space is held after the card appears; a writer that fails lets it go. */
const STORY_WAIT_MS = 120_000

/**
 * The card for this seat's current turn, wired to the store: the page's own heads-ups, the
 * server's story once pushed, and the dismissal remembered for this turn.
 */
export function CatchUpSlot({
  faction,
  gameId,
  journal,
  phone,
  onDismiss,
}: {
  faction: FactionId
  gameId: string
  journal: readonly string[]
  phone: boolean
  onDismiss: (turn: number) => void
}): JSX.Element | null {
  const turn = turnStart(journal, faction)
  const [waited, setWaited] = useState<number | null>(null)
  useEffect(() => {
    setWaited(null)
    const t = setTimeout(() => setWaited(turn), STORY_WAIT_MS)
    return () => clearTimeout(t)
  }, [turn])
  const facts = store.seatFacts(faction)
  if (facts === null) return null
  const story = store.catchupStory(turn)
  const factions = facts.factions.map((f) => f.faction)
  return (
    <CatchUp
      headsUps={facts.headsUps}
      story={story}
      pending={story === null && store.catchupEnabled() && waited !== turn}
      factions={factions}
      name={(f) => store.seatName(f) ?? f}
      collapsed={phone}
      onDismiss={() => {
        dismissCatchup(gameId, turn)
        onDismiss(turn)
      }}
    />
  )
}
