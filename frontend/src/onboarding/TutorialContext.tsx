import { useMemo, useState, type ReactNode } from 'react'

import { TutorialContext, type Tutorial, type TutorialAction, type TutorialStep } from './tutorial'

const NEXT: Record<TutorialAction, TutorialStep> = {
  capture: 'noteSaved',
  noteSaved: 'file',
  file: 'voice',
  voice: 'newNoteNav',
  newNoteNav: 'newNoteWrite',
  newNoteWrite: 'collectionsNav',
  collectionsNav: 'collectionCreate',
  collectionCreate: 'collectionName',
  collectionName: 'collectionSubmit',
  collectionSubmit: 'boardsNav',
  boardsNav: 'boardName',
  boardName: 'boardSubmit',
  boardSubmit: 'boardAddOpen',
  boardAddOpen: 'boardAddFirst',
  boardAddFirst: 'boardAddSecond',
  boardAddSecond: 'boardConnect',
  boardConnect: 'accountNav',
  accountNav: 'accountMenu',
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<TutorialStep | null>(null)
  const value = useMemo<Tutorial>(
    () => ({
      step,
      start: () => setStep('capture'),
      stop: () => setStep(null),
      complete: (action) => setStep((current) => (current === action ? NEXT[action] : current)),
    }),
    [step],
  )

  return <TutorialContext value={value}>{children}</TutorialContext>
}
