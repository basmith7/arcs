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
 */

import { useEffect, useRef } from 'react'

import { lastTurn, parseLog } from '../log-format.js'
import type { LogItem } from '../log-format.js'
import { colorOf } from '../theme.js'

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

export function LogPanel({ log, only }: Props): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [log.length])

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
        <Row key={i} item={item} />
      ))}
    </div>
  )
}

function Row({ item }: { item: LogItem }): JSX.Element {
  if (item.kind === 'divider') {
    return <div className="log-divider">{item.text}</div>
  }

  if (item.kind === 'head') {
    return (
      <div className="log-head" style={{ borderColor: colorOf(item.faction) }}>
        <span className="log-who" style={{ color: colorOf(item.faction) }}>
          {item.faction}
        </span>
        {item.text === '' ? null : <span className="log-lead">{item.text}</span>}
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
    >
      <span className="log-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>{item.text}</span>
    </div>
  )
}
