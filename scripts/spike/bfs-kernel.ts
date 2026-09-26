/**
 * `positionalUncached` (packages/engine/src/ai/value.ts) as a pure function of pre-extracted
 * inputs — the same steps on the same shapes (string ids, Set/Map lookups, array `includes`), with
 * the cached lookups it makes (`figuresOf`, `colorsIn`, `planetResource`, `connectedSystems`,
 * `systemInfo().isGate`) replaced by the tables they would return. Checked equal to the engine
 * function on every recorded input (bfs-record.ts). The Rust port is spike/rust/src/bfs.rs.
 */
export interface BfsBoard {
  readonly systems: readonly string[]
  readonly gate: ReadonlyMap<string, boolean>
  readonly adj: ReadonlyMap<string, readonly string[]>
}
export interface BfsInput {
  readonly board: BfsBoard
  readonly self: string
  readonly ships: readonly { readonly id: string; readonly system: string }[]
  readonly damaged: readonly string[]
  /** Systems of self's cities then starports, as `figuresOf` returns them. */
  readonly built: readonly string[]
  readonly colors: ReadonlyMap<string, ReadonlySet<string>>
  /** `planetResource(observed, s) !== undefined`. */
  readonly resource: ReadonlyMap<string, boolean>
}

const EMPTY: ReadonlySet<string> = new Set()

export function positional(x: BfsInput): { gatesHeld: number; fleetThreat: number } {
  const systems = x.board.systems
  const freshShips = x.ships.filter((p) => !x.damaged.includes(p.id))
  const shipStands = new Set<string>(freshShips.map((p) => p.system))
  const gatesHeld = [...shipStands].filter((s) => x.board.gate.get(s) === true).length
  const built = new Set<string>(x.built)

  const dist = new Map<string, number>()
  for (const s of systems) {
    const colors = x.colors.get(s) ?? EMPTY
    const rival = colors.size > (colors.has(x.self) ? 1 : 0)
    const unexploited = x.resource.get(s) === true && !built.has(s)
    if (rival || unexploited) dist.set(s, 0)
  }
  let frontier = [...dist.keys()]
  for (let d = 1; d <= 2; d++) {
    const next: string[] = []
    for (const s of frontier) {
      for (const n of x.board.adj.get(s)!) {
        if (!dist.has(n)) {
          dist.set(n, d)
          next.push(n)
        }
      }
    }
    frontier = next
  }
  let threat = 0
  for (const p of freshShips) threat += 3 - (dist.get(p.system) ?? 3)
  return { gatesHeld, fleetThreat: threat }
}
