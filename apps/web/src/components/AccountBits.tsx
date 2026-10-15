/**
 * The small pieces of the optional Discord login (docs/superpowers/specs/2026-10-04-optional-login-design.md):
 * the sign-in link, the Settings account section, the sign-in nudge, the "Sit here" bar, the
 * locked-seat banner and the failed-sign-in notice. Each renders nothing when the server has login off, so a deploy without
 * Discord credentials looks exactly as it did before.
 */

import { useEffect, useState } from 'react'

import { markSitOnReturn, setSigninFailed, signInHref, signOut, useAccount } from '../account.js'
import { MULTIPLAYER_URL } from '../multiplayer/config.js'
import { parseLink } from '../multiplayer/link.js'
import { store } from '../store.js'

/** Where sign-in returns to: wherever the player is now, so a game link survives the round trip. */
function signInLink(): string {
  return signInHref(MULTIPLAYER_URL!, location.hash)
}

/** Every sign-in link: one started from an unlocked seat sits there on the way back (`markSitOnReturn`). */
function SignInLink({ className, children }: { className: string; children: string }): JSX.Element {
  function onClick(): void {
    const gameId = parseLink(location.hash)?.gameId
    if (gameId !== undefined && store.seatView().kind === 'seat' && store.mySeatOwner() === undefined)
      markSitOnReturn(gameId)
  }
  return (
    <a className={className} href={signInLink()} onClick={onClick}>
      {children}
    </a>
  )
}

export function SignInButton({ hideMyGames = false }: { hideMyGames?: boolean } = {}): JSX.Element | null {
  const { enabled, account } = useAccount()
  if (!enabled) return null
  if (account === null)
    return (
      <SignInLink className="ghost">Sign in with Discord</SignInLink>
    )
  if (hideMyGames) return null
  return (
    <a className="ghost" href="#/me">
      My games
    </a>
  )
}

export function AccountSection(): JSX.Element | null {
  const { enabled, account } = useAccount()
  if (!enabled) return null
  return (
    <section className="set-section">
      <h3 className="set-heading">Account</h3>
      {account === null ? (
        <p className="set-row set-row-actions">
          <SignInLink className="da-ghost">Sign in with Discord</SignInLink>
        </p>
      ) : (
        <>
          <p className="set-row">
            <span className="set-label">Signed in</span>
            <span className="set-value">
              {account.displayName} (@{account.discordName})
            </span>
          </p>
          <p className="set-row set-row-actions">
            <a className="da-ghost" href="#/me">
              My games
            </a>
            <button className="da-ghost" onClick={() => void signOut(MULTIPLAYER_URL!)}>
              Sign out
            </button>
          </p>
        </>
      )}
    </section>
  )
}

/** Where a dismissed sign-in nudge is remembered: once per browser, not once per page load. */
const SIGNIN_NUDGE_KEY = 'arcs.signin.nudgeDismissed'

function nudgeDismissed(): boolean {
  try {
    return localStorage.getItem(SIGNIN_NUDGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Tells a signed-out player in a seat that Discord sign-in exists and what it buys them. Shown
 * until they sign in or dismiss it; the dismissal sticks in this browser, so it asks once.
 */
export function SignInNudge(): JSX.Element | null {
  const { enabled, account } = useAccount()
  const [dismissed, setDismissed] = useState(nudgeDismissed)
  if (!enabled || account !== null || dismissed) return null
  function dismiss(): void {
    try {
      localStorage.setItem(SIGNIN_NUDGE_KEY, '1')
    } catch {
      // Private mode or storage off: it still goes for this page's life.
    }
    setDismissed(true)
  }
  return (
    <div className="sit-bar" role="status">
      <span>Sign in with Discord to lock this seat to you and get your turn pings on Discord.</span>
      <SignInLink className="primary">Sign in</SignInLink>
      <button className="ghost" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

export function SitHereBar({ onSit, onDismiss }: { onSit: () => Promise<void>; onDismiss: () => void }): JSX.Element | null {
  const { account } = useAccount()
  const [error, setError] = useState(false)
  if (account === null) return null
  return (
    <div className="sit-bar" role="status">
      <span>
        Sit here as @{account.displayName} to lock this seat to you and get turn pings on Discord.
      </span>
      {error ? <span role="alert">Couldn't sit here. Try again.</span> : null}
      <button
        className="primary"
        onClick={() => {
          setError(false)
          onSit().catch(() => setError(true))
        }}
      >
        Sit here
      </button>
      <button className="ghost" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

export function LockedBanner({ owner, canUnlock = false }: { owner: string; canUnlock?: boolean }): JSX.Element {
  const { enabled, account } = useAccount()
  const [error, setError] = useState(false)
  return (
    <div className="locked-banner" role="status">
      <span>This seat is @{owner}'s. Sign in to play.</span>
      {enabled && account === null ? (
        <SignInLink className="ghost">Sign in with Discord</SignInLink>
      ) : null}
      {canUnlock ? (
        <>
          {error ? <span role="alert">Couldn't unlock. Try again.</span> : null}
          <button
            className="ghost"
            onClick={() => {
              if (!window.confirm(`Unlock @${owner}'s seat? Anyone with its link can then play it.`)) return
              setError(false)
              store.releaseSeat().catch(() => setError(true))
            }}
          >
            Unlock seat
          </button>
        </>
      ) : null}
    </div>
  )
}

/** How long the failed-sign-in notice stays before it goes on its own. */
const NOTICE_MS = 8000

export function SigninNotice(): JSX.Element | null {
  const { signinFailed } = useAccount()
  useEffect(() => {
    if (!signinFailed) return
    const t = setTimeout(() => setSigninFailed(false), NOTICE_MS)
    return () => clearTimeout(t)
  }, [signinFailed])
  if (!signinFailed) return null
  return (
    <div className="signin-notice" role="alert">
      <span>Sign-in didn't complete</span>
      <button className="ghost" onClick={() => setSigninFailed(false)} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
