/**
 * A double tap plays one action, not two.
 *
 * `apply` re-renders synchronously, so the second tap of a double tap lands on whatever the next
 * decision drew in the same place, often its Cancel, Skip or End turn. It read a fresh journal
 * length and went through as a genuine second move; the server's length check only stops stale
 * tabs. A short guard after each applied action swallows that second tap.
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { Action, Continue } from '@arcs/engine'

import { store } from '../src/store.js'

let clock = 0

function journalLength(): number {
  const json = store.toJSON()
  return json === null ? 0 : (JSON.parse(json) as { journal: string[] }).journal.length
}

function firstOffer(): Action {
  const c = store.getSnapshot()!.continue as Continue
  if (c.kind !== 'ask') throw new Error('expected an ask')
  return c.actions[0]!
}

afterEach(() => {
  store.tapGuardMs = 0
})

describe('the tap guard', () => {
  it('ignores a second apply inside the guard window, and accepts one after it', () => {
    store.start({ board: 'Board2Frontiers', factions: ['red', 'yellow'], seed: 5 })
    store.now = () => clock
    store.tapGuardMs = 350

    clock = 1000
    store.apply(firstOffer())
    expect(journalLength()).toBe(1)

    // The second tap of a double tap: 80 ms later, on whatever the next ask drew.
    clock = 1080
    store.apply(firstOffer())
    expect(journalLength()).toBe(1)

    clock = 1400
    store.apply(firstOffer())
    expect(journalLength()).toBe(2)
  })

  it('is off outside a browser, so tests and scripts can apply back to back', () => {
    store.start({ board: 'Board2Frontiers', factions: ['red', 'yellow'], seed: 5 })
    store.tapGuardMs = 0
    store.apply(firstOffer())
    store.apply(firstOffer())
    expect(journalLength()).toBe(2)
  })
})
