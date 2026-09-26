/**
 * The phone layout's map: a scrolling window onto a map drawn larger than the screen.
 *
 * At a phone's width the whole map is ~390px across and a system's hit circle ~25px — too small
 * to tap reliably. So the map is drawn at a zoom and the window scrolls over it: one finger pans
 * (the browser's own scrolling), two fingers pinch, and the corner buttons step the zoom.
 *
 * Zoom sets the *size* of the box the map is drawn in, never a CSS transform. Board measures its
 * SVG with a ResizeObserver to size the chrome it draws in map units (`unitsPerPx`), and hit
 * testing follows real layout — a transform would leave both measuring the unzoomed map.
 *
 * Zoom 1 is the whole map fitted to the window. It starts at `START_ZOOM` (or less, if that would
 * already overfill the height), which on an upright phone leaves a pan both ways.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { MAP_SIZE } from '@arcs/engine'

const ASPECT = MAP_SIZE.width / MAP_SIZE.height
const MAX_ZOOM = 3.2
const START_ZOOM = 2

interface Size {
  w: number
  h: number
}

interface Props {
  children: ReactNode
  /**
   * Changes whenever a new decision arrives. If the map is then asking for a pick, the window
   * frames the choices — scrolled to them, and zoomed out if they do not all fit — so a target is
   * never off-screen without the player knowing to look for it.
   */
  focusKey?: string
}

