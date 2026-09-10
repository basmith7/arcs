/**
 * The channel between a log row and the map.
 *
 * Small enough to look untestable, and it is not: its whole contract is the one that
 * `useSyncExternalStore` cares about and that a casual implementation gets wrong. The snapshot is
 * compared by *identity*, so re-pointing at the same systems — which happens on every mouse move
 * that crosses a span inside a row already hovered — must return the same array, or the board
 * re-renders continuously while the pointer sits still.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearHover, hoverSystems, hoveredSystems, subscribe } from '../src/log-hover.js'

afterEach(() => clearHover())

describe('log hover', () => {
  it('starts pointing at nothing', () => {
    expect(hoveredSystems()).toEqual([])
  })

  it('holds what it was pointed at', () => {
    hoverSystems(['1-Hex', '2-Arrow'])
    expect(hoveredSystems()).toEqual(['1-Hex', '2-Arrow'])
  })

  it('keeps the same snapshot when pointed at the same systems again', () => {
    hoverSystems(['1-Hex'])
    const first = hoveredSystems()
    hoverSystems(['1-Hex'])
    expect(hoveredSystems()).toBe(first)
  })

  it('does not notify when nothing changed, so a still pointer costs no renders', () => {
    hoverSystems(['1-Hex'])
    const seen = vi.fn()
    const off = subscribe(seen)
    hoverSystems(['1-Hex'])
    expect(seen).not.toHaveBeenCalled()
    hoverSystems(['1-Hex', '2-Hex'])
    expect(seen).toHaveBeenCalledTimes(1)
    off()
    // Unsubscribed listeners stop hearing, or the map would keep re-rendering after unmount.
    hoverSystems([])
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('clears back to the shared empty snapshot, not a fresh empty array', () => {
    hoverSystems(['1-Hex'])
    clearHover()
    const empty = hoveredSystems()
    hoverSystems(['2-Hex'])
    clearHover()
    expect(hoveredSystems()).toBe(empty)
  })

  it('copies what it is given, so a caller mutating its list cannot move the map', () => {
    const mine = ['1-Hex']
    hoverSystems(mine)
    mine.push('2-Hex')
    expect(hoveredSystems()).toEqual(['1-Hex'])
  })
})
