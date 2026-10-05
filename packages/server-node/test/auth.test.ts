import { describe, expect, it } from 'vitest'

import { Auth } from '../src/auth.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { cookieOf, discordFake, signIn } from './fixtures.js'

const ORIGIN = 'https://arcs.test'

describe('Auth', () => {
  it('signs in: account, session cookie, back to the return hash', async () => {
    const store = new SqliteStore(':memory:')
    const auth = new Auth(store, { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const res = (await signIn(auth))!
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/#/g/abc`)
    const session = cookieOf(res, 'arcs_session')!
    expect(res.headers.getSetCookie().join('\n')).toMatch(/arcs_session=[^;]+; .*HttpOnly.*SameSite=Lax.*Secure/)
    const me = await auth.route(new Request(`${ORIGIN}/me`, { headers: { cookie: `arcs_session=${session}` } }))
    expect(await me!.json()).toEqual({ account: { displayName: 'Brian', discordName: 'bri' }, enabled: true })
  })

  it('a bad state or a cancelled consent creates no session and returns with signin=failed', async () => {
    const store = new SqliteStore(':memory:')
    const auth = new Auth(store, { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const start = (await auth.route(new Request(`${ORIGIN}/auth/discord?return=%23%2Fme`)))!
    const oauth = cookieOf(start, 'arcs_oauth')!
    for (const q of ['code=c&state=wrong', 'error=access_denied&state=x']) {
      const res = (await auth.route(new Request(`${ORIGIN}/auth/discord/callback?${q}`, { headers: { cookie: `arcs_oauth=${oauth}` } })))!
      expect(res.headers.get('location')).toBe(`${ORIGIN}/?signin=failed#/me`)
      expect(cookieOf(res, 'arcs_session')).toBeUndefined()
    }
  })

  it('drops a return that is not a hash route', async () => {
    const auth = new Auth(new SqliteStore(':memory:'), { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    for (const bad of ['https://evil.example', '#/日本']) {
      const res = (await signIn(auth, bad))!
      expect(res.headers.get('location')).toBe(`${ORIGIN}/`)
    }
  })

  it('a session in use slides: /me at day 89 re-issues the cookie and the session outlives day 90', async () => {
    const DAY = 24 * 3600 * 1000
    let t = Date.UTC(2026, 0, 1)
    const auth = new Auth(new SqliteStore(':memory:'), {
      clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f, now: () => t,
    })
    const session = cookieOf((await signIn(auth))!, 'arcs_session')!
    const cookie = { cookie: `arcs_session=${session}` }
    t += 89 * DAY
    const me = (await auth.route(new Request(`${ORIGIN}/me`, { headers: cookie })))!
    expect(cookieOf(me, 'arcs_session')).toBe(session)
    expect(me.headers.getSetCookie().join('\n')).toMatch(/Max-Age=7776000/)
    t += 10 * DAY
    expect(auth.accountOf(new Request(`${ORIGIN}/me`, { headers: cookie }))?.displayName).toBe('Brian')
  })

  it('logout deletes the session', async () => {
    const auth = new Auth(new SqliteStore(':memory:'), { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const session = cookieOf((await signIn(auth))!, 'arcs_session')!
    const cookie = { cookie: `arcs_session=${session}` }
    await auth.route(new Request(`${ORIGIN}/auth/logout`, { method: 'POST', headers: cookie }))
    expect(auth.accountOf(new Request(`${ORIGIN}/me`, { headers: cookie }))).toBeUndefined()
  })
})
