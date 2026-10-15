/**
 * System Back closes the topmost open dialog instead of leaving the game.
 *
 * A dialog calls `useBackClose(onClose)` while it is mounted. That pushes one history entry (a
 * state marker, same URL — a hash change would reload the page, see main.tsx). Back then fires
 * `popstate`, which closes the topmost dialog. When a dialog closes some other way (its X, Escape,
 * the backdrop) the entry it pushed is popped with `history.back()`, and the `popstate` that causes
 * is swallowed so it closes nothing. With no dialog open nothing here runs, so Back is untouched.
 */

import { useEffect, useRef } from 'react'

interface Entry {
  close: () => void
}

/** Open dialogs, oldest first. */
const stack: Entry[] = []
/** `history.back()` calls we made ourselves whose `popstate` has not arrived yet. */
let ownPops = 0
let listening = false

function onPopState(): void {
  if (ownPops > 0) {
    ownPops--
    return
  }
  stack.pop()?.close()
}

/** Register a dialog; returns its unregister, which also pops the history entry if still held. */
export function pushBackClose(close: () => void): () => void {
  if (!listening) {
    window.addEventListener('popstate', onPopState)
    listening = true
  }
  const entry: Entry = { close }
  stack.push(entry)
  history.pushState({ arcsDialog: true }, '')
  return () => {
    const i = stack.indexOf(entry)
    if (i === -1) return // Back already took it.
    stack.splice(i, 1)
    ownPops++
    history.back()
  }
}

/** Call from a dialog component: Back closes it (via `onClose`) for as long as it is mounted. */
export function useBackClose(onClose: () => void): void {
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => pushBackClose(() => latest.current()), [])
}
