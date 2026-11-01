import { t, useT, type MessageKey } from '../i18n/i18n'
import { uploadNoteImage, useItem, type Item } from '../items/api'
import { NoteEditor } from '../notes/NoteEditor'
import { Peers } from '../notes/Peers'
import { useLiveNote, type LiveStatus } from '../notes/live'
import { useFeedback } from '../ui/feedback'

const STATUS: Record<LiveStatus, MessageKey> = {
  live: 'note.saved',
  connecting: 'note.connecting',
  offline: 'note.offline',
  closed: 'note.closed',
}

/**
 * A note edited in its card on the canvas, live like on its own page.
 * Escape (or clicking elsewhere on the board) ends it. Loaded on first use,
 * with CodeMirror.
 */
export default function NoteNodeEditor({ item, onDone }: { item: Item; onDone: () => void }) {
  useT()
  const note = useLiveNote(item.id)
  const latest = useItem(item.id).data ?? item
  const { toast } = useFeedback()

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
      {item.title && <h2 className="mb-1 font-medium">{item.title}</h2>}
      {note.live && note.ready ? (
        <NoteEditor
          live={note.live}
          autoFocus
          images={latest.images}
          links={latest.links}
          uploadImage={uploadNoteImage}
          onUploadError={(message) => toast({ message, tone: 'error' })}
        />
      ) : (
        <div role="status" aria-label={t('nodes.loadingNote')} className="space-y-2 py-2">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-2/3" />
        </div>
      )}
      <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
        <span className="mr-auto">{t('nodes.escToFinish', { status: t(STATUS[note.status]) })}</span>
        <Peers peers={note.peers} />
      </p>
    </div>
  )
}
