import '@testing-library/jest-dom/vitest'
// jsdom has no IndexedDB (the share queue).
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library can't register this itself.
afterEach(cleanup)

// jsdom doesn't implement layout APIs.
Element.prototype.scrollIntoView ??= () => {}
