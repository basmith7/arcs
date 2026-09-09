import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// Vite 5 does not know `node:sqlite` as a builtin, so it is reached through `createRequire`
// (same trick as packages/server/test/cloudflare.test.ts). Types come from @types/node.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

describe('server-node workspace', () => {
  it('can open an in-memory node:sqlite database', () => {
    const db = new DatabaseSync(':memory:')
    expect(db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 })
    db.close()
  })
})
