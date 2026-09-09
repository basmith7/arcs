/**
 * node:http host. Converts each IncomingMessage to a web-standard Request for `route`, writes the
 * Response back, serves `apps/web/dist` for everything else, and upgrades `/games/:id/live` to a
 * WebSocket fed by the gate's pushes. The push shape matches upstream's Durable Object exactly
 * (`{from, entries}`) so the client's `session.ts` is untouched; a name claim adds `seats`.
 */
import { createReadStream, statSync } from 'node:fs'
import http from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { Readable } from 'node:stream'

import { WebSocketServer } from 'ws'

import { publicSeats, route } from './api.js'
import type { Api } from './api.js'

export interface ServerOptions {
  readonly api: Api
  readonly staticDir?: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

function toRequest(req: http.IncomingMessage): Request {
  const host = req.headers.host ?? 'localhost'
  const url = `http://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v)
    else if (Array.isArray(v)) headers.set(k, v.join(', '))
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as unknown as BodyInit, duplex: 'half' } : {}),
  } as RequestInit)
}

async function send(res: http.ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((v, k) => res.setHeader(k, v))
  const text = await response.text()
  res.end(text)
}

function serveStatic(staticDir: string, urlPath: string, res: http.ServerResponse): void {
  const root = resolve(staticDir)
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const wanted = normalize(join(root, decoded))
  const safe = wanted.startsWith(root) ? wanted : root
  let file = safe
  try {
    if (!statSync(file).isFile()) throw new Error('dir')
  } catch {
    file = join(root, 'index.html')
  }
  let size: number
  try {
    size = statSync(file).size
  } catch {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const ext = extname(file)
  res.statusCode = 200
  res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('content-length', size)
  // Hashed Vite assets are immutable; index.html must not be cached so deploys take effect.
  res.setHeader('cache-control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable')
  createReadStream(file).pipe(res)
}

export function createArcsServer(opts: ServerOptions): http.Server {
  const { staticDir } = opts
  const api: Api = { ...opts.api, onSeatsChanged: (id: string) => broadcastSeats(opts.api, id) }

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const response = await route(toRequest(req), api)
        if (response !== undefined) return await send(res, response)
        if (staticDir === undefined) {
          res.statusCode = 404
          return res.end('not found')
        }
        serveStatic(staticDir, req.url ?? '/', res)
      } catch (e) {
        console.error('[http]', (e as Error).stack ?? e)
        if (!res.headersSent) res.statusCode = 500
        res.end('internal error')
      }
    })()
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/games\/([^/?]+)\/live\/?(\?.*)?$/.exec(req.url ?? '')
    const gameId = m === null ? undefined : decodeURIComponent(m[1]!)
    if (gameId === undefined || api.store.options(gameId) === undefined) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const unsubscribe = api.gate.subscribe(gameId, (push) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(push))
      })
      ws.on('close', unsubscribe)
      ws.on('error', unsubscribe)
    })
  })

  return server
}

/** Tell every socket on a game that its seats changed (name claim). Zero entries: a no-op for the journal. */
export function broadcastSeats(api: Api, gameId: string): void {
  const length = api.gate.resultOf(gameId)?.state.journal.length ?? 0
  api.gate.broadcast(gameId, { from: length, entries: [], seats: publicSeats(api.store, gameId) })
}
