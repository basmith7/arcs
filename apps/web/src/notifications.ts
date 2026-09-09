/**
 * The browser side of a turn push: a `Notification`, a title flash, or both, kept out of
 * `store.ts` so it can be unit-tested with fakes rather than a real DOM (the web tests run in
 * plain node — see `session.ts`'s activity listeners for the same constraint).
 *
 * Every function here takes the global it needs as a parameter instead of reading
 * `document`/`window`/`Notification` directly, so a test can hand in a fake and a caller in
 * `store.ts` can guard the real globals once at the call site.
 */

export interface NotificationLike {
  onclick: (() => void) | null
  close(): void
}

export interface NotificationCtor {
  readonly permission: string
  new (title: string, options?: { readonly body?: string; readonly tag?: string }): NotificationLike
}

export interface DocumentLike {
  hidden: boolean
  title: string
  hasFocus?(): boolean
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface WindowLike {
  focus(): void
}

/** Whether the page is in a state where a person would not otherwise notice their turn. */
export function isHiddenOrUnfocused(doc: DocumentLike): boolean {
  if (doc.hidden) return true
  return typeof doc.hasFocus === 'function' && !doc.hasFocus()
}

/** Whether we are allowed to pop a real OS notification: preference on, permission granted. */
export function canPopNotification(preferenceOn: boolean, notificationCtor: NotificationCtor | undefined): boolean {
  return preferenceOn && notificationCtor !== undefined && notificationCtor.permission === 'granted'
}

/** Pops "Arcs — your turn"; clicking it focuses the window and closes the notification. */
export function popTurnNotification(
  notificationCtor: NotificationCtor,
  win: WindowLike,
  gameId: string,
  chapter: number,
): NotificationLike {
  const n = new notificationCtor('Arcs — your turn', { body: `Chapter ${chapter}`, tag: `arcs-${gameId}` })
  n.onclick = () => {
    win.focus()
    n.close()
  }
  return n
}

const TURN_TITLE = '● Your turn — Arcs'

/**
 * Sets the tab title to flag a turn, and restores it the next time the page becomes visible or
 * focused — whichever happens first, and only once.
 */
export function flashTitleUntilSeen(doc: DocumentLike): void {
  const previous = doc.title
  doc.title = TURN_TITLE
  const restore = (): void => {
    doc.title = previous
    doc.removeEventListener('visibilitychange', restore)
    doc.removeEventListener('focus', restore)
  }
  doc.addEventListener('visibilitychange', restore)
  doc.addEventListener('focus', restore)
}
