import { createContext, useContext } from 'react'

import type { EdgeData } from './layout'

export type BoardActions = {
  /** Phones: pan, zoom and open items; nothing moves. */
  readOnly: boolean
  /** Shows an item in the side panel. */
  openItem: (itemId: string) => void
  /** Edits a note in its card. */
  startEditing: (nodeId: string) => void
  stopEditing: () => void
  renameFrame: (id: string, title: string) => void
  recolorFrame: (id: string, color: string) => void
  /** Takes the group away; what it held stays where it is. */
  ungroupFrame: (id: string) => void
  updateEdge: (id: string, patch: Partial<EdgeData>) => void
}

const nothing = () => {}

export const BoardContext = createContext<BoardActions>({
  readOnly: true,
  openItem: nothing,
  startEditing: nothing,
  stopEditing: nothing,
  renameFrame: nothing,
  recolorFrame: nothing,
  ungroupFrame: nothing,
  updateEdge: nothing,
})

export function useBoardActions() {
  return useContext(BoardContext)
}
