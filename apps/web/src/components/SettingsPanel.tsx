import { useEffect, useState } from 'react'

import { isValidDiscordId, isValidName } from '../seat-form.js'
import { store } from '../store.js'
import type { GameLink } from '../multiplayer/link.js'

interface Props {
  faction: string
  link: GameLink | null
  onClose: () => void
}

/**
 * The player's settings, opened from the topbar. A general modal with sections rather than a
 * one-off name form — Brian wants more settings here later, and this is the shelf for them.
 * `NamePrompt` stays as the first-visit ask; this is where a seated player comes back to change
 * anything, including their name.
 */
export function SettingsPanel({ faction, link, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="name-backdrop settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-panel">
        <div className="settings-head">
          <h2 id="settings-title">Settings</h2>
          <button className="ghost" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>
        <PlayerSection faction={faction} />
        <NotificationsSection />
        <GameSection faction={faction} link={link} />
      </div>
    </div>
  )
}

function PlayerSection({ faction }: { faction: string }): JSX.Element {
  const discordLinked = store.mySeatDiscordLinked()
  const discordName = store.mySeatDiscordName()
  const [name, setName] = useState(store.mySeatName() ?? '')
  const [discordId, setDiscordId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const validName = isValidName(name)
  const validDiscordId = isValidDiscordId(discordId)

  async function saveName(): Promise<void> {
    if (!validName || busy) return
    setBusy(true)
    setError(null)
    try {
      await store.claimName(name.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function link_(): Promise<void> {
    if (!validDiscordId || discordId.trim().length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await store.claimName(store.mySeatName() ?? faction, discordId.trim())
      setDiscordId('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unlink(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await store.claimName(store.mySeatName() ?? faction, '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3>Player</h3>
      <label htmlFor="settings-name">Name</label>
      <input id="settings-name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="ghost" onClick={() => void saveName()} disabled={!validName || busy}>
        Save
      </button>
      {discordLinked === true ? (
        <p>
          Discord: <strong>@{discordName ?? 'linked'}</strong>{' '}
          <button className="ghost" onClick={() => void unlink()} disabled={busy}>
            Unlink
          </button>
        </p>
      ) : (
        <>
          <label htmlFor="settings-discord-id">Discord user ID</label>
          <input
            id="settings-discord-id"
            value={discordId}
            placeholder="123456789012345678 or @mention"
            onChange={(e) => setDiscordId(e.target.value)}
          />
          <button className="ghost" onClick={() => void link_()} disabled={!validDiscordId || busy}>
            Link
          </button>
          <p className="name-help">
            Paste your Discord user ID (or @mention) to link it, or leave name-matching to the bot.
          </p>
        </>
      )}
      {!validDiscordId ? <p className="name-error">That doesn't look like a Discord user ID</p> : null}
      {error === null ? null : <p className="name-error">{error}</p>}
    </section>
  )
}

function NotificationsSection(): JSX.Element {
  const [browserNotifications, setBrowserNotificationsState] = useState(store.browserNotifications())
  const [blocked, setBlocked] = useState(false)
  const pings = store.mySeatPings()
  const discordLinked = store.mySeatDiscordLinked()

  async function toggleBrowserNotifications(on: boolean): Promise<void> {
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      if (result !== 'granted') {
        setBlocked(true)
        store.setBrowserNotifications(false)
        setBrowserNotificationsState(false)
        return
      }
    }
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setBlocked(true)
      return
    }
    setBlocked(false)
    store.setBrowserNotifications(on)
    setBrowserNotificationsState(on)
  }

  return (
    <section>
      <h3>Notifications</h3>
      <label>
        <input
          type="checkbox"
          checked={browserNotifications}
          onChange={(e) => void toggleBrowserNotifications(e.target.checked)}
        />
        Browser notifications
      </label>
      {blocked ? <span className="name-error"> Blocked in this browser</span> : null}
      {pings !== undefined ? (
        <label>
          <input
            type="checkbox"
            checked={pings}
            onChange={(e) => void store.setPings(e.target.checked)}
          />
          Discord pings
        </label>
      ) : null}
      {discordLinked !== true ? <p className="name-help">Link Discord to get pinged</p> : null}
      <p className="name-help">
        If you're on the board we notify here first and only ping Discord after 10 minutes without
        a move.
      </p>
    </section>
  )
}

function GameSection({ faction, link }: { faction: string; link: GameLink | null }): JSX.Element {
  const seatUrl =
    link === null || typeof location === 'undefined'
      ? ''
      : `${location.origin}${location.pathname}#/g/${encodeURIComponent(link.gameId)}${
          link.seatToken === undefined ? '' : `/s/${encodeURIComponent(link.seatToken)}`
        }`

  return (
    <section>
      <h3>Game</h3>
      <p>Game id: {link?.gameId ?? '—'}</p>
      <p>Your faction: {faction}</p>
      {seatUrl.length > 0 ? (
        <label htmlFor="settings-seat-link">Seat link</label>
      ) : null}
      {seatUrl.length > 0 ? <input id="settings-seat-link" readOnly value={seatUrl} onFocus={(e) => e.currentTarget.select()} /> : null}
    </section>
  )
}
