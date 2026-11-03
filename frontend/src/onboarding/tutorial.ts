import { createContext, useContext } from 'react'

export type TutorialStep =
  | 'capture'
  | 'noteSaved'
  | 'file'
  | 'voice'
  | 'newNoteNav'
  | 'newNoteWrite'
  | 'collectionsNav'
  | 'collectionCreate'
  | 'collectionName'
  | 'collectionSubmit'
  | 'boardsNav'
  | 'boardName'
  | 'boardSubmit'
  | 'boardAddOpen'
  | 'boardAddFirst'
  | 'boardAddSecond'
  | 'boardConnect'
  | 'accountNav'
  | 'accountMenu'
export type TutorialAction = Exclude<TutorialStep, 'accountMenu'>

export type Tutorial = {
  step: TutorialStep | null
  start: () => void
  stop: () => void
  complete: (action: TutorialAction) => void
}

const NO_TUTORIAL: Tutorial = {
  step: null,
  start: () => undefined,
  stop: () => undefined,
  complete: () => undefined,
}

export const TutorialContext = createContext<Tutorial>(NO_TUTORIAL)

export function useTutorial() {
  return useContext(TutorialContext)
}
