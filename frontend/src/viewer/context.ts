import { createContext, useContext, type ReactNode } from 'react'

import type { ContentMatch, Item } from '../items/api'

export type ViewerTarget = { image: string | null; match?: ContentMatch }

export type ViewerOptions = {
  /** More buttons for the viewer's bar (Remove from board). */
  actions?: (item: Item, close: () => void) => ReactNode
  /** One destination per search result, including repeated hits in the same item. */
  targets?: ViewerTarget[]
}

export type Viewer = {
  /** Shows `items[index]` full screen; the arrows step through the rest. */
  open: (items: Item[], index: number, options?: ViewerOptions) => void
}

export const ViewerContext = createContext<Viewer>({ open: () => {} })

export function useViewer() {
  return useContext(ViewerContext)
}
