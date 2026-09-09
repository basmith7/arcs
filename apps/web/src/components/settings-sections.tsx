import { useState } from 'react'

import { isValidDiscordId, isValidName } from '../seat-form.js'
import { store } from '../store.js'
import type { GameLink } from '../multiplayer/link.js'

/**
 * The seated-player sections of the settings dialog: name/Discord linking, notification
 * preferences, and the game's own identity (id, faction, seat link). Shown only when a seat is
 * present — see `SettingsModal`'s `seat` prop.
 */
export function PlayerSection({ faction }: { faction: string }): JSX.Element {
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
    <section className="set-section">
      <h3 className="set-heading">Player</h3>
      <label className="set-row" htmlFor="settings-name">
        <span className="set-label">Name</span>
        <input
          id="settings-name"
          className="set-input"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button className="da-ghost" onClick={() => void saveName()} disabled={!validName || busy}>
        Save
      </button>
      {discordLinked === true ? (
        <p className="set-row">
          <span className="set-label">Discord</span>
          <span className="set-value">@{discordName ?? 'linked'}</span>
          <button className="da-ghost" onClick={() => void unlink()} disabled={busy}>
            Unlink
          </button>
        </p>
      ) : (
        <>
          <label className="set-row" htmlFor="settings-discord-id">
            <span className="set-label">Discord user ID</span>
            <input
              id="settings-discord-id"
              className="set-input"
              value={discordId}
              placeholder="123456789012345678 or @mention"
              onChange={(e) => setDiscordId(e.target.value)}
            />
          </label>
          <button className="da-ghost" onClick={() => void link_()} disabled={!validDiscordId || busy}>
            Link
          </button>
          <p className="set-note">
            Paste your Discord user ID (or @mention) to link it, or leave name-matching to the bot.
          </p>
        </>
      )}
      {!validDiscordId ? <p className="set-note set-error">That doesn't look like a Discord user ID</p> : null}
      {error === null ? null : <p className="set-note set-error">{error}</p>}
    </section>
  )
}

export function NotificationsSection(): JSX.Element {
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
    <section className="set-section">
      <h3 className="set-heading">Notifications</h3>
      <label className="set-row">
        <span className="set-label">Browser notifications</span>
        <input
          className="set-check"
          type="checkbox"
          checked={browserNotifications}
          onChange={(e) => void toggleBrowserNotifications(e.target.checked)}
        />
        {blocked ? <span className="set-note set-error">Blocked in this browser</span> : null}
      </label>
      {pings !== undefined ? (
        <label className="set-row">
          <span className="set-label">Discord pings</span>
          <input
            className="set-check"
            type="checkbox"
            checked={pings}
            onChange={(e) => void store.setPings(e.target.checked)}
          />
        </label>
      ) : null}
      {discordLinked !== true ? <p className="set-note">Link Discord to get pinged</p> : null}
      <p className="set-note">
        If you're on the board we notify here first and only ping Discord after 10 minutes without
        a move.
      </p>
    </section>
  )
}

export function GameSection({ faction, link }: { faction: string; link: GameLink | null }): JSX.Element {
  const seatUrl =
    link === null || typeof location === 'undefined'
      ? ''
      : `${location.origin}${location.pathname}#/g/${encodeURIComponent(link.gameId)}${
          link.seatToken === undefined ? '' : `/s/${encodeURIComponent(link.seatToken)}`
        }`

  return (
    <section className="set-section">
      <h3 className="set-heading">Game</h3>
      <p className="set-row">
        <span className="set-label">Game id</span>
        <span className="set-value">{link?.gameId ?? '—'}</span>
      </p>
      <p className="set-row">
        <span className="set-label">Your faction</span>
        <span className="set-value">{faction}</span>
      </p>
      {seatUrl.length > 0 ? (
        <label className="set-row" htmlFor="settings-seat-link">
          <span className="set-label">Seat link</span>
          <input
            id="settings-seat-link"
            className="set-input"
            readOnly
            value={seatUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      ) : null}
    </section>
  )
}
