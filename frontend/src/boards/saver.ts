import { ApiError } from '../lib/api'
import type { Board, Layout, SavedLayout } from './api'

export type LayoutSaveStatus = 'saved' | 'saving' | 'error' | 'conflict'

export type LayoutSaverState = {
  status: LayoutSaveStatus
  error?: string
  /** The server's board when another tab or device saved first. */
  theirs?: Board
}

export type LayoutSaverOptions = {
  /** Saves if the server still has `revision`; rejects with a 412 ApiError otherwise. */
  save: (layout: Layout, revision: number) => Promise<SavedLayout>
  onChange: (state: LayoutSaverState) => void
  onSaved?: (saved: SavedLayout) => void
}

/**
 * Saves a board's layout: one request at a time, and only the latest layout
 * (changes made while a save is in flight go in the next one). On a conflict
 * it stops until the user picks a side.
 */
export class LayoutSaver {
  private revision: number
  private pending: Layout | null = null
  private inFlight = false
  private state: LayoutSaverState = { status: 'saved' }
  private options: LayoutSaverOptions

  constructor(revision: number, options: LayoutSaverOptions) {
    this.revision = revision
    this.options = options
  }

  get snapshot() {
    return this.state
  }

  get currentRevision() {
    return this.revision
  }

  private set(state: LayoutSaverState) {
    this.state = state
    this.options.onChange(state)
  }

  save(layout: Layout) {
    this.pending = layout
    this.run()
  }

  /** Tries the last failed save again. */
  retry() {
    if (this.state.status === 'error') this.run()
  }

  /**
   * Ends a conflict. `mine` saves our layout over theirs; `theirs` drops it
   * and returns their board, for the canvas to show.
   */
  resolve(side: 'mine' | 'theirs'): Board | undefined {
    const theirs = this.state.theirs
    if (this.state.status !== 'conflict' || !theirs) return undefined
    this.revision = theirs.revision
    if (side === 'theirs') {
      this.pending = null
      this.set({ status: 'saved' })
      return theirs
    }
    this.set({ status: 'saving' })
    this.run()
    return undefined
  }

  private async run() {
    if (this.inFlight || !this.pending || this.state.status === 'conflict') return
    const layout = this.pending
    this.pending = null
    this.inFlight = true
    this.set({ status: 'saving' })
    try {
      const saved = await this.options.save(layout, this.revision)
      this.revision = saved.revision
      this.inFlight = false
      this.options.onSaved?.(saved)
      if (this.pending) this.run()
      else this.set({ status: 'saved' })
    } catch (error) {
      this.inFlight = false
      // Keep what we wanted to save, unless something newer came in meanwhile.
      this.pending ??= layout
      if (error instanceof ApiError && error.status === 412) {
        this.set({ status: 'conflict', theirs: error.data as Board })
      } else {
        this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
