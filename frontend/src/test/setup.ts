import '@testing-library/jest-dom/vitest'
// jsdom has no IndexedDB (the share queue).
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import { FakeLiveServer } from './liveServer'

// Vitest runs without globals, so Testing Library can't register this itself.
afterEach(cleanup)

// jsdom's WebSocket would reach for a real server: notes opened live talk to
// an empty fake one, unless a test stubs its own (FakeLiveServer).
globalThis.WebSocket = new FakeLiveServer().WebSocket

// jsdom has no canvas: drawing code sees no context, as without WebGL,
// instead of jsdom logging "not implemented".
HTMLCanvasElement.prototype.getContext = () => null

// jsdom doesn't implement layout APIs.
Element.prototype.scrollIntoView ??= () => {}

// React Flow measures nodes and the viewport with these.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.DOMMatrixReadOnly ??= class {
  m22: number
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1]
    this.m22 = scale ? Number(scale) : 1
  }
} as unknown as typeof DOMMatrixReadOnly

// Media queries match nothing unless a test says otherwise.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList
