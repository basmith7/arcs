/**
 * Phones get the desktop table, shrunk to fit and pinch-zoomed.
 *
 * The game screen is laid out for a table-sized window; below ~900px it folds rails away, and at a
 * phone's 400px it is unusable. Rather than a second layout, a phone renders the desktop one on a
 * fixed-size canvas: the viewport meta tag claims a desktop width, the browser scales that down to
 * the screen, and the player pinches and pans the way they would a PDF. The title screen is
 * already a single column that fits a phone, so it keeps the native viewport — this only applies
 * while a game is on screen.
 *
 * Upright, the phone layout (`phone.css`) is the default and this stands aside; the Settings
 * choice "Zoomable desktop" puts the canvas back. Sideways, it is always the canvas.
 *
 * Landscape: the viewport is widened until its height reaches `MIN_H`, so the canvas is the whole
 * layout viewport and `100vh` stays honest. Portrait cannot get there — a tall screen at a desktop
 * width is taller still — so the canvas is a fixed `PORTRAIT_H` band at the top of the page and
 * `--vh` carries its height to the rules in styles.css that size things off the viewport.
 */

import type { PhoneLayout } from './settings.js'

const MIN_W = 1280
const MIN_H = 720
const PORTRAIT_H = 800
const NATIVE = 'width=device-width, initial-scale=1.0'

/** A touch screen whose short side is phone-sized. Tablets keep the responsive layout. */
function isPhone(): boolean {
  return (
    window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600
  )
}

function viewportMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="viewport"]')
}

function apply(layout: PhoneLayout): void {
  const portrait = window.matchMedia('(orientation: portrait)').matches
  if (portrait && layout === 'mobile') {
    restore()
    return
  }
  const root = document.documentElement
  const meta = viewportMeta()
  // The window's shape, not the screen's: the browser's own bars come out of the height. The
  // ratio survives a viewport change, so this is right on a re-run after rotating, too.
  const aspect = window.innerWidth / window.innerHeight
  // Chrome keeps the scale it had when the tag changes after load, so the fit-to-screen scale is
  // spelled out. `across` is the window's width in device-independent pixels whatever the tag
  // currently says: a layout width times the scale it is drawn at.
  const vv = window.visualViewport
  const across = vv === null ? window.innerWidth : vv.width * vv.scale
  const fit = (width: number): string =>
    `width=${width}, initial-scale=${(across / width).toFixed(4)}`
  if (portrait) {
    meta?.setAttribute('content', fit(MIN_W))
    root.classList.add('phone-canvas', 'phone-portrait')
    root.style.setProperty('--vh', `${PORTRAIT_H / 100}px`)
  } else {
    const width = Math.max(MIN_W, Math.ceil(MIN_H * aspect))
    meta?.setAttribute('content', fit(width))
    root.classList.add('phone-canvas')
    root.classList.remove('phone-portrait')
    root.style.removeProperty('--vh')
  }
  // The title screen is scrolled to its Start button when the game begins.
  window.scrollTo(0, 0)
}

function restore(): void {
  const root = document.documentElement
  viewportMeta()?.setAttribute('content', NATIVE)
  root.classList.remove('phone-canvas', 'phone-portrait')
  root.style.removeProperty('--vh')
}

/**
 * Put the game on the canvas when this phone's orientation and `layout` call for it, and keep it
 * right across rotations; the returned function puts the native viewport back.
 */
export function enterPhoneCanvas(layout: PhoneLayout): () => void {
  if (!isPhone()) return () => {}
  const onRotate = (): void => apply(layout)
  onRotate()
  const orientation = window.matchMedia('(orientation: portrait)')
  orientation.addEventListener('change', onRotate)
  return () => {
    orientation.removeEventListener('change', onRotate)
    restore()
  }
}
