import { ReactFlowProvider } from '@xyflow/react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { BoardCanvas } from '../boards/BoardCanvas'
import { useBoard, useDeleteBoard, useRenameBoard, type Board } from '../boards/api'
import { ApiError } from '../lib/api'
import { useMediaQuery } from '../lib/dom'

/** `/boards/:id`: the canvas, full-bleed under a thin header. */
export function BoardPage() {
  const { id = '' } = useParams()
  const board = useBoard(id)
  // Below `md` (phones) boards are read-only: pan, zoom and open items.
  const readOnly = !useMediaQuery('(min-width: 48rem)')

  if (board.isPending) {
    return <p className="p-8 text-zinc-500">Loading…</p>
  }
  if (board.isError) {
    const missing = board.error instanceof ApiError && board.error.status === 404
    return (
      <div className="p-8 text-center text-zinc-500">
        <p role="alert">{missing ? 'This board no longer exists.' : board.error.message}</p>
        <Link to="/boards" className="mt-2 inline-block text-sm hover:underline">
          ← Boards
        </Link>
      </div>
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
  const [title, setTitle] = useState(board.title)

  function saveTitle() {
    const next = title.trim()
    if (!next) setTitle(board.title)
    else if (next !== board.title) rename.mutate(next)
  }

  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <Link to="/boards" className="shrink-0 text-sm text-zinc-500 hover:underline">
        ← Boards
      </Link>
      <input
        aria-label="Board title"
        className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 font-semibold hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
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
        <span role="alert" className="text-xs text-red-600">
          {rename.error.message}
        </span>
      )}
      <button
        type="button"
        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        onClick={() => {
          if (!window.confirm('Delete this board? Its items stay where they are.')) return
          remove.mutate(board.id, { onSuccess: () => navigate('/boards', { replace: true }) })
        }}
      >
        Delete
      </button>
    </div>
  )
}
