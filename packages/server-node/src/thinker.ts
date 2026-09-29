/**
 * Where the gate's bots think.
 *
 * A `hard` card play can take several seconds, and the gate used to decide on the main thread —
 * so while one game's bot thought, every other game, socket and HTTP request on the server waited.
 * `WorkerThinker` moves the thinking to a `worker_threads` worker (`bot-worker.ts`); the gate only
 * applies the answer. `localThink` is the in-process version: the tests' default, and the fallback
 * whenever the worker cannot answer, so a broken worker costs responsiveness, never a stuck game.
 */
import { Worker } from 'node:worker_threads'

import { createThinker } from '@arcs/engine'
import type { RuleRegistry, ThinkReply, ThinkRequest } from '@arcs/engine'

export type Think = (req: ThinkRequest) => Promise<ThinkReply>

export function localThink(registry?: RuleRegistry): Think {
  const think = createThinker(registry)
  return (req) => Promise.resolve(think(req))
}

/** What the worker posts back for request `id`. */
export type WorkerReply = { readonly id: number; readonly reply: ThinkReply } | { readonly id: number; readonly error: string }

interface Pending {
  readonly req: ThinkRequest
  readonly resolve: (r: ThinkReply) => void
  readonly reject: (e: unknown) => void
}

/**
 * One worker, spawned on first use and again after it dies. Requests queue in the worker, so two
 * games' bots take turns thinking — the server stays responsive, which is the point; parallel
 * thinking would be a pool, and four live games do not need one.
 */
export class WorkerThinker {
  private worker: Worker | undefined
  /** A worker died before answering anything: it cannot start here, so stop trying (and logging). */
  private broken = false
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private counts = { worker: 0, fallback: 0 }

  constructor(
    private readonly url: URL,
    private readonly fallback: Think,
  ) {}

  readonly think: Think = (req) =>
    new Promise<ThinkReply>((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { req, resolve, reject })
      if (this.broken) return this.fallBack(id, undefined)
      try {
        this.spawned().postMessage({ id, req })
      } catch (e) {
        this.fallBack(id, e)
      }
    })

  /** How many decisions each path answered — for the tests. */
  stats(): { worker: number; fallback: number } {
    return { ...this.counts }
  }

  async close(): Promise<void> {
    const w = this.worker
    this.worker = undefined
    if (w !== undefined) await w.terminate()
  }

  private spawned(): Worker {
    if (this.worker !== undefined) return this.worker
    const w = new Worker(this.url)
    let answered = false
    // A long-running server exits on its own signals; an idle worker must not hold it open.
    w.unref()
    w.on('message', (m: WorkerReply) => {
      answered = true
      if ('reply' in m) {
        const p = this.pending.get(m.id)
        if (p === undefined) return
        this.pending.delete(m.id)
        this.counts.worker++
        p.resolve(m.reply)
      } else {
        this.fallBack(m.id, m.error)
      }
    })
    const lost = (why: unknown): void => {
      if (this.worker !== w) return
      this.worker = undefined
      if (!answered) {
        this.broken = true
        console.error('[thinker] the bot worker cannot start; bots think on the main thread from now on:', String(why))
      }
      for (const id of [...this.pending.keys()]) this.fallBack(id, why)
    }
    w.on('error', lost)
    w.on('exit', (code) => lost(`worker exited (${code})`))
    this.worker = w
    return w
  }

  private fallBack(id: number, why: unknown): void {
    const p = this.pending.get(id)
    if (p === undefined) return
    this.pending.delete(id)
    this.counts.fallback++
    if (why !== undefined && !this.broken) {
      console.warn('[thinker] thinking in-process:', why instanceof Error ? why.message : String(why))
    }
    // Deferred and caught: a bot that throws in the worker usually throws here too, and that must
    // reject this think (the gate logs it) rather than escape a worker event handler.
    Promise.resolve()
      .then(() => this.fallback(p.req))
      .then(p.resolve, p.reject)
  }
}
