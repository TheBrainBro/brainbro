import { ReactFlowProvider } from '@xyflow/react'
import { Trash2, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { BoardCanvas } from '../boards/BoardCanvas'
import { useBoard, useDeleteBoard, useRenameBoard, type Board } from '../boards/api'
import { ApiError } from '../lib/api'
import { useMediaQuery } from '../lib/dom'
import { BackLink } from '../ui/BackLink'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState, Loading } from '../ui/states'

/** `/boards/:id`: the canvas, full-bleed under a thin header. */
export function BoardPage() {
  const { id = '' } = useParams()
  const board = useBoard(id)
  // Below `md` (phones) boards are read-only: pan, zoom and open items.
  const readOnly = !useMediaQuery('(min-width: 48rem)')

  if (board.isPending) return <Loading label="Opening board…" />
  if (board.isError) {
    const missing = board.error instanceof ApiError && board.error.status === 404
    const back = (
      <Link to="/boards" className={missing ? 'button-primary' : 'button-secondary'}>
        See all boards
      </Link>
    )
    return missing ? (
      <EmptyState icon={Waypoints} title="This board no longer exists" action={back} />
    ) : (
      <ErrorState
        error={board.error}
        title="Couldn't open this board"
        onRetry={() => board.refetch()}
        action={back}
      />
    )
  }
  return (
    <div className="flex h-full flex-col">
      <BoardHeader board={board.data} />
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <BoardCanvas key={board.data.id} board={board.data} readOnly={readOnly} />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

function BoardHeader({ board }: { board: Board }) {
  const rename = useRenameBoard(board.id)
  const remove = useDeleteBoard()
  const navigate = useNavigate()
  const { toast, confirm } = useFeedback()
  const [title, setTitle] = useState(board.title)

  function saveTitle() {
    const next = title.trim()
    if (!next) setTitle(board.title)
    else if (next !== board.title) rename.mutate(next)
  }

  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <BackLink to="/boards" label="Boards" />
      <input
        aria-label="Board title"
        className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 font-semibold transition hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/30 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={saveTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setTitle(board.title)
            // Blurring now would save the old title as it was: nothing to do.
            requestAnimationFrame(() => (event.target as HTMLInputElement).blur())
          }
        }}
      />
      {rename.isError && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {rename.error.message}
        </span>
      )}
      <button
        type="button"
        className="button-ghost shrink-0"
        onClick={async () => {
          const confirmed = await confirm({
            title: 'Delete this board?',
            message: 'Its items stay where they are: only the board and its layout go.',
            confirm: 'Delete',
            danger: true,
          })
          if (!confirmed) return
          remove.mutate(board.id, {
            onSuccess: () => {
              toast({ message: `Deleted ${board.title}` })
              navigate('/boards', { replace: true })
            },
            onError: (error) => toast({ message: error.message, tone: 'error' }),
          })
        }}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Delete
      </button>
    </div>
  )
}
