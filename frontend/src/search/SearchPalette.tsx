import { Library, LoaderCircle, Search, Waypoints } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

import { useBoards, type BoardSummary } from '../boards/api'
import { useT } from '../i18n/i18n'
import { useCollections, useSearch, type Collection, type SearchResult } from '../items/api'
import { ItemThumb } from '../items/ItemThumb'
import { itemLabel, KIND_LABEL } from '../items/label'
import { combo, MOD } from '../lib/keys'
import { useViewer } from '../viewer/context'
import { highlight, normalize, searchWords, snippet } from './match'

// Wait for a pause in typing before asking the server.
const DEBOUNCE_MS = 150
// Boards and collections are matched by name, here: there are few of them.
const PLACES_LIMIT = 5
// Markdown at the start of a line (headings, quotes, lists, tasks), left out of snippets.
const LINE_MARKERS = /^[ \t]*(?:[#>]+|[-*+]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?/gm

type Option =
  | { type: 'board'; board: BoardSummary }
  | { type: 'collection'; collection: Collection }
  | { type: 'item'; result: SearchResult; index: number }

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

function byName<T>(things: T[] | undefined, name: (thing: T) => string, words: string[]) {
  if (!words.length || !things) return []
  return things
    .filter((thing) => words.every((word) => normalize(name(thing)).includes(word)))
    .slice(0, PLACES_LIMIT)
}

/**
 * Search everything from anywhere (Ctrl/Cmd+K): boards and collections by
 * name, items by what they say. Enter opens a result (items in the viewer,
 * where ← → go through the rest), Ctrl/Cmd+Enter opens a note to edit.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const viewer = useViewer()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const q = useDebounced(query.trim())
  const words = searchWords(q)
  const search = useSearch(q)
  const results = q ? (search.data ?? []) : []
  const boards = byName(useBoards().data, (board) => board.title, words)
  const collections = byName(useCollections().data, (collection) => collection.name, words)

  const options: Option[] = [
    ...boards.map((board) => ({ type: 'board' as const, board })),
    ...collections.map((collection) => ({
      type: 'collection' as const,
      collection,
    })),
    ...results.map((result, index) => ({
      type: 'item' as const,
      result,
      index,
    })),
  ]
  const current = Math.min(active, options.length - 1)

  useEffect(() => {
    document.getElementById(`search-option-${current}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  function choose(option: Option, { edit = false } = {}) {
    onClose()
    if (option.type === 'board') navigate(`/boards/${option.board.id}`)
    else if (option.type === 'collection') navigate(`/collections/${option.collection.id}`)
    else if (edit && option.result.item.kind === 'note') navigate(`/notes/${option.result.item.id}`)
    else {
      viewer.open(
        results.map((result) => result.item),
        option.index,
        { image: option.result.album_image ?? undefined },
      )
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    // Keys stop here: the page's own shortcuts don't see them.
    event.stopPropagation()
    const mod = event.metaKey || event.ctrlKey
    if (event.key === 'Escape' || (event.key === 'k' && mod)) {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!options.length) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive((current + delta + options.length) % options.length)
    } else if (event.key === 'Enter' && options[current]) {
      event.preventDefault()
      choose(options[current], { edit: mod })
    }
  }

  const empty = q && !search.isFetching && search.isSuccess && options.length === 0
  let position = 0
  function row(option: Option, content: ReactNode) {
    const at = position++
    return (
      <li
        key={at}
        id={`search-option-${at}`}
        role="option"
        aria-selected={at === current}
        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${
          at === current ? 'bg-zinc-100 dark:bg-zinc-800' : ''
        }`}
        onMouseMove={() => at !== current && setActive(at)}
        onClick={(event) => choose(option, { edit: event.metaKey || event.ctrlKey })}
      >
        {content}
      </li>
    )
  }

  return (
    <>
      <div className="backdrop" onMouseDown={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('search.label')}
          className="popover pointer-events-auto flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden"
          onKeyDown={onKeyDown}
          // Pasting here is typing a search, not capturing.
          onPaste={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
            {search.isFetching ? (
              <LoaderCircle
                className="size-5 shrink-0 animate-spin text-zinc-400"
                aria-hidden="true"
              />
            ) : (
              <Search className="size-5 shrink-0 text-zinc-400" aria-hidden="true" />
            )}
            <input
              autoFocus
              type="search"
              role="combobox"
              aria-label={t('search.label')}
              aria-expanded={options.length > 0}
              aria-controls="search-results"
              aria-activedescendant={options.length ? `search-option-${current}` : undefined}
              placeholder={t('search.placeholder')}
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-zinc-400 [&::-webkit-search-cancel-button]:hidden"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
            />
            <kbd className="kbd hidden md:inline-flex">Esc</kbd>
          </div>

          <ul
            id="search-results"
            role="listbox"
            aria-label={t('search.results')}
            className="overflow-y-auto p-2 empty:hidden"
          >
            {boards.length > 0 && <Heading>{t('search.boards')}</Heading>}
            {boards.map((board) =>
              row(
                { type: 'board', board },
                <Place icon={<Waypoints className="size-4" aria-hidden="true" />}>
                  <Marked text={board.title} words={words} />
                </Place>,
              ),
            )}
            {collections.length > 0 && <Heading>{t('search.collections')}</Heading>}
            {collections.map((collection) =>
              row(
                { type: 'collection', collection },
                <Place icon={collection.icon || <Library className="size-4" aria-hidden="true" />}>
                  <Marked text={collection.name} words={words} />
                </Place>,
              ),
            )}
            {results.length > 0 && (boards.length > 0 || collections.length > 0) && (
              <Heading>{t('search.items')}</Heading>
            )}
            {results.map((result, index) =>
              row({ type: 'item', result, index }, <ItemRow result={result} words={words} />),
            )}
          </ul>

          {!q && (
            <p className="px-4 py-6 text-center text-sm text-zinc-500">
              {t('search.hint')}
            </p>
          )}
          {empty && <p className="px-4 py-6 text-center text-sm text-zinc-500">{t('search.nothing')}</p>}
          {search.isError && (
            <p className="px-4 py-6 text-center text-sm text-red-600 dark:text-red-400">
              {t('search.failed')}
            </p>
          )}

          <footer className="hidden items-center gap-4 border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500 md:flex dark:border-zinc-800">
            <Hint keys={['↑', '↓']}>{t('search.move')}</Hint>
            <Hint keys={['Enter']}>{t('search.open')}</Hint>
            <Hint keys={[combo('Enter')]}>{t('search.editNote')}</Hint>
            <span className="ml-auto">
              <Hint keys={[MOD, 'K']}>{t('search.close')}</Hint>
            </span>
          </footer>
        </div>
      </div>
    </>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <li
      role="presentation"
      className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-zinc-500 uppercase"
    >
      {children}
    </li>
  )
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((key) => (
        <kbd key={key} className="kbd">
          {key}
        </kbd>
      ))}
      {children}
    </span>
  )
}

function Marked({ text, words }: { text: string; words: string[] }) {
  return highlight(text, words).map((segment, i) =>
    segment.match ? (
      <mark key={i} className="rounded-sm bg-accent-100 text-inherit dark:bg-accent-500/30">
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  )
}

function Place({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
        {icon}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{children}</span>
    </>
  )
}

function ItemRow({ result, words }: { result: SearchResult; words: string[] }) {
  const t = useT()
  const { item } = result
  const image = item.album_items?.find((shown) => shown.id === result.album_image)
  // A note without a title is named after its first line: no need to repeat it.
  const body = item.kind === 'note' && !item.title ? item.body.replace(/^\s*.*/, '') : item.body
  const detail =
    snippet(body.replace(LINE_MARKERS, ''), words) ??
    snippet(item.metadata.description ?? '', words) ??
    snippet(image?.metadata.filename ?? '', words) ??
    snippet(item.url, words)

  return (
    <>
      <ItemThumb item={item} className="size-9" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            <Marked text={itemLabel(item)} words={words} />
          </span>
          {item.status === 'archived' && (
            <span className="shrink-0 rounded bg-zinc-200 px-1.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {t('search.archived')}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-zinc-500">
          {detail ? <Marked text={detail} words={words} /> : KIND_LABEL[item.kind]}
        </span>
      </span>
    </>
  )
}
