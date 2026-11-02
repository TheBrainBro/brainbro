import { ReactFlowProvider } from '@xyflow/react'
import { History, Trash2, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { BoardCanvas } from '../boards/BoardCanvas'
import { useBoard, useDeleteBoard, useRenameBoard, type Board } from '../boards/api'
import { BoardHistory } from '../history/HistoryPanel'
import { useT } from '../i18n/i18n'
import { ApiError } from '../lib/api'
import { useMediaQuery } from '../lib/dom'
import { BackLink } from '../ui/BackLink'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState, Loading } from '../ui/states'

/** `/boards/:id`: the canvas, full-bleed under a thin header. */
export function BoardPage() {
  const t = useT()
  const { id = '' } = useParams()
  const board = useBoard(id)
  // Below `md` (phones) boards are read-only: pan, zoom and open items.
  const readOnly = !useMediaQuery('(min-width: 48rem)')
  const [history, setHistory] = useState(false)

  if (board.isPending) return <Loading label={t('board.opening')} />
  if (board.isError) {
    const missing = board.error instanceof ApiError && board.error.status === 404
    const back = (
      <Link to="/boards" className={missing ? 'button-primary' : 'button-secondary'}>
        {t('board.seeAll')}
      </Link>
    )
    return missing ? (
      <EmptyState icon={Waypoints} title={t('board.gone')} action={back} />
    ) : (
      <ErrorState
        error={board.error}
        title={t('board.couldNotOpen')}
        onRetry={() => board.refetch()}
        action={back}
      />
    )
  }
  return (
    <div className="flex h-full flex-col">
      <BoardHeader
        board={board.data}
        history={history}
        onHistory={() => setHistory(!history)}
      />
      <div className="relative min-h-0 flex-1">
        <ReactFlowProvider>
          <BoardCanvas key={board.data.id} board={board.data} readOnly={readOnly} />
        </ReactFlowProvider>
        {history && <BoardHistory board={board.data} onClose={() => setHistory(false)} />}
      </div>
    </div>
  )
}

function BoardHeader({
  board,
  history,
  onHistory,
}: {
  board: Board
  history: boolean
  onHistory: () => void
}) {
  const t = useT()
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
      <BackLink to="/boards" label={t('boards.title')} />
      <input
        aria-label={t('board.title')}
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
        aria-pressed={history}
        onClick={onHistory}
      >
        <History className="size-3.5" aria-hidden="true" />
        {t('board.history')}
      </button>
      <button
        type="button"
        className="button-ghost shrink-0"
        onClick={async () => {
          const confirmed = await confirm({
            title: t('board.deleteTitle'),
            message: t('board.deleteHint'),
            confirm: t('common.delete'),
            danger: true,
          })
          if (!confirmed) return
          remove.mutate(board.id, {
            onSuccess: () => {
              toast({ message: t('board.deleted', { name: board.title }) })
              navigate('/boards', { replace: true })
            },
            onError: (error) => toast({ message: error.message, tone: 'error' }),
          })
        }}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {t('common.delete')}
      </button>
    </div>
  )
}
