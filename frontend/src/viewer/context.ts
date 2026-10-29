import { createContext, useContext, type ReactNode } from 'react'

import type { Item } from '../items/api'

export type ViewerOptions = {
  /** More buttons for the viewer's bar (Remove from board). */
  actions?: (item: Item, close: () => void) => ReactNode
}

export type Viewer = {
  /** Shows `items[index]` full screen; the arrows step through the rest. */
  open: (items: Item[], index: number, options?: ViewerOptions) => void
}

export const ViewerContext = createContext<Viewer>({ open: () => {} })

export function useViewer() {
  return useContext(ViewerContext)
}
