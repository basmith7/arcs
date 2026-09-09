/**
 * The client half of the three endpoints. A thin typed wrapper, and deliberately nothing more.
 *
 * It knows the shape of the API in docs/17 section 4 and nothing about the game — no engine
 * imports, no replay, no polling. Those live in `session.ts`, so this file stays the one place that
 * changes if a route ever does.
 */

export interface Seat {
  readonly faction: string
  readonly seatToken: string
}

export interface CreatedGame {
  readonly gameId: string
  readonly seats: readonly Seat[]
}

export interface PublicSeat {
  readonly faction: string
  readonly name?: string
  readonly isBot: boolean
  /** True when the seat has a linked Discord user. The id itself is never sent to the client. */
  readonly discordLinked?: boolean
  /** The linked user's Discord username, for display. */
  readonly discordName?: string
}

export interface GameTail {
  readonly options: unknown
  readonly entries: readonly string[]
  readonly length: number
  /**
   * Which faction the seat token belongs to. Absent for a spectator.
   *
   * The client cannot work this out for itself — a token is opaque — so it is the server's answer
   * to "who am I", and everything that depends on knowing your own seat hangs off it.
   */
  readonly yourFaction?: string
  /** Present on the self-hosted server; absent on upstream's Worker. */
  readonly seats?: readonly PublicSeat[]
}

export interface CreateExtra {
  readonly bots?: readonly string[]
  readonly webhookUrl?: string
}

/**
 * The outcome of an append, with `conflict` as an ordinary result rather than an exception.
 *
 * Someone double-tapped, or a tab was stale, or two clients raced. The caller re-reads from
 * `length` and carries on — which is exactly what the `expectedLength` check on the server exists
 * to make possible.
 */
export type AppendOutcome =
  | { readonly ok: true; readonly length: number }
  | { readonly ok: false; readonly conflictAt: number }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class MultiplayerClient {
  /** `baseUrl` has no trailing slash; the endpoints supply their own. */
  constructor(private readonly baseUrl: string) {}

  /**
   * Where this game's live socket is, as an absolute `ws://` or `wss://` URL.
   *
   * `WebSocket` will not take a relative URL the way `fetch` will, and the same-origin build has an
   * empty base — so the page's own address is what resolves it. The scheme has to be swapped by
   * hand: an `https` page needs `wss`, and getting that wrong fails as a mixed-content block rather
   * than as anything that mentions protocols.
   */
  liveUrl(gameId: string, pageUrl: string): string {
    const url = new URL(`${this.baseUrl}/games/${encodeURIComponent(gameId)}/live`, pageUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} -> ${res.status} ${detail}`)
    }
    return (await res.json()) as T
  }

  async create(options: unknown, factions: readonly string[], extra: CreateExtra = {}): Promise<CreatedGame> {
    return this.json<CreatedGame>('/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        options,
        factions,
        ...(extra.bots !== undefined && extra.bots.length > 0 ? { bots: extra.bots } : {}),
        ...(extra.webhookUrl !== undefined && extra.webhookUrl !== '' ? { webhookUrl: extra.webhookUrl } : {}),
      }),
    })
  }

  /**
   * The tail from `since`. The usual poll returns no entries at all — see docs/17 section 4a.
   *
   * `seatToken` only adds `yourFaction` to the answer; the journal is identical with or without it.
   * It travels as a header rather than a query parameter because it is the credential, and query
   * strings are the part of a URL that ends up in access logs and referrers.
   */
  async read(gameId: string, since: number, seatToken?: string): Promise<GameTail> {
    return this.json<GameTail>(`/games/${encodeURIComponent(gameId)}?since=${since}`, {
      ...(seatToken === undefined ? {} : { headers: { 'x-seat-token': seatToken } }),
    })
  }

  /**
   * Claim a seat by name, so the game and other players can show who you are.
   *
   * `discordId` is sent only when the caller passed one — an omitted argument leaves the seat's
   * existing link (or the server's own name-matching) untouched, while an explicit `""` clears it.
   */
  async claimName(
    gameId: string,
    seatToken: string,
    name: string,
    discordId?: string,
  ): Promise<readonly PublicSeat[]> {
    const body = await this.json<{ seats: readonly PublicSeat[] }>(`/games/${encodeURIComponent(gameId)}/seat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken, name, ...(discordId === undefined ? {} : { discordId }) }),
    })
    return body.seats
  }

  /**
   * Append one encoded action.
   *
   * A 409 is not thrown. It is the documented way the server says "someone got there first", and
   * turning it into an exception would make the ordinary case look like a failure at every call
   * site.
   */
  async append(
    gameId: string,
    seatToken: string,
    expectedLength: number,
    action: string,
  ): Promise<AppendOutcome> {
    const res = await fetch(`${this.baseUrl}/games/${encodeURIComponent(gameId)}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken, expectedLength, action }),
    })
    if (res.status === 409) {
      const body = (await res.json()) as { length: number }
      return { ok: false, conflictAt: body.length }
    }
    if (!res.ok) {
      throw new ApiError(res.status, `append -> ${res.status} ${await res.text().catch(() => '')}`)
    }
    const body = (await res.json()) as { length: number }
    return { ok: true, length: body.length }
  }
}
