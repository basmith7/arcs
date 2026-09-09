import { describe, expect, it } from 'vitest'

import {
  canPopNotification,
  flashTitleUntilSeen,
  isHiddenOrUnfocused,
  popTurnNotification,
} from '../src/notifications.js'
import type { DocumentLike, NotificationCtor } from '../src/notifications.js'

function fakeDoc(overrides: Partial<DocumentLike> = {}): DocumentLike & { listeners: Record<string, () => void> } {
  const listeners: Record<string, () => void> = {}
  return {
    hidden: false,
    title: 'Arcs',
    addEventListener(type, listener) {
      listeners[type] = listener
    },
    removeEventListener(type) {
      delete listeners[type]
    },
    listeners,
    ...overrides,
  }
}

describe('isHiddenOrUnfocused', () => {
  it('is true when the document is hidden', () => {
    expect(isHiddenOrUnfocused(fakeDoc({ hidden: true }))).toBe(true)
  })

  it('is true when visible but unfocused', () => {
    expect(isHiddenOrUnfocused(fakeDoc({ hasFocus: () => false }))).toBe(true)
  })

  it('is false when visible and focused', () => {
    expect(isHiddenOrUnfocused(fakeDoc({ hasFocus: () => true }))).toBe(false)
  })

  it('is false when visible with no hasFocus at all', () => {
    expect(isHiddenOrUnfocused(fakeDoc())).toBe(false)
  })
})

describe('canPopNotification', () => {
  const granted = { permission: 'granted' } as NotificationCtor
  const denied = { permission: 'denied' } as NotificationCtor

  it('requires the preference on, the ctor present, and permission granted', () => {
    expect(canPopNotification(true, granted)).toBe(true)
    expect(canPopNotification(false, granted)).toBe(false)
    expect(canPopNotification(true, undefined)).toBe(false)
    expect(canPopNotification(true, denied)).toBe(false)
  })
})

describe('popTurnNotification', () => {
  it('builds the title/body/tag and wires onclick to focus + close', () => {
    const created: { title: string; options?: { body?: string; tag?: string } }[] = []
    let closed = false
    class Fake {
      onclick: (() => void) | null = null
      constructor(title: string, options?: { body?: string; tag?: string }) {
        created.push({ title, options })
      }
      close() {
        closed = true
      }
    }
    let focused = false
    const win = { focus: () => (focused = true) }
    const n = popTurnNotification(Fake as unknown as NotificationCtor, win, 'g1', 3)
    expect(created[0]).toEqual({ title: 'Arcs — your turn', options: { body: 'Chapter 3', tag: 'arcs-g1' } })
    n.onclick?.()
    expect(focused).toBe(true)
    expect(closed).toBe(true)
  })
})

describe('flashTitleUntilSeen', () => {
  it('sets the title and restores it once on the next visibilitychange or focus', () => {
    const doc = fakeDoc({ title: 'Arcs' })
    flashTitleUntilSeen(doc)
    expect(doc.title).toBe('● Your turn — Arcs')
    doc.listeners['visibilitychange']?.()
    expect(doc.title).toBe('Arcs')
  })

  it('restoring removes both listeners so a later focus does not fire again', () => {
    const doc = fakeDoc({ title: 'Arcs' })
    flashTitleUntilSeen(doc)
    doc.listeners['focus']?.()
    expect(doc.listeners['visibilitychange']).toBeUndefined()
    expect(doc.listeners['focus']).toBeUndefined()
  })
})
