import { useMemo, useState, type ReactNode } from 'react'

import { useSession, useTutorialProgress } from '../auth/session'
import {
  TutorialContext,
  type Tutorial,
  type TutorialAction,
  type TutorialCollection,
  type TutorialStep,
  type TutorialTrack,
} from './tutorial'

const NEXT: Record<TutorialAction, TutorialStep> = {
  capture: 'organize',
  organize: 'organized',
  organized: 'done',
  boardCreate: 'boardName',
  boardName: 'boardAdd',
  boardAdd: 'boardPlace',
  boardPlace: 'boardTools',
  boardTools: 'done',
  graph: 'graphFilters',
  graphFilters: 'done',
  assistant: 'done',
  examples: 'done',
}

const FIRST: Record<TutorialTrack, TutorialStep> = {
  boards: 'boardCreate',
  graph: 'graph',
  assistant: 'assistant',
  examples: 'examples',
}

// The step that ends each track, back to the hub.
const LAST: Partial<Record<TutorialAction, TutorialTrack>> = {
  boardTools: 'boards',
  graphFilters: 'graph',
  assistant: 'assistant',
  examples: 'examples',
}

const TRACKS: TutorialTrack[] = ['boards', 'graph', 'assistant', 'examples']

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const save = useTutorialProgress()
  const saved = session?.tutorial
  const [step, setStep] = useState<TutorialStep | null>(null)
  const [collection, setCollection] = useState<TutorialCollection | null>(null)
  const [seen, setSeen] = useState<TutorialTrack[]>([])
  const record = save.mutate
  const value = useMemo<Tutorial>(
    () => ({
      step,
      collection,
      seen,
      minimized: step === null && Boolean(saved?.started) && !saved?.closed,
      progress: { done: saved?.done.length ?? 0, total: TRACKS.length + 1 },
      start: () => {
        setCollection(null)
        setSeen([])
        setStep('capture')
        record({ action: 'start' })
      },
      stop: () => setStep(null),
      resume: () => {
        const done = saved?.done ?? []
        setSeen(TRACKS.filter((track) => done.includes(track)))
        setStep(done.includes('loop') ? 'done' : 'capture')
      },
      finish: () => {
        setStep(null)
        record({ action: 'close' })
      },
      complete: (action, into) => {
        if (step !== action) return
        if (into) setCollection(into)
        if (action === 'organized') record({ action: 'done', part: 'loop' })
        const track = LAST[action]
        if (track) {
          setSeen((current) => (current.includes(track) ? current : [...current, track]))
          record({ action: 'done', part: track })
        }
        setStep(NEXT[action])
      },
      open: (track) => {
        if (step === 'done') setStep(FIRST[track])
      },
      toHub: () => {
        if (step) setStep('done')
      },
    }),
    [step, collection, seen, saved, record],
  )

  return <TutorialContext value={value}>{children}</TutorialContext>
}
