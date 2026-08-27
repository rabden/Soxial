import React from 'react'
import { vi } from 'vitest'

/**
 * Shared mocks for the jsdom Human-surface tests: framer-motion collapsed to
 * identity elements (its projection layer needs a real document), a
 * controllable IntersectionObserver (jsdom has none), and helpers to drive
 * the sentinel. Use `motionReactMock` inside a vi.mock factory, and
 * `installFakeIntersectionObserver`/`markSentinelIntersecting` in beforeEach/tests.
 */

export const motionReactMock = {
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, tag: string) => {
        const identity =
          ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
            React.createElement(tag, props, children)
        return identity
      },
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}

export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  callback: (entries: Array<{ isIntersecting: boolean }>, observer: unknown) => void
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()

  constructor(
    callback: (entries: Array<{ isIntersecting: boolean }>, observer: unknown) => void,
    _options?: IntersectionObserverInit,
  ) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
}

/** Install the fake observer globally and reset captured instances. */
export function installFakeIntersectionObserver() {
  FakeIntersectionObserver.instances = []
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver
}

/** Drive the sentinel: mark every observed element intersecting. */
export function markSentinelIntersecting() {
  for (const observer of [...FakeIntersectionObserver.instances]) {
    observer.callback([{ isIntersecting: true }], observer)
  }
}
