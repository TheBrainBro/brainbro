import { createContext, useContext } from 'react'

export type BoardActions = {
  /** Phones: pan and zoom, nothing moves. */
  readOnly: boolean
}

export const BoardContext = createContext<BoardActions>({ readOnly: true })

export function useBoardActions() {
  return useContext(BoardContext)
}
