import { mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { EngineGate } from '../src/gate.js'
import { Presence } from '../src/presence.js'
import { createArcsServer } from '../src/server.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { ONE_HUMAN, RED_FIRST_LEAD, RED_OPENING } from './fixtures.js'

const closers: (() => void)[] = []
afterEach(() => {
  for (const c of closers.splice(0)) c()
})

async function listen(heartbeatMs?: number, presence?: Presence) {
  const staticDir = mkdtempSync(join(tmpdir(), 'arcs-static-'))
  writeFileSync(join(staticDir, 'index.html'), '<html>arcs</html>')
  writeFileSync(join(staticDir, 'app.js'), 'console.log(1)')
  const store = new SqliteStore(':memory:')
  const gate = new EngineGate(store, { pace: 0 })
  const server = createArcsServer({
    api: { store, gate },
    staticDir,
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
    ...(presence === undefined ? {} : { presence }),
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  closers.push(() => server.close())
  return { base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}`, store, gate }
}

describe('createArcsServer', () => {
  it('serves the API, static files and the SPA fallback', async () => {
    const { base } = await listen()
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
    expect(await (await fetch(`${base}/app.js`)).text()).toBe('console.log(1)')
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toContain('javascript')
    expect(await (await fetch(`${base}/anything/else`)).text()).toBe('<html>arcs</html>')
    expect((await fetch(`${base}/games/nope`)).status).toBe(404)
    expect((await fetch(`${base}/../etc/passwd`)).status).not.toBe(500)
  })

  it('pushes every append, including bot moves, over the live socket', async () => {
    const { base, ws } = await listen()
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string; seats: { seatToken: string }[] }

    const sock = new WebSocket(`${ws}/games/${created.gameId}/live`)
    await new Promise<void>((r, j) => {
      sock.once('open', r)
      sock.once('error', j)
    })
    closers.push(() => sock.close())
    const pushes: { from: number; entries: string[] }[] = []
    sock.on('message', (data) => pushes.push(JSON.parse(String(data))))

    for (const [i, action] of RED_OPENING.entries()) {
      const res = await fetch(`${base}/games/${created.gameId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seatToken: created.seats[0]!.seatToken, expectedLength: i, action }),
      })
      expect(res.status).toBe(200)
    }
    // Bots run after the last response; wait for the journal to settle.
    const deadline = Date.now() + 10_000
    for (;;) {
      const tail = (await (await fetch(`${base}/games/${created.gameId}`)).json()) as { length: number }
      if (tail.length > RED_OPENING.length && pushes.length >= tail.length) break
      if (Date.now() > deadline) throw new Error('bots never pushed')
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(pushes[0]).toEqual({ from: 0, entries: [RED_FIRST_LEAD] })
    expect(pushes.map((p) => p.from)).toEqual(pushes.map((_, i) => i))
  })

  it('never crashes on an unparsable upgrade path and keeps answering healthz', async () => {
    const { base, ws } = await listen()
    const sock = new WebSocket(`${ws}/games/%zz/live`)
    const outcome = await new Promise<string>((r) => {
      sock.once('open', () => r('open'))
      sock.once('error', () => r('error'))
      sock.once('unexpected-response', () => r('error'))
    })
    expect(outcome).toBe('error')
    expect((await fetch(`${base}/healthz`)).status).toBe(200)
  })

  it('rejects an oversized POST body with 413', async () => {
    const { base } = await listen()
    const big = JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, junk: 'x'.repeat(70 * 1024) })
    const res = await fetch(`${base}/games`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too-large' })
  })

  it('closes the connection on a 413 instead of leaving it keep-alive (framing safety on a pooled socket)', async () => {
    const { base } = await listen()
    const url = new URL(`${base}/games`)
    const agent = new http.Agent({ keepAlive: true })
    closers.push(() => agent.destroy())
    const big = JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, junk: 'x'.repeat(70 * 1024) })
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          agent,
          headers: { 'content-type': 'application/json', connection: 'keep-alive' },
        },
        resolve,
      )
      req.on('error', reject)
      req.end(big)
    })
    res.resume()
    await new Promise<void>((r) => res.once('end', r))
    expect(res.statusCode).toBe(413)
    expect(res.headers.connection).toBe('close')
    // The socket itself was destroyed, not just returned to the pool.
    await new Promise<void>((r) => {
      if (res.socket?.destroyed) return r()
      res.socket?.once('close', () => r())
    })
    expect(res.socket?.destroyed).toBe(true)
  })

  it('terminates a socket that stops answering heartbeat pings, and the gate loses its subscriber', async () => {
    const { base, ws, gate } = await listen(20)
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string }

    const sock = new WebSocket(`${ws}/games/${created.gameId}/live`)
    await new Promise<void>((r) => sock.once('open', r))
    // Stop reading from the socket so ping frames are never parsed and no pong is ever sent back.
    ;(sock as unknown as { _socket: { pause: () => void } })._socket.pause()

    const deadline = Date.now() + 5000
    while (gate.subscriberCount(created.gameId) > 0) {
      if (Date.now() > deadline) throw new Error('socket was never terminated')
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(gate.subscriberCount(created.gameId)).toBe(0)
  })

  it('drops the per-game socket bookkeeping once every socket closes, so the cap does not stick', async () => {
    const { base, ws } = await listen()
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string }

    const open = (): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const sock = new WebSocket(`${ws}/games/${created.gameId}/live`)
        sock.once('open', () => resolve(sock))
        sock.once('error', reject)
      })

    // Fill the per-game cap of 32, then close every one of them.
    const first = await Promise.all(Array.from({ length: 32 }, open))
    await Promise.all(
      first.map(
        (sock) =>
          new Promise<void>((r) => {
            sock.once('close', r)
            sock.close()
          }),
      ),
    )

    // If the game's socket-count bookkeeping were never cleared, this second batch of 32 would
    // still see a full-looking bucket. A fresh reservation of the whole cap must succeed cleanly.
    const second = await Promise.all(Array.from({ length: 32 }, open))
    for (const sock of second) expect(sock.readyState).toBe(WebSocket.OPEN)
    for (const sock of second) sock.close()
  })

  it('refuses a socket for an unknown game', async () => {
    const { ws } = await listen()
    const sock = new WebSocket(`${ws}/games/nope/live`)
    const outcome = await new Promise<string>((r) => {
      sock.once('open', () => r('open'))
      sock.once('error', () => r('error'))
      sock.once('unexpected-response', () => r('error'))
    })
    expect(outcome).toBe('error')
  })

  it('broadcasts seats when a name is claimed', async () => {
    const { base, ws } = await listen()
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string; seats: { seatToken: string }[] }
    const sock = new WebSocket(`${ws}/games/${created.gameId}/live`)
    await new Promise<void>((r) => sock.once('open', r))
    closers.push(() => sock.close())
    const got = new Promise<unknown>((r) => sock.once('message', (d) => r(JSON.parse(String(d)))))
    await fetch(`${base}/games/${created.gameId}/seat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken: created.seats[0]!.seatToken, name: 'Brian' }),
    })
    expect(await got).toEqual({ from: 0, entries: [], seats: [
      { faction: 'red', name: 'Brian', isBot: false, pings: true },
      { faction: 'yellow', isBot: true },
      { faction: 'blue', isBot: true },
    ] })
  })

  it('connecting with ?seat=<token> makes presence active for that seat', async () => {
    const presence = new Presence()
    const { base, ws } = await listen(undefined, presence)
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string; seats: { seatToken: string }[] }
    const seatToken = created.seats[0]!.seatToken
    const sock = new WebSocket(`${ws}/games/${created.gameId}/live?seat=${seatToken}`)
    await new Promise<void>((r) => sock.once('open', r))
    closers.push(() => sock.close())
    expect(presence.isActive(created.gameId, seatToken)).toBe(true)
  })

  it('an unknown ?seat= still connects fine, staying anonymous', async () => {
    const presence = new Presence()
    const { base, ws } = await listen(undefined, presence)
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string; seats: { seatToken: string }[] }
    const sock = new WebSocket(`${ws}/games/${created.gameId}/live?seat=bogus`)
    await new Promise<void>((r, j) => {
      sock.once('open', r)
      sock.once('error', j)
    })
    closers.push(() => sock.close())
    expect(presence.isActive(created.gameId, 'bogus')).toBe(false)
  })

  it('sending {"t":"active"} touches presence, and closing fires onLeave', async () => {
    let clock = 0
    const presence = new Presence({ now: () => clock, activeMs: 1000 })
    const { base, ws } = await listen(undefined, presence)
    const created = (await (
      await fetch(`${base}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: ONE_HUMAN, factions: ONE_HUMAN.factions, bots: ['yellow', 'blue'] }),
      })
    ).json()) as { gameId: string; seats: { seatToken: string }[] }
    const seatToken = created.seats[0]!.seatToken
    const left: string[] = []
    presence.onLeave((gameId, token) => left.push(`${gameId}/${token}`))
    const sock = new WebSocket(`${ws}/games/${created.gameId}/live?seat=${seatToken}`)
    await new Promise<void>((r) => sock.once('open', r))
    clock += 1001
    expect(presence.isActive(created.gameId, seatToken)).toBe(false)
    sock.send(JSON.stringify({ t: 'active' }))
    await new Promise((r) => setTimeout(r, 25))
    expect(presence.isActive(created.gameId, seatToken)).toBe(true)

    await new Promise<void>((r) => {
      sock.once('close', r)
      sock.close()
    })
    await new Promise((r) => setTimeout(r, 25))
    expect(presence.isActive(created.gameId, seatToken)).toBe(false)
    expect(left).toEqual([`${created.gameId}/${seatToken}`])
  })
})
