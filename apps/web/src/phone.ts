/**
 * Whether the game screen uses the phone layout (`phone.css`, docs/superpowers/specs
 * 2026-09-26-phone-layout-design.md).
 *
 * A width test rather than a device test: any window narrower than `PHONE_MAX` gets it, touch or
 * not, which is also what lets it be built and checked in a desktop browser. A phone on the
 * zoomable canvas (`phone-canvas.ts`) reports the canvas's 1280px width and so, correctly, does
 * not.
 */

import { useSyncExternalStore } from 'react'

const PHONE_MAX = 599
const QUERY = `(max-width: ${PHONE_MAX}px)`

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

function narrow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches
}

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, narrow, () => false)
}

/** The sheets the phone layout's tab bar opens over the map. */
export type Sheet = 'court' | 'ambitions' | 'boards' | 'log'
