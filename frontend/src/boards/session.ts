import type { Viewport } from '@xyflow/react'

import type { DraftStore } from '../lib/autosave'
import type { Board, Layout, SavedLayout } from './api'
import { History } from './history'
import { sameContent, toLayout, toScene, type Scene } from './layout'
import { LayoutSaver, type LayoutDraft, type LayoutSaverState } from './saver'

function itemIds(layout: Layout) {
  return layout.nodes.flatMap((node) => (node.type === 'item' ? [node.item] : []))
}

export type BoardSessionOptions = {
  save: (layout: Layout, revision: number, options: { keepalive: boolean }) => Promise<SavedLayout>
  onSaveState: (state: LayoutSaverState) => void
  /**
   * `itemsChanged`: items were put on the board or taken off it since the last
   * save, which changes where they show (the inbox, collections).
   */
  onSaved: (saved: SavedLayout, itemsChanged: boolean) => void
  drafts: DraftStore<LayoutDraft>
}

/**
 * The editing state of one open board: what was last saved, undo and redo
 * over committed changes, and the saver they go through. A draft left by an
 * earlier visit comes back as one undoable change on top of the server's
 * layout.
 */
export class BoardSession {
  readonly history: History<Layout>
  readonly saver: LayoutSaver
  // Whatever the canvas doesn't know about is kept from here.
  private base: Layout
  private placed = false

  constructor(board: Board, options: BoardSessionOptions) {
    this.base = board.layout
    this.history = new History(board.layout)
    this.saver = new LayoutSaver(board, {
      save: options.save,
      onChange: options.onSaveState,
      drafts: options.drafts,
      onSaved: (saved) => {
        const kept = new Set(itemIds(saved.layout))
        const takenOff = itemIds(this.base).some((id) => !kept.has(id))
        this.base = saved.layout
        const placed = this.placed
        this.placed = false
        options.onSaved(saved, placed || takenOff)
      },
    })
    const draft = this.saver.restoreDraft()
    if (draft) {
      this.base = draft
      this.history.push(draft)
      const before = new Set(itemIds(board.layout))
      this.placed = itemIds(draft).some((id) => !before.has(id))
    }
  }

  /** What the canvas starts with: the server's layout, or a restored draft. */
  get initialScene() {
    return toScene(this.history.present)
  }

  /** Starts saving a restored draft, once the canvas shows it. */
  resume() {
    this.saver.resume()
  }

  /** Records what the canvas shows and saves it soon; false if nothing worth saving changed. */
  commit(scene: Scene, viewport: Viewport) {
    const layout = toLayout(scene, viewport, this.base)
    if (sameContent(layout, this.history.present)) return false
    this.history.push(layout)
    this.saver.save(layout)
    return true
  }

  /** Steps back or forward; what to show, or undefined at either end. */
  travel(direction: 'undo' | 'redo', viewport: Viewport) {
    const layout = direction === 'undo' ? this.history.undo() : this.history.redo()
    if (!layout) return undefined
    this.saver.save({ ...layout, viewport })
    return toScene(layout)
  }

  /** Before committing a newly placed item, so the save refreshes item lists. */
  place() {
    this.placed = true
  }

  /** Ends a conflict; with `theirs`, their board, whose layout the canvas should show. */
  resolve(side: 'mine' | 'theirs') {
    const theirs = this.saver.resolve(side)
    if (!theirs) return undefined
    this.base = theirs.layout
    this.history.reset(theirs.layout)
    return theirs
  }
}
