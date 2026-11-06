import { createContext, useContext } from 'react'

/**
 * The first loop (capture a note, give it a home, see it there), then a hub
 * ('done') with a short guided track for each place to go next. Each track
 * ends back at the hub, ticked.
 */
export type TutorialStep =
  | 'capture'
  | 'organize'
  | 'organized'
  | 'done'
  | 'boardCreate'
  | 'boardName'
  | 'boardAdd'
  | 'boardPlace'
  | 'boardTools'
  | 'graph'
  | 'graphFilters'
  | 'assistant'
  | 'examples'
export type TutorialAction = Exclude<TutorialStep, 'done'>
export type TutorialTrack = 'boards' | 'graph' | 'assistant' | 'examples'

/** The collection the tutorial's note went into. */
export type TutorialCollection = { id: string; name: string }

export type Tutorial = {
  step: TutorialStep | null
  collection: TutorialCollection | null
  /** The tracks already walked, ticked on the hub. */
  seen: TutorialTrack[]
  /** Shrunk to its pill: closed halfway, not put away for good. */
  minimized: boolean
  /** How many of its parts are done, and of how many, on any device. */
  progress: { done: number; total: number }
  /** Afresh, from the first capture. */
  start: () => void
  /** Closed for now: it waits in its pill. */
  stop: () => void
  /** From the pill: back where it was left (the hub, once the first loop is done). */
  resume: () => void
  /** Put away for good: Finish, or the pill's own close. */
  finish: () => void
  /** Moves on, only from that step. Organizing says where the note went. */
  complete: (action: TutorialAction, collection?: TutorialCollection) => void
  /** From the hub, into a track. */
  open: (track: TutorialTrack) => void
  /** Out of a track, back to the hub. */
  toHub: () => void
}

const NO_TUTORIAL: Tutorial = {
  step: null,
  collection: null,
  seen: [],
  minimized: false,
  progress: { done: 0, total: 0 },
  start: () => undefined,
  stop: () => undefined,
  resume: () => undefined,
  finish: () => undefined,
  complete: () => undefined,
  open: () => undefined,
  toHub: () => undefined,
}

export const TutorialContext = createContext<Tutorial>(NO_TUTORIAL)

export function useTutorial() {
  return useContext(TutorialContext)
}
