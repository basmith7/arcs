/**
 * The small pieces of the optional Discord login (docs/superpowers/specs/2026-10-04-optional-login-design.md):
 * the sign-in link, the Settings account section, the "Sit here" bar, the locked-seat banner and the
 * failed-sign-in notice. Each renders nothing when the server has login off, so a deploy without
 * Discord credentials looks exactly as it did before.
 */

import { useEffect } from 'react'

import { setSigninFailed, signInHref, signOut, useAccount } from '../account.js'
import { MULTIPLAYER_URL } from '../multiplayer/config.js'

/** Where sign-in returns to: wherever the player is now, so a game link survives the round trip. */
function signInLink(): string {
  return signInHref(MULTIPLAYER_URL!, location.hash)
}

export function SignInButton(): JSX.Element | null {
  const { enabled, account } = useAccount()
  if (!enabled) return null
  return account === null ? (
    <a className="ghost" href={signInLink()}>
      Sign in with Discord
    </a>
  ) : (
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
        <p className="set-row">
          <a className="da-ghost" href={signInLink()}>
            Sign in with Discord
          </a>
        </p>
      ) : (
        <>
          <p className="set-row">
            Signed in as {account.displayName} (@{account.discordName})
          </p>
          <p className="set-row">
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

export function SitHereBar({ onSit, onDismiss }: { onSit: () => void; onDismiss: () => void }): JSX.Element | null {
  const { account } = useAccount()
  if (account === null) return null
  return (
    <div className="sit-bar" role="status">
      <span>
        Sit here as @{account.displayName} to lock this seat to you and get turn pings on Discord.
      </span>
      <button className="primary" onClick={onSit}>
        Sit here
      </button>
      <button className="ghost" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

export function LockedBanner({ owner }: { owner: string }): JSX.Element {
  const { enabled, account } = useAccount()
  return (
    <div className="locked-banner" role="status">
      <span>This seat is @{owner}'s. Sign in to play.</span>
      {enabled && account === null ? (
        <a className="ghost" href={signInLink()}>
          Sign in with Discord
        </a>
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
