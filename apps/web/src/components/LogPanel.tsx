/**
 * The log, drawn as turns rather than as a stream of sentences.
 *
 * `log-format.ts` does the reading; this only decides what a row looks like. The split matters
 * because the two are tested very differently — the parser against real engine lines, this against
 * markup — and because the same rows are drawn in two places: the drawer, and the turn feed that
 * replaces the decision surfaces while someone else plays (`only="last-turn"`). One renderer, so a
 * new kind of log line cannot arrive styled in the drawer and unstyled in the feed.
 *
 * The faction is drawn as a colored bar and dropped from the text, which is the change that makes
 * a chapter of play skimmable: the actor moves from the start of every sentence — where it was
 * read as a word, repeatedly — to the left margin, where it is read as a column.
 *
 * ## The names are targets
 *
 * A log row names things the app can already show you, and until now it named them as text you had
 * to go and find. `tokenize` marks them, and this draws them as two kinds of target:
 *
 *   - **a card** opens its art beside the pointer, and opens the full reader on a click — the same
 *     two readers the rest of the app uses (`CardZoom` for court, `LeaderCardReader` for the rest),
 *     so a card read from the log is the same card read from the board.
 *   - **a system** lights on the map, through `log-hover.ts`. Pointing is per *row*, not per name:
 *     sweeping the log and watching the board follow is the thing worth having, and a row is the
 *     unit a reader's eye actually moves in. The two ends of a move light together as a result,
 *     which is what makes a move legible at a glance.
 *
 * Hover only, and nothing is pinned. There is no state here to get stuck in and nothing to clean
 * up when the drawer closes — a row that unmounts under the pointer takes its highlight with it.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { asset, smallArt } from '../assets.js'
import { clearHover, hoverSystems } from '../log-hover.js'
import { lastTurn, parseLog, systemsIn } from '../log-format.js'
import type { CardRef, LogItem, LogPart } from '../log-format.js'
import { colorOf } from '../theme.js'
import { CardZoom } from './CardZoom.js'
import { LeaderCardReader } from './LeaderCardReader.js'
import { SystemName } from './SystemName.js'

interface Props {
  log: readonly string[]
  /** `last-turn` draws only the turn in progress — the watch-mode feed. */
  only?: 'last-turn'
}

/**
 * How much history the drawer draws.
 *
 * The whole log is kept in state and a long game runs past 600 lines; parsing and rendering all of
 * them on every append is work nobody scrolls back far enough to see. The slice is taken *before*
 * parsing, which is safe because a turn head comes from a change of actor within the slice — the
 * worst a cut can do is open a head mid-turn, one row early.
 */
const RECENT = 200

/** Where a card's art lives. Action cards are filed by suit and strength, everything else by id. */
function artOf(card: CardRef): string {
  if (card.kind !== 'action') return smallArt(`game-assets/${card.kind}/${card.id}.webp`)
  const dash = card.id.lastIndexOf('-')
  return smallArt(
    `game-assets/action/${card.id.slice(0, dash).toLowerCase()}-${card.id.slice(dash + 1)}.webp`,
  )
}

/** What the pointer is over, and the box it is over — enough to put the art beside it. */
interface Preview {
  readonly card: CardRef
  readonly at: DOMRect
}

