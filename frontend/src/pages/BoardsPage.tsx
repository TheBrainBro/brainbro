import { Plus, Waypoints } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useBoards, useCreateBoard, useMoveBoard } from '../boards/api'
import { useT } from '../i18n/i18n'
import { timeAgo } from '../lib/time'
import { useFeedback } from '../ui/feedback'
import { useSortable } from '../ui/sortable'
import { EmptyState, ErrorState } from '../ui/states'
import { useTutorial } from '../onboarding/tutorial'

export function BoardsPage() {
  const t = useT()
  const boards = useBoards()
  const create = useCreateBoard()
  const navigate = useNavigate()
  const { toast } = useFeedback()
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const move = useMoveBoard()
  const sorted = useSortable(boards.data ?? [], (id, after) =>
    move.mutate(
      { id, after },
      { onError: (error) => toast({ message: error.message, tone: 'error' }) },
    ),
  )
  const tutorial = useTutorial()

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-3 text-2xl font-semibold">{t('boards.title')}</h1>
      <form
        className="mb-6 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          create.mutate(title.trim(), {
            onSuccess: (board) => {
              tutorial.complete('board')
              navigate(`/boards/${board.id}`)
            },
            onError: (error) => toast({ message: error.message, tone: 'error' }),
          })
        }}
      >
        <input
          ref={input}
          data-tutorial="board-title"
          className="input"
          aria-label={t('boards.new')}
          placeholder={t('boards.new')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          type="submit"
          className="button-primary flex shrink-0 items-center gap-1.5"
          disabled={!title.trim() || create.isPending}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('boards.create')}
        </button>
      </form>

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
          icon={Waypoints}
          title={t('boards.none')}
          action={
            <button type="button" className="button-primary" onClick={() => input.current?.focus()}>
              {t('boards.nameFirst')}
            </button>
          }
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
                <Waypoints
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
    </div>
  )
}
