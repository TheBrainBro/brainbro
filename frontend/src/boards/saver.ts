import { Autosave, localDraftStore, type AutosaveState, type DraftStore } from '../lib/autosave'
import type { Board, Layout, SavedLayout } from './api'
import { sameContent } from './layout'

/** `theirs`: the server's board when another tab or device saved first. */
export type LayoutSaverState = AutosaveState<Board>

/** A layout not saved yet, and the revision it was made on top of. */
export type LayoutDraft = { layout: Layout; base: number }

export type LayoutSaverOptions = {
  /** Saves if the server still has `revision`; rejects with a 412 ApiError otherwise. */
  save: (layout: Layout, revision: number, options: { keepalive: boolean }) => Promise<SavedLayout>
  onChange: (state: LayoutSaverState) => void
  onSaved?: (saved: SavedLayout) => void
  drafts: DraftStore<LayoutDraft>
  debounceMs?: number
  maxWaitMs?: number
}

// Moving a few cards in a row goes out as one save, and a long session of
// edits still saves every few seconds.
const DEBOUNCE_MS = 1000
const MAX_WAIT_MS = 5000
// Browsers refuse keepalive requests over 64 KiB (all of a page's together):
// bigger layouts go as a normal request, and the draft covers them if the
// page is gone before it lands.
const KEEPALIVE_MAX_BYTES = 60_000

const encoder = new TextEncoder()

/**
 * Autosave for a board's layout (see `Autosave` for the timing): only the
 * latest layout is sent, against the revision it was made on, and it is kept
 * as a draft on this device until the server has it.
 */
export class LayoutSaver {
  private board: Board
  private revision: number
  /** What the server has, as far as we know: the last layout it took. */
  private stored: Layout
  private current: Layout
  private options: LayoutSaverOptions
  private autosave: Autosave<Board>

  constructor(board: Board, options: LayoutSaverOptions) {
    this.board = board
    this.revision = board.revision
    this.stored = board.layout
    this.current = board.layout
    this.options = options
    this.autosave = new Autosave<Board>({
      dirty: () => !sameContent(this.current, this.stored),
      save: (saveOptions) => this.send(saveOptions),
      onClean: () => options.drafts.remove(board.id),
      onChange: options.onChange,
      debounceMs: options.debounceMs ?? DEBOUNCE_MS,
      maxWaitMs: options.maxWaitMs ?? MAX_WAIT_MS,
    })
  }

  get status() {
    return this.autosave.status
  }

  get snapshot() {
    return this.autosave.snapshot
  }

  get currentRevision() {
    return this.revision
  }

  /**
   * A layout left unsaved by an earlier visit (reload, closed tab, offline),
   * to show instead of the server's. Made on the revision the server still
   * has, it just needs saving (`resume`); made on an older one, it is a
   * conflict with the board as loaded. No callbacks: the canvas isn't up yet.
   */
  restoreDraft(): Layout | undefined {
    const draft = this.options.drafts.get(this.board.id)
    if (!draft) return undefined
    // It got saved after all (a keepalive save as the tab closed).
    if (sameContent(draft.layout, this.board.layout)) {
      this.options.drafts.remove(this.board.id)
      return undefined
    }
    this.current = draft.layout
    this.autosave.init(
      draft.base === this.board.revision
        ? { status: 'unsaved' }
        : { status: 'conflict', theirs: this.board },
    )
    return draft.layout
  }

  /** Saves a restored draft (once the canvas is up). */
  resume() {
    if (this.status === 'unsaved') this.autosave.changed()
  }

  /** The layout changed: kept as a draft at once, saved once changes stop for a moment. */
  save(layout: Layout) {
    this.current = layout
    this.keepDraft()
    this.autosave.changed()
  }

  private keepDraft() {
    if (sameContent(this.current, this.stored)) this.options.drafts.remove(this.board.id)
    else this.options.drafts.set(this.board.id, { layout: this.current, base: this.revision })
  }

  private async send({ keepalive }: { keepalive: boolean }) {
    const layout = this.current
    const fits = encoder.encode(JSON.stringify(layout)).length <= KEEPALIVE_MAX_BYTES
    const saved = await this.options.save(layout, this.revision, {
      keepalive: keepalive && fits,
    })
    this.revision = saved.revision
    // Compared with what we sent: the server may have pruned nodes of items
    // deleted meanwhile, and those stay on the canvas until it reloads.
    this.stored = layout
    this.options.onSaved?.(saved)
    // Changed while saving: the draft now sits on the new revision.
    if (this.current !== layout) this.keepDraft()
  }

  /** Saves now. `keepalive` lets the request outlive the page (closing the tab). */
  flush(options: { keepalive?: boolean } = {}) {
    return this.autosave.flush(options)
  }

  /** Tries a failed save again now. */
  retryNow() {
    this.autosave.retryNow()
  }

  /**
   * Ends a conflict. `mine` saves our layout over theirs; `theirs` drops it
   * and returns their board, for the canvas to show.
   */
  resolve(side: 'mine' | 'theirs'): Board | undefined {
    const theirs = this.snapshot.theirs
    if (this.status !== 'conflict' || !theirs) return undefined
    this.revision = theirs.revision
    this.stored = theirs.layout
    if (side === 'theirs') {
      this.current = theirs.layout
      this.options.drafts.remove(this.board.id)
      this.autosave.reset()
      return theirs
    }
    this.keepDraft()
    this.autosave.resume()
    return undefined
  }

  /**
   * The board was saved elsewhere (another device, an assistant). With
   * nothing pending here it is taken and returned, for the canvas to show;
   * with something pending it is a conflict for the owner to resolve. Older
   * or same revisions, and a save in flight (it finds out itself), are left
   * alone.
   */
  changedElsewhere(theirs: Board): Board | undefined {
    if (theirs.revision <= this.revision) return undefined
    if (this.status === 'conflict' || this.status === 'saving') return undefined
    if (this.status !== 'saved') {
      this.autosave.conflict(theirs)
      return undefined
    }
    this.revision = theirs.revision
    this.stored = theirs.layout
    this.current = theirs.layout
    this.options.drafts.remove(this.board.id)
    this.autosave.reset()
    return theirs
  }

  /** Mounted (again): failed saves retry. */
  attach() {
    this.autosave.attach()
  }

  /** Leaving the board: save what's left and stop the timers. */
  dispose(options: { keepalive?: boolean } = {}) {
    this.autosave.dispose(options)
  }
}

/** Board layouts not saved yet, in localStorage by board id. */
export const layoutDrafts = localDraftStore<LayoutDraft>('brainbro:board-draft:')
