import { useState } from 'react'

import { useT } from '../i18n/i18n'
import { useCreateBoard, type BoardSummary } from './api'

/** Names a new board, the way a new collection is named. */
export function BoardDialog({
  onCreated,
  onClose,
}: {
  onCreated: (board: BoardSummary) => void
  onClose: () => void
}) {
  const t = useT()
  const create = useCreateBoard()
  const [title, setTitle] = useState('')

  return (
    <div
      className="backdrop flex items-start justify-center overflow-auto p-4 pt-[10vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-dialog-title"
        className="popover w-full max-w-md p-5"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim() || create.isPending) return
          create.mutate(title.trim(), { onSuccess: onCreated })
        }}
      >
        <h2 id="board-dialog-title" className="mb-4 font-semibold">
          {t('boards.new')}
        </h2>
        <label className="mb-1 block text-sm font-medium" htmlFor="board-title">
          {t('boards.name')}
        </label>
        <input
          id="board-title"
          data-tutorial="board-title"
          className="input"
          placeholder={t('boards.namePlaceholder')}
          autoFocus
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {create.isError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {create.error.message}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="button-primary"
            disabled={!title.trim() || create.isPending}
          >
            {t('boards.create')}
          </button>
        </div>
      </form>
    </div>
  )
}
