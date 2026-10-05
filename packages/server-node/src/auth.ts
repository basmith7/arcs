/**
 * Discord OAuth sign-in and cookie sessions. `Auth.route` handles `/auth/discord`,
 * `/auth/discord/callback`, `/auth/logout` and `/me`; `accountOf` reads the session cookie for
 * other routes (e.g. `/me/games` in a later task). State lives in a short-lived `arcs_oauth`
 * cookie (the CSRF state plus the post-login return hash, base64url-encoded) rather than server
 * memory, so a restart between redirect and callback doesn't drop the sign-in.
 */
import { createHash, randomBytes } from 'node:crypto'

import type { Account } from './sqlite-store.js'
import type { SqliteStore } from './sqlite-store.js'

export const SESSION_COOKIE = 'arcs_session'
const OAUTH_COOKIE = 'arcs_oauth'

const SESSION_MAX_AGE_MS = 90 * 24 * 3600 * 1000
const OAUTH_MAX_AGE_SEC = 600
// Slide the session forward once more than a day has passed since it was last extended, instead
// of on every request.
const EXTEND_THRESHOLD_MS = SESSION_MAX_AGE_MS - 24 * 3600 * 1000

export interface AuthConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly publicOrigin: string
  readonly fetch?: typeof fetch
  readonly now?: () => number
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (header === null) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function setCookie(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A `return` value is only honoured when it is a same-origin hash route; anything else is dropped. */
function sanitizeReturn(raw: string | null): string {
  return raw !== null && raw.startsWith('#/') ? raw : ''
}

export class Auth {
  private readonly store: SqliteStore
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly publicOrigin: string
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly secure: boolean

  constructor(store: SqliteStore, config: AuthConfig) {
    this.store = store
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.publicOrigin = config.publicOrigin
    this.fetchFn = config.fetch ?? fetch
    this.now = config.now ?? Date.now
    this.secure = config.publicOrigin.startsWith('https:')
    this.store.sweepSessions(this.now())
  }

  accountOf(request: Request): Account | undefined {
    const token = parseCookies(request.headers.get('cookie')).arcs_session
    if (token === undefined) return undefined
    const now = this.now()
    const found = this.store.sessionAccount(hash(token), now)
    if (found === undefined) return undefined
    if (found.expiresAt - now < EXTEND_THRESHOLD_MS) {
      this.store.extendSession(hash(token), now + SESSION_MAX_AGE_MS)
    }
    return found.account
  }

  async route(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (path === '/auth/discord' && request.method === 'GET') {
      return this.startDiscord(url)
    }
    if (path === '/auth/discord/callback' && request.method === 'GET') {
      return this.discordCallback(request, url)
    }
    if (path === '/auth/logout' && request.method === 'POST') {
      return this.logout(request)
    }
    if (path === '/me' && request.method === 'GET') {
      return this.me(request)
    }
    return undefined
  }

  private startDiscord(url: URL): Response {
    const state = randomBytes(32).toString('base64url')
    const ret = sanitizeReturn(url.searchParams.get('return'))
    const oauth = `${state}.${Buffer.from(ret).toString('base64url')}`
    const authorize = new URL('https://discord.com/oauth2/authorize')
    authorize.search = new URLSearchParams({
      response_type: 'code',
      scope: 'identify',
      client_id: this.clientId,
      redirect_uri: `${this.publicOrigin}/auth/discord/callback`,
      state,
      prompt: 'none',
    }).toString()
    const headers = new Headers({ location: authorize.toString() })
    headers.append('set-cookie', setCookie(OAUTH_COOKIE, oauth, OAUTH_MAX_AGE_SEC, this.secure))
    return new Response(null, { status: 302, headers })
  }

  private fail(ret: string): Response {
    const headers = new Headers({ location: `${this.publicOrigin}/?signin=failed${ret}` })
    headers.append('set-cookie', setCookie(OAUTH_COOKIE, '', 0, this.secure))
    return new Response(null, { status: 302, headers })
  }

  private async discordCallback(request: Request, url: URL): Promise<Response> {
    const oauthCookie = parseCookies(request.headers.get('cookie'))[OAUTH_COOKIE]
    const dot = oauthCookie?.indexOf('.') ?? -1
    const cookieState = dot >= 0 ? oauthCookie!.slice(0, dot) : undefined
    const ret = dot >= 0 ? Buffer.from(oauthCookie!.slice(dot + 1), 'base64url').toString() : ''

    if (oauthCookie === undefined) return this.fail(ret)
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (error !== null) return this.fail(ret)
    if (state === null || state !== cookieState) return this.fail(ret)
    if (code === null) return this.fail(ret)

    try {
      const tokenRes = await this.fetchFn('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${this.publicOrigin}/auth/discord/callback`,
        }),
      })
      if (!tokenRes.ok) {
        console.warn('[auth]', `token exchange failed: ${tokenRes.status}`)
        return this.fail(ret)
      }
      const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string }

      const userRes = await this.fetchFn('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      if (!userRes.ok) {
        console.warn('[auth]', `user fetch failed: ${userRes.status}`)
        return this.fail(ret)
      }
      const user = (await userRes.json()) as { id: string; username: string; global_name?: string | null }

      const account = this.store.upsertAccount({
        discordId: user.id,
        discordName: user.username,
        displayName: user.global_name ?? user.username,
      })
      const token = randomBytes(32).toString('base64url')
      const now = this.now()
      this.store.createSession(account.id, hash(token), now + SESSION_MAX_AGE_MS)

      const headers = new Headers({ location: `${this.publicOrigin}/${ret}` })
      headers.append('set-cookie', setCookie(SESSION_COOKIE, token, SESSION_MAX_AGE_MS / 1000, this.secure))
      headers.append('set-cookie', setCookie(OAUTH_COOKIE, '', 0, this.secure))
      return new Response(null, { status: 302, headers })
    } catch (e) {
      console.warn('[auth]', (e as Error).message ?? e)
      return this.fail(ret)
    }
  }

  private logout(request: Request): Response {
    const token = parseCookies(request.headers.get('cookie')).arcs_session
    if (token !== undefined) this.store.deleteSession(hash(token))
    const headers = new Headers()
    headers.append('set-cookie', setCookie(SESSION_COOKIE, '', 0, this.secure))
    return new Response(null, { status: 204, headers })
  }

  private me(request: Request): Response {
    const account = this.accountOf(request)
    return new Response(
      JSON.stringify({
        account: account === undefined ? null : { displayName: account.displayName, discordName: account.discordName },
        enabled: true,
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    )
  }
}
