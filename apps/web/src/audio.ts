/**
 * The background music.
 *
 * One looping `<audio>` element, created on first use and never replaced — a single long track
 * needs no mixer, and the browser's own media element gives us streaming, looping and a volume
 * control for free.
 *
 * **The autoplay problem is the whole design.** Every browser refuses `play()` until the page has
 * seen a user gesture, and refuses it as a *rejected promise* rather than an error you can test
 * for beforehand. So the sequence is: try to play, and if that is refused, arm a one-shot
 * `pointerdown`/`keydown` listener and try again from inside the gesture. The listeners remove
 * themselves the moment playback starts, so the cost of the mechanism is one attempt and at most
 * one extra call — and a browser that never blocked us never installs them at all. A refusal is
 * swallowed: music that has not started yet is not an error, and an unhandled rejection in the
 * console would say otherwise.
 *
 * Volume and the mute live in `settings.ts`; this module subscribes and follows. Muting pauses
 * rather than zeroing the volume, so a muted tab is not also a tab quietly streaming 3 MB.
 */

import { asset } from './assets.js'
import { getSettings, subscribe } from './settings.js'

const TRACK = 'audio/halo.mp3'

let el: HTMLAudioElement | null = null
/** Installed only if the browser actually refused us; see the note above. */
let waitingForGesture = false

function element(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (el === null) {
    el = new Audio(asset(TRACK))
    el.loop = true
    // The track is the only thing this app streams; letting it buffer ahead avoids a gap at the
    // loop point on a slow connection.
    el.preload = 'auto'
  }
  return el
}

function onGesture(): void {
  removeGestureListeners()
  void tryPlay()
}

function addGestureListeners(): void {
  if (waitingForGesture || typeof window === 'undefined') return
  waitingForGesture = true
  window.addEventListener('pointerdown', onGesture)
  window.addEventListener('keydown', onGesture)
}

function removeGestureListeners(): void {
  if (!waitingForGesture || typeof window === 'undefined') return
  waitingForGesture = false
  window.removeEventListener('pointerdown', onGesture)
  window.removeEventListener('keydown', onGesture)
}

async function tryPlay(): Promise<void> {
  const audio = element()
  if (audio === null) return
  try {
    await audio.play()
  } catch {
    // Blocked, or the settings changed under us and something already paused it. Either way the
    // next gesture is the cheapest possible retry.
    if (getSettings().musicEnabled) addGestureListeners()
  }
}

/** Push the current settings onto the element: volume always, playing state if it changed. */
function apply(): void {
  const audio = element()
  if (audio === null) return
  const { musicEnabled, musicVolume } = getSettings()
  audio.volume = musicVolume
  if (musicEnabled) {
    if (audio.paused) void tryPlay()
  } else {
    removeGestureListeners()
    audio.pause()
  }
}

/**
 * Start the music and keep it in step with the settings. Returns the teardown, so it drops
 * straight into a `useEffect` — React's development double-mount then costs one pause and one
 * `play()`, not a second element.
 */
export function initAudio(): () => void {
  apply()
  const off = subscribe(apply)
  return () => {
    off()
    removeGestureListeners()
    el?.pause()
  }
}

/**
 * The sound-effect volume, for whatever first plays one. Nothing in the app does yet — the slider
 * exists so the preference is already recorded and honoured when something does.
 */
export function sfxVolume(): number {
  return getSettings().sfxVolume
}
