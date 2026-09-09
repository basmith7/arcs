import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { EngineGate } from '../src/gate.js'
import { createArcsServer } from '../src/server.js'
import { SqliteStore } from '../src/sqlite-store.js'
import { ONE_HUMAN, RED_FIRST_LEAD, RED_OPENING } from './fixtures.js'

const closers: (() => void)[] = []
afterEach(() => {
  for (const c of closers.splice(0)) c()
})

async function listen() {
  const staticDir = mkdtempSync(join(tmpdir(), 'arcs-static-'))
  writeFileSync(join(staticDir, 'index.html'), '<html>arcs</html>')
  writeFileSync(join(staticDir, 'app.js'), 'console.log(1)')
  const store = new SqliteStore(':memory:')
  const gate = new EngineGate(store, { pace: 0 })
  const server = createArcsServer({ api: { store, gate }, staticDir })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  closers.push(() => server.close())
  return { base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}`, store }
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
      { faction: 'red', name: 'Brian', isBot: false },
      { faction: 'yellow', isBot: true },
      { faction: 'blue', isBot: true },
    ] })
  })
})
