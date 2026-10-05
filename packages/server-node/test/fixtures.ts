import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyExternal, defaultRegistry, encodeAction, startGame } from '@arcs/engine'
import type { NewGameOptions } from '@arcs/engine'

import type { Auth } from '../src/auth.js'

/** A fake Discord OAuth `fetch`, returning the given user from `/users/@me`. */
export function discordFake(user = { id: '111111111111111111', username: 'bri', global_name: 'Brian' }) {
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

export const cookieOf = (res: Response, name: string): string | undefined =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0]!.slice(name.length + 1)

/** Drives a full OAuth round trip against `auth` and returns the callback's redirect response. */
export async function signIn(auth: Auth, ret = '#/g/abc', origin = 'https://arcs.test'): Promise<Response | undefined> {
  const start = await auth.route(new Request(`${origin}/auth/discord?return=${encodeURIComponent(ret)}`))
  const oauth = cookieOf(start!, 'arcs_oauth')!
  const state = new URL(start!.headers.get('location')!).searchParams.get('state')!
  return auth.route(new Request(`${origin}/auth/discord/callback?code=c&state=${state}`, { headers: { cookie: `arcs_oauth=${oauth}` } }))
}

/** Three players, base game, fixed seed. Red leads first (verified by probe). */
export const THREE_PLAYER: NewGameOptions = {
  board: 'Board3MixUp',
  factions: ['red', 'yellow', 'blue'],
  seed: 7,
}

/** Same table with two bot seats: red is the only human. */
export const ONE_HUMAN: NewGameOptions = { ...THREE_PLAYER, bots: ['yellow', 'blue'] }

/**
 * Red's whole opening turn for THREE_PLAYER seed 7: the first legal action at every ask, until the
 * engine asks yellow. Computed from the engine so it can never drift from the rules.
 */
export const RED_OPENING: readonly string[] = (() => {
  const registry = defaultRegistry()
  let result = startGame(THREE_PLAYER, registry)
  const out: string[] = []
  for (;;) {
    const c = result.continue
    if (c.kind !== 'ask' || c.faction !== 'red') return out
    const action = c.actions[0]!
    out.push(encodeAction(action))
    result = applyExternal(result, action, registry)
  }
})()

/** The first action of that opening: `turn/lead(card="Aggression-4",faction="red",suit="Aggression")`. */
export const RED_FIRST_LEAD = RED_OPENING[0]!

/** Replay `RED_OPENING` through anything with an `append(gameId, seatToken, expectedLength, action)`. */
export async function playOpening(
  target: { append(gameId: string, seatToken: string, expectedLength: number, action: string): Promise<unknown> },
  gameId: string,
  redToken: string,
): Promise<void> {
  for (const [i, action] of RED_OPENING.entries()) await target.append(gameId, redToken, i, action)
}

export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'arcs-')), 'arcs.db')
}
