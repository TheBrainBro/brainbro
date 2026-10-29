import { createContext, useContext } from 'react'

export type BoardActions = {
  /** Phones: pan, zoom and open items; nothing moves. */
  readOnly: boolean
  /** Shows an item in the side panel. */
  openItem: (itemId: string) => void
  /** Edits a note in its card. */
  startEditing: (nodeId: string) => void
  stopEditing: () => void
}

const nothing = () => {}

export const BoardContext = createContext<BoardActions>({
  readOnly: true,
  openItem: nothing,
  startEditing: nothing,
  stopEditing: nothing,
})

export function useBoardActions() {
  return useContext(BoardContext)
}
