import { describe, expect, it } from 'vitest'

import { b2Stats } from './lab-data.js'

const sel = (seed: number, rule: number): string => JSON.stringify({ key: `${seed}:1`, seed, idx: 1, candidates: ['a', 'b'], wins: [[0], [1]], margins: [[0], [0]], rule, z: rule === 0 ? 0 : 1.2 })
const ev = (seed: number, hard: number[], rule: number[]): string => JSON.stringify({ key: `${seed}:1`, seed, hard, rule })

describe('b2Stats', () => {
  it('counts selections, flips and evaluated flips', () => {
    const s = b2Stats([sel(1, 0), sel(2, 1), sel(3, 1)], [ev(2, [0, 0, 1, 0], [1, 1, 1, 0])], 150)
    expect(s.selected).toBe(3)
    expect(s.flips).toBe(2)
    expect(s.evaluated).toBe(1)
    expect(s.target).toBe(150)
  })

  it('scores a decision whose flip is not yet evaluated as unscored, and keeps held-out gains', () => {
    const s = b2Stats([sel(1, 0), sel(2, 1)], [ev(2, [0, 0, 0, 0], [1, 1, 0, 0])], 150)
    // Two scored decisions: 0 (kept hard) and +0.5 (the flip won half its held-out games more).
    expect(s.scored).toBe(2)
    expect(s.mean).toBeCloseTo(0.25, 9)
    expect(s.falseFlips).toBe(0)
    expect(s.trajectory.length).toBe(2)
  })

  it('is empty-safe', () => {
    const s = b2Stats([], [], 150)
    expect(s.selected).toBe(0)
    expect(s.mean).toBe(0)
    expect(s.trajectory).toEqual([])
  })
})

describe('lab page', () => {
  it('renders progress, the verdict table and escapes runner text', async () => {
    const { render } = await import('./lab-ui.js')
    const b2 = b2Stats([sel(1, 0), sel(2, 1)], [ev(2, [0, 0, 0, 0], [1, 1, 0, 0])], 150)
    const html = render(b2, [{ id: 'C1a', idea: 'Ships', against: 'hard', probe: 'ok', verdict: 'pass' }], { alive: true, last: '<script>x</script>' })
    expect(html).toContain('2/150')
    expect(html).toContain('✓ pass')
    expect(html).not.toContain('<script>x</script>')
  })
})
