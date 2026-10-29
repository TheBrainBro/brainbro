import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useBoards, useCreateBoard } from '../boards/api'
import { timeAgo } from '../lib/time'

export function BoardsPage() {
  const boards = useBoards()
  const create = useCreateBoard()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-3 text-2xl font-semibold">Boards</h1>
      <form
        className="mb-6 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          create.mutate(title.trim(), { onSuccess: (board) => navigate(`/boards/${board.id}`) })
        }}
      >
        <input
          className="input"
          aria-label="New board"
          placeholder="New board"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          type="submit"
          className="button-primary"
          disabled={!title.trim() || create.isPending}
        >
          Create
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="-mt-4 mb-4 text-sm text-red-600">
          {create.error.message}
        </p>
      )}

      {boards.isError && (
        <p role="alert" className="text-red-600">
          {boards.error.message}
        </p>
      )}
      {boards.isSuccess && boards.data.length === 0 && (
        <p className="text-zinc-500">
          No boards yet. A board is an infinite canvas to lay out your items.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {boards.data?.map((board) => (
          <li key={board.id}>
            <Link
              to={`/boards/${board.id}`}
              className="surface flex h-24 flex-col justify-between px-4 py-3 transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-700"
            >
              <span className="line-clamp-2 font-medium">{board.title}</span>
              <span className="text-xs text-zinc-500">
                {board.item_count} {board.item_count === 1 ? 'item' : 'items'} · edited{' '}
                {timeAgo(board.updated_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
