/**
 * In-memory tracking of which seats have a live socket and whether that socket has seen recent
 * activity. Purely in-process bookkeeping: it never touches the store and loses all state on
 * restart, which is fine since the notifier only uses it to decide whether to defer a Discord
 * ping.
 */
export interface PresenceOptions {
  readonly now?: () => number
  /** Milliseconds of no activity before a connected seat counts as inactive. Default 120000. */
  readonly activeMs?: number
}

export type LeaveListener = (gameId: string, seatToken: string) => void

export interface Socket {
  send(data: string): void
  readonly readyState: number
  readonly OPEN: number
}

interface SeatEntry {
  sockets: Set<Socket>
  lastActive: number
}

export class Presence {
  private readonly now: () => number
  private readonly activeMs: number
  private readonly games = new Map<string, Map<string, SeatEntry>>()
  private readonly leaveListeners: LeaveListener[] = []

  constructor(opts: PresenceOptions = {}) {
    this.now = opts.now ?? Date.now
    this.activeMs = opts.activeMs ?? 120_000
  }

  connect(gameId: string, seatToken: string, socket: Socket): () => void {
    const entry = this.entryFor(gameId, seatToken)
    entry.sockets.add(socket)
    entry.lastActive = this.now()
    let unregistered = false
    return () => {
      if (unregistered) return
      unregistered = true
      const seats = this.games.get(gameId)
      const e = seats?.get(seatToken)
      if (e === undefined) return
      e.sockets.delete(socket)
      if (e.sockets.size === 0) {
        seats!.delete(seatToken)
        if (seats!.size === 0) this.games.delete(gameId)
        for (const listener of this.leaveListeners) listener(gameId, seatToken)
      }
    }
  }

  touch(gameId: string, seatToken: string): void {
    const entry = this.games.get(gameId)?.get(seatToken)
    if (entry === undefined) return
    entry.lastActive = this.now()
  }

  isActive(gameId: string, seatToken: string): boolean {
    const entry = this.games.get(gameId)?.get(seatToken)
    if (entry === undefined || entry.sockets.size === 0) return false
    return this.now() - entry.lastActive < this.activeMs
  }

  send(gameId: string, seatToken: string, payload: unknown): number {
    const entry = this.games.get(gameId)?.get(seatToken)
    if (entry === undefined) return 0
    const data = JSON.stringify(payload)
    let sent = 0
    for (const socket of entry.sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(data)
        sent += 1
      }
    }
    return sent
  }

  onLeave(listener: LeaveListener): void {
    this.leaveListeners.push(listener)
  }

  private entryFor(gameId: string, seatToken: string): SeatEntry {
    let seats = this.games.get(gameId)
    if (seats === undefined) {
      seats = new Map()
      this.games.set(gameId, seats)
    }
    let entry = seats.get(seatToken)
    if (entry === undefined) {
      entry = { sockets: new Set(), lastActive: this.now() }
      seats.set(seatToken, entry)
    }
    return entry
  }
}
