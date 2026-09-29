import { existsSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { shardCommand } from './shard-runner.js'

describe('shardCommand', () => {
  it('builds the shard to plain JavaScript and runs it with node', () => {
    const [cmd, args] = shardCommand('arena-shard')
    expect(cmd).toBe('node')
    expect(args[0]).toBe('dist-lab/arena-shard.mjs')
    expect(existsSync('dist-lab/arena-shard.mjs')).toBe(true)
    // Built from the current source: never older than the shard script itself.
    expect(statSync('dist-lab/arena-shard.mjs').mtimeMs).toBeGreaterThanOrEqual(statSync('scripts/arena-shard.ts').mtimeMs)
  }, 60_000)

  it('falls back to vite-node when LAB_NO_COMPILE is set', () => {
    process.env['LAB_NO_COMPILE'] = '1'
    try {
      expect(shardCommand('tally-shard')).toEqual(['npx', ['vite-node', 'scripts/tally-shard.ts']])
    } finally {
      delete process.env['LAB_NO_COMPILE']
    }
  })
})
