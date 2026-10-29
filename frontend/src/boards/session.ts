import type { Viewport } from '@xyflow/react'

import type { DraftStore } from '../lib/autosave'
import type { Board, Layout, SavedLayout } from './api'
import { History } from './history'
import { sameContent, toFlowNodes, toLayout, type ItemFlowNode } from './layout'
import { LayoutSaver, type LayoutDraft, type LayoutSaverState } from './saver'

export type BoardSessionOptions = {
  save: (layout: Layout, revision: number, options: { keepalive: boolean }) => Promise<SavedLayout>
  onSaveState: (state: LayoutSaverState) => void
  /** `placed`: items were put on the board since the last save. */
  onSaved: (saved: SavedLayout, placed: boolean) => void
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
  // Groups and edges are kept from here until the canvas edits them.
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
        this.base = saved.layout
        const placed = this.placed
        this.placed = false
        options.onSaved(saved, placed)
      },
    })
    const draft = this.saver.restoreDraft()
    if (draft) {
      this.base = draft
      this.history.push(draft)
      const before = new Set(board.layout.nodes.map((node) => node.item))
      this.placed = draft.nodes.some((node) => !before.has(node.item))
    }
  }

  /** What the canvas starts with: the server's layout, or a restored draft. */
  get initialNodes() {
    return toFlowNodes(this.history.present)
  }

  /** Starts saving a restored draft, once the canvas shows it. */
  resume() {
    this.saver.resume()
  }

  /** Records what the canvas shows and saves it soon; false if nothing worth saving changed. */
  commit(nodes: ItemFlowNode[], viewport: Viewport) {
    const layout = toLayout(nodes, viewport, this.base)
    if (sameContent(layout, this.history.present)) return false
    this.history.push(layout)
    this.saver.save(layout)
    return true
  }

  /** Steps back or forward; the nodes to show, or undefined at either end. */
  travel(direction: 'undo' | 'redo', viewport: Viewport) {
    const layout = direction === 'undo' ? this.history.undo() : this.history.redo()
    if (!layout) return undefined
    this.saver.save({ ...layout, viewport })
    return toFlowNodes(layout)
  }

  /** Before committing a newly placed item, so the save refreshes item lists. */
  place() {
    this.placed = true
  }

  /** Ends a conflict; with `theirs`, their board, whose nodes the canvas should show. */
  resolve(side: 'mine' | 'theirs') {
    const theirs = this.saver.resolve(side)
    if (!theirs) return undefined
    this.base = theirs.layout
    this.history.reset(theirs.layout)
    return theirs
  }
}
