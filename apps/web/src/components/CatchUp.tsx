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
import { withNames } from '@arcs/engine'
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
  /** Shrunk to its title row so it stops covering the map; tapping the title calls `onToggle`. */
  compact?: boolean
  onToggle?: (() => void) | undefined
  onDismiss: () => void
}

export function CatchUp({ headsUps, story, pending, factions, name, collapsed, compact = false, onToggle, onDismiss }: Props): JSX.Element {
  const cls = ['cu-card', collapsed ? 'collapsed' : '', compact ? 'compact' : ''].filter(Boolean).join(' ')
  return (
    <aside className={cls} aria-label="Catch-up">
      <div className="cu-head">
        {onToggle === undefined ? (
          <span className="cu-title">Since your last turn</span>
        ) : (
          <button className="cu-title cu-title-btn" onClick={onToggle} aria-expanded={!compact}>
            Since your last turn {compact ? '▸' : '▾'}
          </button>
        )}
        <button className="da-ghost" onClick={onDismiss} aria-label="Dismiss catch-up">
          ✕
        </button>
      </div>
      {compact ? null : headsUps.length === 0 ? (
        <p className="cu-quiet">Nothing to flag.</p>
      ) : (
        <ul className="cu-list">
          {headsUps.map((h) => (
            <li key={h.text}>{withNames(h.text, factions, name)}</li>
          ))}
        </ul>
      )}
      {compact ? null : story !== null ? (
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
  turn,
  played,
  phone,
  onDismiss,
}: {
  faction: FactionId
  gameId: string
  /** Where this turn began in the journal (engine `seatTurn`): the story's and dismissal's key. */
  turn: number
  /** The seat has played its opening card: the card shrinks to its title row. */
  played: boolean
  phone: boolean
  onDismiss: (turn: number) => void
}): JSX.Element | null {
  /*
   * Once the slot is released the card is final: `released` keeps what it held (a story or none),
   * so a story that lands after that is not inserted and cannot push the card's height. It shows
   * on the next open of the card (a reload, or dismiss and Catch-up), when it can be laid out fresh.
   */
  const [released, setReleased] = useState<{ turn: number; story: string | null } | null>(null)
  /** Tapped open after the opening play; per turn. */
  const [expanded, setExpanded] = useState<number | null>(null)
  useEffect(() => {
    setReleased(null)
    const t = setTimeout(() => setReleased({ turn, story: store.catchupStory(turn) }), STORY_WAIT_MS)
    return () => clearTimeout(t)
  }, [turn])
  const facts = store.seatFacts(faction)
  if (facts === null) return null
  const settled = released?.turn === turn ? released : null
  const story = settled !== null ? settled.story : store.catchupStory(turn)
  const compact = played && expanded !== turn
  const factions = facts.factions.map((f) => f.faction)
  return (
    <CatchUp
      headsUps={facts.headsUps}
      story={story}
      pending={story === null && store.catchupEnabled() && settled === null}
      factions={factions}
      name={(f) => store.seatName(f) ?? f}
      collapsed={phone}
      compact={compact}
      onToggle={played ? () => setExpanded(compact ? turn : null) : undefined}
      onDismiss={() => {
        dismissCatchup(gameId, faction, turn)
        onDismiss(turn)
      }}
    />
  )
}
