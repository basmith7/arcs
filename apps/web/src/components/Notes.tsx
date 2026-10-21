/**
 * The seat's own notes: a plan written at the end of a turn, for when the next one is days away.
 *
 * Held by the server per seat (`/games/:id/note`) rather than in this browser, because the
 * returning player is often on another device — the Discord ping opens on a phone, the plan was
 * written at a desk. Private to the seat's token; nobody else at the table can read it.
 *
 * Saves itself: a pause in typing, leaving the box, or the panel going away all write. There is no
 * Save button to forget, and the status line says whether the last write landed.
 */

import { useEffect, useRef, useState } from 'react'

import { ago } from '../ago.js'
import { store } from '../store.js'

/** Kept in step with `NOTE_MAX` in packages/server-node/src/api.ts. */
const MAX = 4000
const PAUSE_MS = 800

type Status = 'loading' | 'idle' | 'dirty' | 'saving' | 'failed'

export function Notes({ seatKey }: { seatKey: string }): JSX.Element {
  const [text, setText] = useState('')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  // What the server last confirmed, so a blur with nothing changed writes nothing.
  const saved = useRef('')
  const latest = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    setStatus('loading')
    store
      .loadNote()
      .then((n) => {
        if (!live) return
        saved.current = latest.current = n?.text ?? ''
        setText(saved.current)
        setUpdatedAt(n?.updatedAt ?? null)
        setStatus('idle')
      })
      .catch(() => live && setStatus('failed'))
    return () => {
      live = false
      // Leaving mid-pause still writes: the panel unmounts when the game or seat changes.
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
        if (latest.current !== saved.current) void store.saveNote(latest.current).catch(() => {})
      }
    }
  }, [seatKey])

  function flush(): void {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const value = latest.current
    if (value === saved.current) {
      setStatus('idle')
      return
    }
    setStatus('saving')
    store
      .saveNote(value)
      .then((n) => {
        saved.current = value
        setUpdatedAt(n?.updatedAt ?? null)
        // Typing that landed while the write was out is still waiting for its own.
        setStatus(latest.current === value ? 'idle' : 'dirty')
      })
      .catch(() => setStatus('failed'))
  }

  function edit(value: string): void {
    latest.current = value
    setText(value)
    setStatus('dirty')
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(flush, PAUSE_MS)
  }

  const line =
    status === 'loading'
      ? 'Loading…'
      : status === 'saving' || status === 'dirty'
        ? 'Saving…'
        : status === 'failed'
          ? 'Not saved'
          : updatedAt === null
            ? 'Only you can see these'
            : `Saved ${ago(updatedAt)}`

  return (
    <section className="notes" aria-label="Your notes">
      <div className="notes-head">
        <span>Notes</span>
        {status === 'failed' ? (
          <button className="ghost notes-retry" onClick={flush}>
            Not saved · retry
          </button>
        ) : (
          <span className="notes-status">{line}</span>
        )}
      </div>
      <textarea
        className="notes-text"
        value={text}
        maxLength={MAX}
        disabled={status === 'loading'}
        placeholder="Your plan for next turn: what you're holding, what you're going for."
        onChange={(e) => edit(e.target.value)}
        onBlur={flush}
        // Typing here must not reach the game's own shortcuts (Escape, arrows on the map).
        onKeyDown={(e) => e.stopPropagation()}
      />
    </section>
  )
}
