import type { Item } from '../items/api'
import { NoteEditor } from '../notes/NoteEditor'
import type { SaveStatus } from '../notes/saver'
import { useNoteSaver } from '../notes/useNoteSaver'

const STATUS: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Saving…',
  saving: 'Saving…',
  offline: 'Offline, kept on this device',
  error: "Couldn't save",
  conflict: 'Not saved',
}

const actionButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

/**
 * A note edited in its card on the canvas, saved like on its own page.
 * Escape (or clicking elsewhere on the board) ends it; what is pending is
 * saved then. Loaded on first use, with CodeMirror.
 */
export default function NoteNodeEditor({ item, onDone }: { item: Item; onDone: () => void }) {
  const { saver, state } = useNoteSaver(item)

  return (
    // nodrag/nowheel/nopan: selecting text and scrolling stay in the editor.
    <div
      className="nodrag nowheel nopan cursor-text [--note-editor-font-size:0.875rem] [--note-editor-min-height:6rem]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onDone()
        }
      }}
    >
      {state.status === 'conflict' && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
        >
          <span className="mr-auto">Changed in another tab.</span>
          <button type="button" className={actionButton} onClick={() => saver.resolve('theirs')}>
            Load latest
          </button>
          <button type="button" className={actionButton} onClick={() => saver.resolve('mine')}>
            Keep mine
          </button>
        </div>
      )}
      {item.title && <h2 className="mb-1 font-medium">{item.title}</h2>}
      <NoteEditor
        key={saver.generation}
        initial={saver.body}
        autoFocus
        onChange={(body) => saver.edit(body)}
        onSave={() => saver.flush()}
      />
      <p className="mt-1 text-xs text-zinc-500">{STATUS[state.status]} · Esc to finish</p>
    </div>
  )
}