export function LogPanel({ log, only }: Props): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  /*
   * The opened card, separate from the hovered one: the reader outlives the pointer that opened it,
   * and a modal that closed because you moved the mouse off the name you clicked would be unusable.
   */
  const [open, setOpen] = useState<CardRef | null>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [log.length])
  /*
   * Whatever this panel was pointing at stops being pointed at when it goes away. The feed unmounts
   * between turns and the drawer unmounts when it is closed, both of which can happen with the
   * pointer resting on a row — and a reticle left burning on the map with nothing explaining it is
   * worse than no reticle at all.
   */
  useEffect(() => clearHover, [])

  const parsed = parseLog(log.slice(-RECENT))
  const items = only === 'last-turn' ? lastTurn(parsed) : parsed

  /*
   * Nothing between turns, and `null` rather than an empty box: the feed is positioned over the
   * map, so an empty frame would be a panel of nothing sitting on the board in the pause between
   * a round ending and the next player leading.
   */
  if (items.length === 0) return null

  return (
    <div className={only === 'last-turn' ? 'log log-feed' : 'log'} ref={ref}>
      {items.map((item, i) => (
        <Row key={i} item={item} onPreview={setPreview} onOpen={setOpen} />
      ))}
      {preview === null ? null : <CardPreview card={preview.card} at={preview.at} />}
      {open === null ? null : <Reader card={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

interface RowProps {
  item: LogItem
  onPreview: (p: Preview | null) => void
  onOpen: (c: CardRef) => void
}

function Row({ item, onPreview, onOpen }: RowProps): JSX.Element {
  if (item.kind === 'divider') {
    return <div className="log-divider">{item.text}</div>
  }

  const systems = systemsIn(item.parts)
  /*
   * Applied to the row rather than to each name, so the whole line is one target. A row that names
   * no system still clears on entry: sweeping down the log must not leave the previous row's
   * reticles burning while the pointer is somewhere that means nothing.
   */
  const point = {
    onMouseEnter: () => hoverSystems(systems),
    onMouseLeave: () => clearHover(),
  }
  const body = (
    <Parts parts={item.parts} onPreview={onPreview} onOpen={onOpen} />
  )

  if (item.kind === 'head') {
    return (
      <div className="log-head" style={{ borderColor: colorOf(item.faction) }} {...point}>
        <span className="log-who" style={{ color: colorOf(item.faction) }}>
          {item.faction}
        </span>
        {item.text === '' ? null : <span className="log-lead">{body}</span>}
      </div>
    )
  }

  /*
   * An authorless entry ("initiative passes to red", "Call to Action discarded") keeps the row and
   * loses the bar. It is a real event with no one faction to blame, so hiding it would be wrong and
   * coloring it would be a guess.
   */
  return (
    <div
      className={`log-line ${item.tone}`}
      style={item.faction === null ? undefined : { borderColor: colorOf(item.faction) }}
      {...point}
    >
      <span className="log-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>{body}</span>
    </div>
  )
}

/** One line's runs — prose as prose, names as targets. */
function Parts({
  parts,
  onPreview,
  onOpen,
}: {
  parts: readonly LogPart[]
  onPreview: (p: Preview | null) => void
  onOpen: (c: CardRef) => void
}): JSX.Element {
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'text') return <span key={i}>{part.text}</span>
        if (part.kind === 'system') {
          /*
           * Not a button. The row already carries the pointing, so this is a mark on the text
           * saying *this word is a place* — giving it its own tab stop would put every system in
           * every line of a three-hour game into the tab order for no action.
           *
           * Drawn as the board draws it — a numeral and the cluster's symbol — so the name in the
           * sentence and the tag on the map are the same two marks. See `SystemName`.
           */
          return <SystemName key={i} id={part.system} className="log-sys" />
        }
        return (
          <button
            key={i}
            type="button"
            className="log-card"
            title={`${part.text} — click to read`}
            onMouseEnter={(e) => onPreview({ card: part.card, at: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => onPreview(null)}
            onFocus={(e) => onPreview({ card: part.card, at: e.currentTarget.getBoundingClientRect() })}
            onBlur={() => onPreview(null)}
            onClick={() => onOpen(part.card)}
          >
            {part.text}
          </button>
        )
      })}
    </>
  )
}

/** How wide the floated art is, in px. Kept in step with `.log-preview img` in styles.css. */
const PREVIEW_W = 240
const PREVIEW_H = 336
const GAP = 10

/**
 * The card, floated beside the name.
 *
 * Portalled to `body` and positioned in viewport coordinates, for the reason `CardZoom` documents:
 * the drawer scrolls and the feed sits inside the board cell, so anything positioned within either
 * would be clipped by it. Fixed positioning also means the art does not move when the log scrolls
 * under it — and the pointer is on the name, so it cannot scroll without leaving.
 *
 * Flipped to whichever side has room, because the unpinned drawer hugs the right edge of the
 * window: opening rightwards there would put the card mostly off screen, which is where the first
 * version of this put it.
 */
function CardPreview({ card, at }: { card: CardRef; at: DOMRect }): JSX.Element {
  const room = window.innerWidth - at.right
  const left = room > PREVIEW_W + GAP ? at.right + GAP : Math.max(GAP, at.left - PREVIEW_W - GAP)
  // Centred on the name, then pulled back inside the window at the top and the bottom.
  const top = Math.min(
    Math.max(GAP, at.top + at.height / 2 - PREVIEW_H / 2),
    Math.max(GAP, window.innerHeight - PREVIEW_H - GAP),
  )
  return createPortal(
    <div className="log-preview" style={{ left, top }} role="presentation">
      <img src={artOf(card)} alt="" draggable={false} />
    </div>,
    document.body,
  )
}

/**
 * The card at reading size, on a click.
 *
 * The app already has two of these and this adds neither: court cards open `CardZoom`, leaders and
 * lore open `LeaderCardReader`. Action cards have no reader because they have nothing to read — the
 * art is a suit, a number and a row of pips, all of it legible in the preview above — so clicking
 * one shows the same art at full size rather than inventing a third modal for it.
 */
function Reader({ card, onClose }: { card: CardRef; onClose: () => void }): JSX.Element {
  if (card.kind === 'court') return <CardZoom cardId={card.id} onClose={onClose} />
  if (card.kind === 'lore' || card.kind === 'leader') {
    return <LeaderCardReader id={card.id} kind={card.kind} onClose={onClose} />
  }
  const dash = card.id.lastIndexOf('-')
  const src = asset(
    `game-assets/action/${card.id.slice(0, dash).toLowerCase()}-${card.id.slice(dash + 1)}.webp`,
  )
  return createPortal(
    <div className="court-modal" onClick={onClose} role="presentation">
      <img className="log-action-art" src={src} alt={card.id} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  )
}
