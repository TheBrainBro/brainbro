import { LayoutDashboard, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useBoards, useMoveBoard } from '../boards/api'
import { BoardDialog } from '../boards/BoardDialog'
import { useT } from '../i18n/i18n'
import { timeAgo } from '../lib/time'
import { useFeedback } from '../ui/feedback'
import { useSortable } from '../ui/sortable'
import { EmptyState, ErrorState } from '../ui/states'
import { useTutorial } from '../onboarding/tutorial'

export function BoardsPage() {
  const t = useT()
  const boards = useBoards()
  const navigate = useNavigate()
  const { toast } = useFeedback()
  const [creating, setCreating] = useState(false)
  const move = useMoveBoard()
  const sorted = useSortable(boards.data ?? [], (id, after) =>
    move.mutate(
      { id, after },
      { onError: (error) => toast({ message: error.message, tone: 'error' }) },
    ),
  )
  const tutorial = useTutorial()
  const some = boards.isSuccess && boards.data.length > 0

  const newButton = (
    <button
      type="button"
      data-tutorial="board-create"
      className="button-primary flex shrink-0 items-center gap-1.5"
      onClick={() => {
        setCreating(true)
        if (tutorial.step === 'boardCreate') tutorial.complete('boardCreate')
      }}
    >
      <Plus className="size-4" aria-hidden="true" />
      {t('boards.new')}
    </button>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">{t('boards.title')}</h1>
        {some && newButton}
      </div>

      {boards.isPending && (
        <div role="status" aria-label={t('boards.loading')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
      )}
      {boards.isError && <ErrorState error={boards.error} onRetry={() => boards.refetch()} />}
      {boards.isSuccess && boards.data.length === 0 && (
        <EmptyState
          icon={LayoutDashboard}
          title={t('boards.none')}
          action={newButton}
        >
          {t('boards.noneHint')}
        </EmptyState>
      )}
      <ul
        aria-label={t('boards.title')}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        {...sorted.listProps}
      >
        {sorted.shown.map((board) => (
          <li key={board.id} {...sorted.itemProps(board)}>
            <Link
              to={`/boards/${board.id}`}
              // The card moves, not the link.
              draggable={false}
              className="surface group flex h-28 flex-col justify-between px-4 py-3 transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-700"
            >
              <span className="flex items-start gap-2">
                <LayoutDashboard
                  className="mt-0.5 size-4 shrink-0 text-zinc-400 transition group-hover:text-accent-500"
                  aria-hidden="true"
                />
                <span className="line-clamp-2 font-medium">{board.title}</span>
              </span>
              <span className="text-xs text-zinc-500">
                {t('counts.items', { count: board.item_count })} ·{' '}
                {t('boards.edited', { when: timeAgo(board.updated_at) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {creating && (
        <BoardDialog
          onClose={() => setCreating(false)}
          onCreated={(board) => {
            setCreating(false)
            tutorial.complete('boardSubmit')
            navigate(`/boards/${board.id}`)
          }}
        />
      )}
    </div>
  )
}