export function MapZoom({ children, focusKey }: Props): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<Size | null>(null)
  /** Null until the first measure picks the starting zoom. */
  const [zoom, setZoom] = useState<number | null>(null)
  /** Where the zoom should keep still, in the scroller's own pixels; consumed after layout. */
  const anchor = useRef<{ x: number; y: number; from: number } | null>(null)

  useEffect(() => {
    const el = scroller.current
    if (el === null) return
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) setFrame({ w: width, h: height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fitW = frame === null ? 0 : Math.min(frame.w, frame.h * ASPECT)
  const fill = frame === null ? 1 : Math.max(1, (frame.h * ASPECT) / fitW)
  // Filling a tall window's height is ~2.3× on a phone — too close to see the table. This is
  // enough to make a system a comfortable tap while most of the map stays in view.
  const z = zoom ?? Math.min(fill, START_ZOOM)
  const boxW = fitW * z
  const boxH = boxW / ASPECT

  // First measure: start centred on the map rather than at its left edge.
  const centred = useRef(false)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el === null || frame === null || centred.current) return
    centred.current = true
    // Fixed from here on: the map must not rescale under the player as the dock grows and shrinks.
    setZoom(z)
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2
  }, [frame])

  // After a zoom, scroll so the anchored point is under the same spot of the window.
  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (el === null || a === null) return
    anchor.current = null
    const k = z / a.from
    el.scrollLeft = (el.scrollLeft + a.x) * k - a.x
    el.scrollTop = (el.scrollTop + a.y) * k - a.y
  }, [z])

  // Frame the targets of a new pick. A frame later, so Board has drawn them.
  const [framing, setFraming] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  )
  useEffect(() => {
    if (focusKey === undefined) return
    const raf = requestAnimationFrame(() => {
      const el = scroller.current
      if (el === null) return
      const hits = [...el.querySelectorAll('.sys-hit')].map((h) => h.getBoundingClientRect())
      if (hits.length === 0) return
      const box = el.getBoundingClientRect()
      const left = Math.min(...hits.map((r) => r.left)) - box.left + el.scrollLeft
      const top = Math.min(...hits.map((r) => r.top)) - box.top + el.scrollTop
      const right = Math.max(...hits.map((r) => r.right)) - box.left + el.scrollLeft
      const bottom = Math.max(...hits.map((r) => r.bottom)) - box.top + el.scrollTop
      setFraming({ x: left, y: top, w: right - left, h: bottom - top })
    })
    return () => cancelAnimationFrame(raf)
    // Only a new decision reframes; the player's own panning is left alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el === null || framing === null) return
    // The hint bar floats over the map's foot; frame the targets in the part above it.
    const hint = el.parentElement?.querySelector<HTMLElement>('.board-hint')
    const vw = el.clientWidth
    const vh = el.clientHeight - (hint === null || hint === undefined ? 0 : hint.offsetHeight + 12)
    // Everything already on screen: leave the view exactly where the player had it.
    const inView =
      framing.x >= el.scrollLeft &&
      framing.y >= el.scrollTop &&
      framing.x + framing.w <= el.scrollLeft + vw &&
      framing.y + framing.h <= el.scrollTop + vh
    if (inView) {
      setFraming(null)
      return
    }
    const fits = Math.min(1, (vw - 16) / framing.w, (vh - 16) / framing.h)
    const next = Math.max(1, z * fits)
    if (next < z - 0.01) {
      // Zoom out first; the framing is in the old zoom's pixels, so rescale it and run again.
      const k = next / z
      setFraming({ x: framing.x * k, y: framing.y * k, w: framing.w * k, h: framing.h * k })
      setZoom(next)
      return
    }
    el.scrollLeft = framing.x + framing.w / 2 - vw / 2
    el.scrollTop = framing.y + framing.h / 2 - vh / 2
    setFraming(null)
  }, [framing, z])

  function zoomTo(next: number, at?: { x: number; y: number }): void {
    const el = scroller.current
    if (el === null) return
    const clamped = Math.min(MAX_ZOOM, Math.max(1, next))
    if (clamped === z) return
    anchor.current = { ...(at ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 }), from: z }
    setZoom(clamped)
  }

  /*
   * Two-finger pinch. One finger is left to the browser, which scrolls.
   *
   * Native touch listeners, not React's: React attaches `touchmove` passively, so it cannot stop
   * the browser claiming a two-finger gesture. And touch events rather than pointer events, because
   * the browser cancels a pointer that has started scrolling — a pinch whose first finger moved
   * before the second landed, which is most real pinches, lost its first finger and never zoomed.
   */
  const live = useRef({ z, zoomTo })
  live.current = { z, zoomTo }
  useEffect(() => {
    const el = scroller.current
    if (el === null) return
    let start: { dist: number; zoom: number } | null = null
    const spread = (t: TouchList): { dist: number; mid: { x: number; y: number } } => {
      const a = t[0]!
      const b = t[1]!
      const rect = el.getBoundingClientRect()
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        mid: {
          x: (a.clientX + b.clientX) / 2 - rect.left,
          y: (a.clientY + b.clientY) / 2 - rect.top,
        },
      }
    }
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) return
      start = { dist: spread(e.touches).dist, zoom: live.current.z }
      if (e.cancelable) e.preventDefault()
    }
    const onMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || start === null || start.dist === 0) return
      if (e.cancelable) e.preventDefault()
      const s = spread(e.touches)
      live.current.zoomTo(start.zoom * (s.dist / start.dist), s.mid)
    }
    const onEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) start = null
    }
    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return (
    <div className="mz">
      <div ref={scroller} className="mz-scroll">
        {frame === null ? null : (
          <div className="mz-box" style={{ width: boxW, height: boxH }}>
            {children}
          </div>
        )}
      </div>
      <div className="mz-tools">
        <button aria-label="Zoom in" onClick={() => zoomTo(z * 1.35)} disabled={z >= MAX_ZOOM}>
          +
        </button>
        <button aria-label="Zoom out" onClick={() => zoomTo(z / 1.35)} disabled={z <= 1}>
          −
        </button>
        <button
          aria-label={z === 1 ? 'Fill the height' : 'Whole map'}
          onClick={() => zoomTo(z === 1 ? fill : 1)}
        >
          {z === 1 ? '⤢' : '⤡'}
        </button>
      </div>
    </div>
  )
}
