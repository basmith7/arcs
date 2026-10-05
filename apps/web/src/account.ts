/**
 * The signed-in account, if any: whether login is even enabled on this server, and who the player
 * is when it is.
 *
 * Module-level state plus a listener set, exposed through `useSyncExternalStore` — the same shape
 * as the hooks at the bottom of `store.ts`. A plain module rather than a class because there is only
 * ever one account for one tab, and nothing here needs an instance to construct.
 */

import { useSyncExternalStore } from 'react'

export interface AccountState {
  /** False until the first `loadAccount` call has settled, success or failure. */
  readonly loaded: boolean
  /** Whether this server has Discord login configured at all. */
  readonly enabled: boolean
  readonly account: { readonly displayName: string; readonly discordName: string } | null
  /** Set when a sign-in attempt came back and failed, so the UI can say so once. */
  readonly signinFailed: boolean
}

let state: AccountState = { loaded: false, enabled: false, account: null, signinFailed: false }
const listeners = new Set<() => void>()

function emit(): void {
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): AccountState {
  return state
}

/**
 * Ask the server who's signed in.
 *
 * Any failure — network, a non-JSON body, a server with no auth route — reads the same as "login
 * is off": there is nothing actionable to tell the player apart from that, and the page must still
 * work for a signed-out, auth-disabled visitor.
 */
export async function loadAccount(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/me`)
    if (!res.ok) throw new Error(`GET /me -> ${res.status}`)
    const body = (await res.json()) as {
      account: { displayName: string; discordName: string } | null
      enabled: boolean
    }
    state = { loaded: true, enabled: body.enabled, account: body.account, signinFailed: state.signinFailed }
  } catch {
    state = { loaded: true, enabled: false, account: null, signinFailed: state.signinFailed }
  }
  emit()
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function getAccount(): AccountState {
  return state
}

/** Record that a sign-in attempt failed, so the UI can say so once. */
export function setSigninFailed(v: boolean): void {
  state = { ...state, signinFailed: v }
  emit()
}

/**
 * Where "sign in" navigates to. `hash` is where to land back on afterward — the game link, if
 * there was one — and it travels as a query parameter rather than the hash itself, since Discord's
 * redirect would otherwise swallow it.
 */
export function signInHref(baseUrl: string, hash: string): string {
  return `${baseUrl}/auth/discord?return=${encodeURIComponent(hash)}`
}

/**
 * Sign out, then reload. The reload is the simplest way to unwind everything that depended on being
 * signed in — claimed seats, `/me/games` — without hand-tracking it all here.
 */
export async function signOut(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/auth/logout`, { method: 'POST' })
  } finally {
    if (typeof location !== 'undefined') location.reload()
  }
}
