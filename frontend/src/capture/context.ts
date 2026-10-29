import { createContext, useContext } from 'react'

import type { Item } from '../items/api'
import type { CaptureInput, CaptureInputs } from './inputs'

/** One input on its way in: shown as an optimistic card until the server item replaces it. */
export type PendingCapture = {
  id: string
  batch: string
  /** File name, URL or text: what the card shows. */
  label: string
  input?: CaptureInput
  state: 'queued' | 'uploading' | 'error'
  /** Upload progress, 0 to 1 (files only). */
  progress: number
  error?: string
  /** Network and server errors can be retried; too big or a folder can't. */
  retryable: boolean
  /** Local object URL, so an image shows before its thumbnail exists. */
  previewUrl?: string
}

/**
 * Per input, in order; `id` is its pending entry (gone once it succeeded).
 * `deferred`: it couldn't reach the server for now (offline, signed out) and
 * the caller keeps it to send later; no failed card is left for it.
 */
export type CaptureResult = { id: string } & ({ item: Item } | { error: string; deferred?: boolean })

export type CaptureOptions = {
  /** Offer an Undo toast. Off for the capture box, where the intent is explicit. */
  undo?: boolean
  /**
   * The caller retries later (the share queue): network, session and server
   * errors resolve as `deferred` instead of leaving a failed card.
   */
  retryLater?: boolean
  /**
   * Two or more images captured together become one album (on by default;
   * the toast offers to separate them). Off on a board, where each image is
   * its own card.
   */
  album?: boolean
  /** Right away: the pending entry of each input and skipped one, in order. */
  onQueued?: (ids: string[]) => void
  /** Each time an entry settles (again after a retry), until it succeeds or is dismissed. */
  onSettled?: (result: CaptureResult) => void
}

/**
 * Where pastes and drops go instead of the inbox while it is registered (an
 * open board). Pastes outside text fields are its own; drops only on its
 * element.
 */
export type CaptureTarget = {
  contains: (node: Node) => boolean
  /** `at`: where it was dropped, in client coordinates; null for a paste. */
  capture: (found: CaptureInputs, at: { x: number; y: number } | null) => void
}

export type CapturePipeline = {
  pending: PendingCapture[]
  capture: (found: CaptureInputs, options?: CaptureOptions) => Promise<CaptureResult[]>
  retry: (id: string) => void
  dismiss: (id: string) => void
  /** Registers where pastes and drops go; returns the cleanup. */
  target: (target: CaptureTarget) => () => void
  /** Something capturable is dragged over the app (a registered target shows its own hint). */
  dragging: boolean
}

export const CaptureContext = createContext<CapturePipeline | null>(null)

export function useCapturePipeline() {
  const pipeline = useContext(CaptureContext)
  if (!pipeline) throw new Error('useCapturePipeline needs a CaptureProvider')
  return pipeline
}
