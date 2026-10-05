/**
 * The link *is* the credential — docs/17 section 3.
 *
 * No accounts, no login, no email. At creation the server mints one game and N seats, and each
 * player gets their own URL:
 *
 *   https://arcs.example/#/g/3f2a…/s/9c81…      <- red's link
 *   https://arcs.example/#/g/3f2a…              <- a spectator: game, no seat
 *
 * Everything lives in the hash, so the route never reaches the server and no host has to be taught
 * about it. The Worker's asset routing sees a bare `/` and serves `index.html`; GitHub Pages, which
 * has no server-side routing at all, does the same. One format works on both.
 *
 * **Losing the link is the failure mode**, so `remember` stashes it under the game id on first
 * visit. Keyed by game rather than a single "current" slot, because a player may reasonably have
 * two games open — overwriting one with the other is precisely the way to lose a seat.
 */

export interface GameLink {
  readonly gameId: string
  /** Absent for a spectator, who may watch and may not act. */
  readonly seatToken?: string
}

const KEY = (gameId: string): string => `arcs:seat:${gameId}`

/** Parse `#/g/<gameId>[/s/<seatToken>]`, or `undefined` for an ordinary local game. */
export function parseLink(hash: string): GameLink | undefined {
  const withSeat = /^#\/g\/([^/]+)\/s\/([^/]+)\/?$/.exec(hash)
  if (withSeat !== null) {
    return { gameId: decodeURIComponent(withSeat[1]!), seatToken: decodeURIComponent(withSeat[2]!) }
  }
  const spectator = /^#\/g\/([^/]+)\/?$/.exec(hash)
  if (spectator !== null) return { gameId: decodeURIComponent(spectator[1]!) }
  return undefined
}

/**
 * Just the hash, for when the origin is already where you are — setting `window.location.hash`
 * after creating a game, rather than handing someone a URL.
 *
 * Separate from `linkFor` only so the route format has one definition. It is parsed by `parseLink`
 * above, and a copy of it that drifted would fail as a link nobody can join.
 */
export function hashFor(gameId: string, seatToken?: string): string {
  const seat = seatToken === undefined ? '' : `/s/${encodeURIComponent(seatToken)}`
  return `#/g/${encodeURIComponent(gameId)}${seat}`
}

export function linkFor(origin: string, gameId: string, seatToken?: string): string {
  return `${origin}/${hashFor(gameId, seatToken)}`
}

/**
 * Remember a seat token, so a reload does not cost the player their turn.
 *
 * Storage failures are swallowed: private browsing and a full quota both throw, and neither is a
 * reason to fail a game that is otherwise working. The link in the address bar remains the source
 * of truth; this is a convenience over it, not a replacement for it.
 */
export function remember(link: GameLink): void {
  if (link.seatToken === undefined) return
  try {
    localStorage.setItem(KEY(link.gameId), link.seatToken)
  } catch {
    /* no storage, no problem — the URL still has it */
  }
}

/** A previously stashed seat for this game, if the URL has lost it. */
export function recall(gameId: string): string | undefined {
  try {
    return localStorage.getItem(KEY(gameId)) ?? undefined
  } catch {
    return undefined
  }
}

const KEY_PREFIX = 'arcs:seat:'

/**
 * Every seat `remember` has stashed, across every game — the list behind "My games". Walked by
 * index rather than read by a known key, the same as `recall` reads one by a known key, because
 * there is no index of which games were ever joined other than `localStorage` itself.
 */
export function rememberedSeats(): { gameId: string; seatToken: string }[] {
  try {
    const seats: { gameId: string; seatToken: string }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key === null || !key.startsWith(KEY_PREFIX)) continue
      const seatToken = localStorage.getItem(key)
      if (seatToken === null) continue
      seats.push({ gameId: key.slice(KEY_PREFIX.length), seatToken })
    }
    return seats
  } catch {
    return []
  }
}
