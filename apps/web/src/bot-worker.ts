/**
 * The browser's bot-thinking worker (`workerThink` in store.ts), so a slow `hard` decision runs off
 * the page's main thread. One `createThinker` for the worker's life keeps the game's last position,
 * so a step replays only the new journal entries.
 */
import { createThinker } from '@arcs/engine'
import type { ThinkRequest } from '@arcs/engine'

// The web tsconfig is a DOM project; a worker's global is narrower, and this is all it uses.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; req: ThinkRequest }>) => void) | null
  postMessage(message: unknown): void
}

const think = createThinker()

scope.onmessage = (e) => {
  const { id, req } = e.data
  try {
    scope.postMessage({ id, reply: think(req) })
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
