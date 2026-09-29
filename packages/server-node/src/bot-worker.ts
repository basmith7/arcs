/**
 * The bot-thinking worker (`thinker.ts`). Its own esbuild entry, so it ships as `bot-worker.js` next
 * to `main.js`. One `createThinker` for the worker's life keeps each game's last position, so a step
 * replays only the new journal entries.
 */
import { parentPort } from 'node:worker_threads'

import { createThinker } from '@arcs/engine'
import type { ThinkRequest } from '@arcs/engine'

import type { WorkerReply } from './thinker.js'

const think = createThinker()
const port = parentPort
if (port === null) throw new Error('bot-worker.ts runs as a worker thread only')

port.on('message', ({ id, req }: { id: number; req: ThinkRequest }) => {
  let out: WorkerReply
  try {
    out = { id, reply: think(req) }
  } catch (e) {
    out = { id, error: e instanceof Error ? e.message : String(e) }
  }
  port.postMessage(out)
})
