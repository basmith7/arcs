/**
 * The board's structure, drawn over the dimmed map art.
 *
 * The dim is a contrast curve rather than a fade (see `settings.ts`), so nearly everything the
 * player needs survives it: the planets keep their outlines, the resource symbols, sector numbers
 * and gate slot markers are all bright line art printed over the fills the curve crushes. This
 * layer therefore draws *only* what the art cannot say for itself once its colour is gone — where
 * one system ends and the next begins, and which of those seams you may travel through.
 *
 * That distinction is the whole point. On the printed board the wedges of a cluster touch, and so
 * do the two special cross-cluster links (5-Hex/6-Arrow and 2-Hex/3-Arrow); the four other cluster
 * seams are drawn as wide dark lanes, and the lane means "not adjacent". So an adjacent pair gets
 * one shared line and a non-adjacent pair gets the pair of lines with the lane between them. The
 * gate ring gets the same treatment: an arc per in-play gate, and its gaps — where the ring joins
 * gate to gate — marked as passages *along* the ring rather than walls across it. Those links come
 * from the live board's adjacency, not from the printed angles, because at a player count that
 * drops a cluster the ring reroutes around it, and today only the gold arrow baked into the
 * `map-out-N` art says so.
 *
 * Geometry is `BOARD_GEOMETRY`, derived offline from the region bitmap by
 * scripts/build_board_geometry.py; scripts/preview_board_structure.py renders the same thing with
 * PIL, which is how a dim level gets looked at without a browser.
 */

import { BOARD_GEOMETRY, MAP_SIZE, system as systemInfo } from '@arcs/engine'
import type { GameState, SystemId } from '@arcs/engine'

const [CX, CY] = BOARD_GEOMETRY.centre
const { core, ring } = BOARD_GEOMETRY.radii

/** How far a gate-link arc reaches past the gap it marks, in degrees. */
const LINK_OVERLAP = 1.5

function at(angle: number, r: number): [number, number] {
  const t = (angle * Math.PI) / 180
  return [CX + Math.cos(t) * r, CY + Math.sin(t) * r]
}

/** Where a ray from the ring centre leaves the map rectangle — how far a divider is drawn. */
function toEdge(angle: number): [number, number] {
  const t = (angle * Math.PI) / 180
  const dx = Math.cos(t)
  const dy = Math.sin(t)
  const ks: number[] = []
  if (Math.abs(dx) > 1e-9) ks.push(((dx > 0 ? MAP_SIZE.width : 0) - CX) / dx)
  if (Math.abs(dy) > 1e-9) ks.push(((dy > 0 ? MAP_SIZE.height : 0) - CY) / dy)
  const k = Math.min(...ks.filter((v) => v > 0))
  return [CX + dx * k, CY + dy * k]
}

/** An arc path sweeping clockwise from `from` to `to` at radius `r`. */
function arcPath(r: number, from: number, to: number): string {
  const sweep = ((to - from) % 360 + 360) % 360
  const [x0, y0] = at(from, r)
  const [x1, y1] = at(from + sweep, r)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

function clusterOf(id: SystemId): number {
  return systemInfo(id).cluster
}

export function BoardStructure({ state, dim }: { state: GameState; dim: number }): JSX.Element | null {
  if (dim <= 0) return null
  const inPlay = new Set(state.board.clusters)
  const live = (id: SystemId): boolean => inPlay.has(clusterOf(id))
  const adjacent = (a: SystemId, b: SystemId): boolean =>
    (state.board.adjacency.get(a) ?? []).includes(b)
  const arcOf = (id: SystemId): readonly [number, number] | null => systemInfo(id).render.arc

  const lines: JSX.Element[] = []

  // Wedge edges. Adjacent spans meet at the divider and share one line; non-adjacent ones stop
  // short of it, and the pair of lines with the lane between them is the printed dead seam.
  for (const div of BOARD_GEOMETRY.dividers.planet) {
    if (!live(div.a) || !live(div.b)) continue
    const linked = adjacent(div.a, div.b)
    const ends: [SystemId, 0 | 1][] = [
      [div.a, 1],
      [div.b, 0],
    ]
    for (const [id, end] of ends) {
      const arc = arcOf(id)
      if (arc === null) continue
      const [x0, y0] = at(arc[end], ring)
      const [x1, y1] = toEdge(arc[end])
      lines.push(
        <line
          key={`div-${id}-${end}`}
          className={linked ? 'bs-line' : 'bs-lane'}
          x1={x0}
          y1={y0}
          x2={x1}
          y2={y1}
        />,
      )
      // An adjacent pair's two ends are the same angle: one line, drawn once.
      if (linked) break
    }
  }

  // The ring, one arc per in-play gate at each shell, so the joins between them stay open.
  const gates = [...state.board.adjacency.keys()].filter((id) => id.endsWith('-Gate') && id !== '7-Gate')
  for (const id of gates) {
    const arc = arcOf(id)
    if (arc === null) continue
    for (const r of [core, ring]) {
      lines.push(<path key={`ring-${id}-${r}`} className="bs-line" d={arcPath(r, arc[0], arc[1])} />)
    }
  }

  // The joins themselves: a starport's catapult runs along this ring, so each link is drawn as a
  // passage through the gap. Taken from live adjacency, which already routes past a missing cluster.
  const seen = new Set<string>()
  for (const a of gates) {
    for (const b of state.board.adjacency.get(a) ?? []) {
      if (!gates.includes(b) || seen.has(`${b}|${a}`)) continue
      seen.add(`${a}|${b}`)
      const [ga, gb] = [arcOf(a), arcOf(b)]
      if (ga === null || gb === null) continue
      // Whichever way round the ring the two are actually neighbours: the shorter gap.
      const fwd = ((gb[0] - ga[1]) % 360 + 360) % 360
      const back = ((ga[0] - gb[1]) % 360 + 360) % 360
      const [from, span] = fwd <= back ? [ga[1], fwd] : [gb[1], back]
      lines.push(
        <path
          key={`link-${a}-${b}`}
          className="bs-link"
          d={arcPath((core + ring) / 2, from - LINK_OVERLAP, from + span + LINK_OVERLAP)}
        />,
      )
    }
  }

  // Fades in a little ahead of the art fading out, so the lines are there by the time the seams go.
  return (
    <g className="board-structure" style={{ opacity: Math.min(1, dim * 1.3) }}>
      {lines}
    </g>
  )
}
