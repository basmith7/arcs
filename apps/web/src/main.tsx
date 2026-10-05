import React from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import { loadAccount, setSigninFailed } from './account.js'
import { MULTIPLAYER_URL } from './multiplayer/config.js'
import { parseLink, recall } from './multiplayer/link.js'
import { store } from './store.js'
import './styles.css'
import './phone.css'
import './phone-modals.css'

/*
 * Navigation is a reload: every hash change boots the page afresh, so a game link, the lobby and
 * `#/me` each enter through this one path rather than through in-page routing that would have to
 * unwind a joined session by hand.
 */
window.addEventListener('hashchange', () => window.location.reload())

/*
 * A failed Discord sign-in comes back as `?signin=failed`. Say so once, then drop the parameter so
 * a refresh does not say it again.
 */
const params = new URLSearchParams(window.location.search)
if (params.get('signin') === 'failed') {
  setSigninFailed(true)
  history.replaceState(null, '', window.location.pathname + window.location.hash)
}
if (MULTIPLAYER_URL !== null) void loadAccount(MULTIPLAYER_URL)

/*
 * A game link in the address bar joins that game before anything renders, so a player who follows
 * their link lands in the game rather than on the setup screen.
 *
 * `recall` covers the case the link design is most exposed to: a URL that has lost its seat token —
 * copied without the tail, or trimmed by a chat client — where this browser has played that game
 * before. It upgrades a would-be spectator back into their seat rather than silently demoting them,
 * which is the difference between "my game is broken" and nothing being noticed at all.
 *
 * Read once per boot: a hash change reloads (above), so this is also how following a link in-page
 * enters a game.
 */
const link = parseLink(window.location.hash)
if (link !== null && link !== undefined && MULTIPLAYER_URL !== null) {
  const seatToken = link.seatToken ?? recall(link.gameId)
  void store.joinSession(MULTIPLAYER_URL, seatToken === undefined ? link : { ...link, seatToken })
} else if (link === null || link === undefined) {
  /*
   * No game link in the address bar: this boot is a local game's, so the autosave (if any)
   * comes back before anything renders — a refresh continues the game. A game-link hash with
   * multiplayer disabled deliberately restores nothing: the URL claims a joined game, and a
   * local game must not appear underneath it.
   */
  store.restoreAutosave()
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
