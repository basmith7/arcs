/**
 * The declare hint (Board's hint bar while the ambition track is the surface) must carry the ask's
 * way out. Populist Demands declares through `vox/populist` and declines with `vox/done`; the hint
 * used to recognise only the ordinary declare and Galactic Bards, so the rows lit up and there was
 * no button to decline.
 */
import { describe, expect, it } from 'vitest'

import type { Action, Continue } from '@arcs/engine'

import { declareHint } from '../src/surfaces.js'

const ask = (actions: Action[]): Continue => ({ kind: 'ask', faction: 'red', actions }) as Continue

describe('declareHint', () => {
  it('offers Populist Demands’ skip', () => {
    const skip: Action = { type: 'vox/done', faction: 'red', card: 'bc27', label: 'Skip' }
    const hint = declareHint(
      ask([{ type: 'vox/populist', faction: 'red', ambition: 'Tycoon', card: 'bc27', label: 'Declare Tycoon' }, skip]),
    )
    expect(hint?.out).toBe(skip)
  })

  it('still offers the ordinary and the Bards declines', () => {
    const plain: Action = { type: 'ambition/skip-declare', faction: 'red' }
    expect(declareHint(ask([{ type: 'ambition/declare', faction: 'red', ambition: 'Tycoon' }, plain]))?.out).toBe(plain)
    const bards: Action = { type: 'turn/bards-skip', faction: 'red' }
    expect(declareHint(ask([{ type: 'turn/bards-declare', faction: 'red', ambition: 'Tycoon' }, bards]))?.out).toBe(bards)
  })

  it('is not a declare ask otherwise, even with a vox/done on offer', () => {
    expect(declareHint(ask([{ type: 'vox/done', faction: 'red', card: 'bc20' }]))).toBeUndefined()
    expect(declareHint({ kind: 'then' } as unknown as Continue)).toBeUndefined()
  })
})
