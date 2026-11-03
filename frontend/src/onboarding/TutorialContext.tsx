import { useMemo, useState, type ReactNode } from 'react'

import { TutorialContext, type Tutorial, type TutorialAction, type TutorialStep } from './tutorial'

const NEXT: Record<TutorialAction, TutorialStep> = {
  capture: 'file',
  file: 'collection',
  collection: 'board',
  board: 'complete',
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
