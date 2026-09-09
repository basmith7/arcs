/**
 * node:http host. Converts each IncomingMessage to a web-standard Request for `route`, writes the
 * Response back, serves `apps/web/dist` for everything else, and upgrades `/games/:id/live` to a
 * WebSocket fed by the gate's pushes. The push shape matches upstream's Durable Object exactly
 * (`{from, entries}`) so the client's `session.ts` is untouched; a name claim adds `seats`.
 */
import { createReadStream, statSync } from 'node:fs'
import http from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

import { WebSocketServer } from 'ws'

import { publicSeats, route } from './api.js'
import type { Api } from './api.js'

export interface ServerOptions {
  readonly api: Api
  readonly staticDir?: string
  /** Milliseconds between websocket heartbeat pings. Default 30000. */
  readonly heartbeatMs?: number
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

const MAX_BODY_BYTES = 65536

/** Wraps the request body so a stream with no `content-length` still gets cut off at the cap. */
function cappedBody(req: http.IncomingMessage, tooLarge: { flag: boolean }): ReadableStream<Uint8Array> {
  const base = Readable.toWeb(req) as ReadableStream<Uint8Array>
  let total = 0
  return base.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength
        if (total > MAX_BODY_BYTES) {
          tooLarge.flag = true
          controller.error(new Error('too-large'))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
}

/** Returns `undefined` when the declared content-length alone already exceeds the cap. */
function toRequest(req: http.IncomingMessage, tooLarge: { flag: boolean }): Request | undefined {
  const host = req.headers.host ?? 'localhost'
  const url = `http://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers.set(k, v)
    else if (Array.isArray(v)) headers.set(k, v.join(', '))
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const contentLength = Number(req.headers['content-length'])
  if (hasBody && Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return undefined
  if (!headers.has('x-forwarded-for')) {
    headers.set('x-arcs-remote-addr', req.socket.remoteAddress ?? '')
  }
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: cappedBody(req, tooLarge) as unknown as BodyInit, duplex: 'half' } : {}),
  } as RequestInit)
}

function tooLargeResponse(res: http.ServerResponse): void {
  // The client may still be mid-stream on this connection (unread body bytes for the
  // content-length case, or a body we deliberately stopped reading for the streamed case).
  // Either way the connection can no longer be trusted to be framed correctly for a next
  // request, so tell the client to close and force the socket shut once the response is out.
  res.statusCode = 413
  res.setHeader('content-type', 'application/json')
  res.setHeader('connection', 'close')
  res.end(JSON.stringify({ error: 'too-large' }), () => res.socket?.destroy())
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
  const inRoot = wanted === root || wanted.startsWith(root + sep)
  const safe = inRoot ? wanted : root
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
      const tooLarge = { flag: false }
      try {
        const request = toRequest(req, tooLarge)
        if (request === undefined) return tooLargeResponse(res)
        const response = await route(request, api)
        if (tooLarge.flag) return tooLargeResponse(res)
        if (response !== undefined) return await send(res, response)
        if (staticDir === undefined) {
          res.statusCode = 404
          return res.end('not found')
        }
        serveStatic(staticDir, req.url ?? '/', res)
      } catch (e) {
        if (tooLarge.flag) return tooLargeResponse(res)
        console.error('[http]', (e as Error).stack ?? e)
        if (!res.headersSent) res.statusCode = 500
        res.end('internal error')
      }
    })()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  const gameSockets = new Map<string, Set<import('ws').WebSocket>>()
  const alive = new WeakSet<import('ws').WebSocket>()
  const heartbeatMs = opts.heartbeatMs ?? 30000
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate()
        continue
      }
      alive.delete(ws)
      ws.ping()
    }
  }, heartbeatMs)
  heartbeat.unref()

  server.on('upgrade', (req, socket, head) => {
    try {
      const m = /^\/games\/([^/?]+)\/live\/?(\?.*)?$/.exec(req.url ?? '')
      const gameId = m === null ? undefined : decodeURIComponent(m[1]!)
      if (gameId === undefined || api.store.options(gameId) === undefined) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        let sockets = gameSockets.get(gameId)
        if (sockets === undefined) {
          sockets = new Set()
          gameSockets.set(gameId, sockets)
        }
        if (sockets.size >= 32) {
          ws.close(1013)
          return
        }
        sockets.add(ws)
        alive.add(ws)
        ws.on('pong', () => alive.add(ws))
        const unsubscribe = api.gate.subscribe(gameId, (push) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(push))
        })
        const cleanup = (): void => {
          unsubscribe()
          sockets.delete(ws)
          if (sockets.size === 0) gameSockets.delete(gameId)
        }
        ws.on('close', cleanup)
        ws.on('error', cleanup)
      })
    } catch (e) {
      console.error('[ws upgrade]', (e as Error).stack ?? e)
      try {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      } catch {
        // socket may already be gone
      }
      socket.destroy()
    }
  })

  server.on('close', () => {
    clearInterval(heartbeat)
  })

  return server
}

/** Tell every socket on a game that its seats changed (name claim). Zero entries: a no-op for the journal. */
export function broadcastSeats(api: Api, gameId: string): void {
  const length = api.gate.resultOf(gameId)?.state.journal.length ?? 0
  api.gate.broadcast(gameId, { from: length, entries: [], seats: publicSeats(api.store, gameId) })
}
