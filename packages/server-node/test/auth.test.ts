import { describe, expect, it } from 'vitest'

import { Auth } from '../src/auth.js'
import { SqliteStore } from '../src/sqlite-store.js'

const ORIGIN = 'https://arcs.test'
function discordFake(user = { id: '111111111111111111', username: 'bri', global_name: 'Brian' }) {
  const calls: string[] = []
  const f = (async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith('/oauth2/token')) return Response.json({ access_token: 'at', token_type: 'Bearer' })
    if (u.endsWith('/users/@me')) return Response.json(user)
    return new Response('no', { status: 404 })
  }) as typeof fetch
  return { f, calls }
}
const cookieOf = (res: Response, name: string): string | undefined =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0]!.slice(name.length + 1)

async function signIn(auth: Auth, ret = '#/g/abc') {
  const start = await auth.route(new Request(`${ORIGIN}/auth/discord?return=${encodeURIComponent(ret)}`))
  const oauth = cookieOf(start!, 'arcs_oauth')!
  const state = new URL(start!.headers.get('location')!).searchParams.get('state')!
  return auth.route(new Request(`${ORIGIN}/auth/discord/callback?code=c&state=${state}`, { headers: { cookie: `arcs_oauth=${oauth}` } }))
}

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
    const res = (await signIn(auth, 'https://evil.example'))!
    expect(res.headers.get('location')).toBe(`${ORIGIN}/`)
  })

  it('logout deletes the session', async () => {
    const auth = new Auth(new SqliteStore(':memory:'), { clientId: 'id', clientSecret: 's', publicOrigin: ORIGIN, fetch: discordFake().f })
    const session = cookieOf((await signIn(auth))!, 'arcs_session')!
    const cookie = { cookie: `arcs_session=${session}` }
    await auth.route(new Request(`${ORIGIN}/auth/logout`, { method: 'POST', headers: cookie }))
    expect(auth.accountOf(new Request(`${ORIGIN}/me`, { headers: cookie }))).toBeUndefined()
  })
})
