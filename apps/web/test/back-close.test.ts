import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


/** A tiny history: entries are pushed on open, back() pops one and fires popstate on a later tick. */
function fakeBrowser() {
  let popstate: (() => void) | null = null
  const entries: unknown[] = ['base']
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'popstate') popstate = fn
    },
  })
  vi.stubGlobal('history', {
    pushState: (s: unknown) => entries.push(s),
    back: () => {
      entries.pop()
      queueMicrotask(() => popstate?.())
    },
  })
  return {
    entries,
    /** The user's Back: same as history.back(). */
    userBack: () => {
      entries.pop()
      popstate?.()
    },
  }
}

describe('back-close', () => {
  let b: ReturnType<typeof fakeBrowser>
  let pushBackClose: typeof import('../src/back-close.js').pushBackClose
  beforeEach(async () => {
    b = fakeBrowser()
    vi.resetModules() // the dialog stack is module state
    pushBackClose = (await import('../src/back-close.js')).pushBackClose
  })
  afterEach(() => vi.unstubAllGlobals())

  it('Back closes the open dialog and does not pop a second entry', () => {
    const close = vi.fn()
    const off = pushBackClose(close)
    expect(b.entries).toHaveLength(2)
    b.userBack()
    expect(close).toHaveBeenCalledTimes(1)
    off() // the dialog unmounting after Back must not call history.back() again
    expect(b.entries).toEqual(['base'])
  })

  it('closing by X pops its own entry without that popstate closing anything else', async () => {
    const outer = vi.fn()
    const inner = vi.fn()
    pushBackClose(outer)
    const offInner = pushBackClose(inner)
    offInner() // inner closed by its own X
    await Promise.resolve()
    expect(inner).not.toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()
    expect(b.entries).toHaveLength(2)
  })

  it('Back closes only the topmost of stacked dialogs', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    pushBackClose(outer)
    pushBackClose(inner)
    b.userBack()
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('with no dialog open, Back is left alone', () => {
    const close = vi.fn()
    const off = pushBackClose(close)
    off()
    expect(() => b.userBack()).not.toThrow()
    expect(close).not.toHaveBeenCalled()
  })
})
