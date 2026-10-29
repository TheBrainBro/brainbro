import { useState, type ReactNode } from 'react'

import { formatBytes } from '../lib/format'
import { timeAgo } from '../lib/time'
import { Markdown } from './Markdown'
import { useRefreshPreview, useSaveNoteBody, type Item } from './api'

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Favicon({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return null
  return (
    <img
      src={src}
      alt=""
      className="size-4 shrink-0 rounded-sm"
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  )
}

function Time({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className="shrink-0">
      {timeAgo(iso)}
    </time>
  )
}

function LinkPreview({ item, actions }: { item: Item; actions?: ReactNode }) {
  const { metadata } = item
  const title = item.title || metadata.title || item.url

  if (item.preview_status === 'pending') {
    return (
      <div className="flex gap-4" aria-busy="true">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-sm text-zinc-500">{item.url}</p>
          <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <p className="sr-only">Fetching preview…</p>
        </div>
        <div className="h-20 w-32 shrink-0 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    )
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 font-medium hover:underline"
        >
          {title}
        </a>
        {metadata.description && (
          <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
            {metadata.description}
          </p>
        )}
        <div className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-zinc-500">
          <Favicon src={metadata.favicon_url} />
          <span className="truncate">{metadata.site_name || hostname(item.url)}</span>
          <span aria-hidden>·</span>
          <Time iso={item.created_at} />
          {item.preview_status === 'failed' && (
            <>
              <span aria-hidden>·</span>
              <span>Preview unavailable</span>
              <Retry item={item} />
            </>
          )}
          <div className="ml-auto">{actions}</div>
        </div>
      </div>
      {item.preview_image_url && (
        <img
          src={item.preview_image_url}
          alt=""
          loading="lazy"
          className="h-20 w-32 shrink-0 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800"
        />
      )}
    </div>
  )
}

function Retry({ item }: { item: Item }) {
  const refresh = useRefreshPreview()
  return (
    <button
      type="button"
      className="font-medium text-zinc-700 hover:underline disabled:opacity-50 dark:text-zinc-300"
      disabled={refresh.isPending}
      onClick={() => refresh.mutate(item.id)}
    >
      Retry
    </button>
  )
}

function ImagePreview({
  item,
  actions,
  linkFile,
}: {
  item: Item
  actions?: ReactNode
  linkFile: boolean
}) {
  const { width, height, filename } = item.metadata
  const Frame = linkFile ? 'a' : 'div'
  return (
    <>
      {item.title && <h2 className="mb-2 font-medium">{item.title}</h2>}
      <Frame
        {...(linkFile && { href: item.file_url ?? undefined, target: '_blank', rel: 'noopener' })}
        className="block overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
        // Reserve the space before the thumbnail loads, so cards don't jump.
        style={
          width && height ? { aspectRatio: `${width} / ${height}`, maxHeight: '20rem' } : undefined
        }
      >
        {item.preview_image_url ? (
          <img
            src={item.preview_image_url}
            alt={item.title || filename || 'Image'}
            loading="lazy"
            className="mx-auto h-full max-h-80 object-contain"
          />
        ) : item.preview_status === 'pending' ? (
          <div className="h-full min-h-32 animate-pulse" aria-busy="true">
            <span className="sr-only">Making thumbnail…</span>
          </div>
        ) : (
          <div className="flex h-full min-h-20 items-center justify-center text-sm text-zinc-500">
            {filename || 'Image'}
          </div>
        )}
      </Frame>
      <div className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-zinc-500">
        <Time iso={item.created_at} />
        {item.preview_status === 'failed' && (
          <>
            <span aria-hidden>·</span>
            <span>Thumbnail unavailable</span>
            <Retry item={item} />
          </>
        )}
        <div className="ml-auto">{actions}</div>
      </div>
    </>
  )
}

function FilePreview({ item, actions }: { item: Item; actions?: ReactNode }) {
  const { filename, mime, size } = item.metadata
  const extension = filename?.includes('.') ? filename.split('.').pop()!.slice(0, 4) : 'file'
  const name = item.title || filename || 'File'
  // PDFs get their first page rendered in the background. SVGs are safe to
  // show as they are: in an <img> they run no scripts and load nothing
  // external, and opening the file itself is a sandboxed download.
  const preview = item.preview_image_url ?? (mime === 'image/svg+xml' ? item.file_url : null)
  return (
    <>
      {preview ? (
        <img
          src={preview}
          alt={name}
          loading="lazy"
          className="mb-3 max-h-80 rounded-lg border border-zinc-200 bg-zinc-100 object-contain dark:border-zinc-700 dark:bg-zinc-800"
        />
      ) : (
        item.preview_status === 'pending' && (
          <div
            className="mb-3 h-40 w-32 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"
            aria-busy="true"
          >
            <span className="sr-only">Making preview…</span>
          </div>
        )
      )}
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-[10px] font-semibold text-zinc-500 uppercase dark:border-zinc-700 dark:bg-zinc-800"
        >
          {extension}
        </div>
        <div className="min-w-0 flex-1">
          <a
            href={item.file_url ?? undefined}
            title={name}
            className="block truncate font-medium hover:underline"
          >
            {name}
          </a>
          <p className="truncate text-xs text-zinc-500">
            {[size !== undefined && formatBytes(size), mime].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <div className="mt-2 flex min-h-6 items-center text-xs text-zinc-500">
        <Time iso={item.created_at} />
        <div className="ml-auto">{actions}</div>
      </div>
    </>
  )
}

export function ItemCard({
  item,
  actions,
  selected = false,
  focused = false,
  onToggleSelect,
  onOpen,
}: {
  item: Item
  actions?: ReactNode
  selected?: boolean
  focused?: boolean
  onToggleSelect?: () => void
  /** Notes only: open the editor. Clicks on links and controls inside stay theirs. */
  onOpen?: () => void
}) {
  const ring = selected
    ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100'
    : focused
      ? 'border-zinc-400 dark:border-zinc-600'
      : 'border-zinc-200 dark:border-zinc-800'
  return (
    <article
      aria-current={focused || undefined}
      className={`group flex gap-3 rounded-xl border bg-white p-4 shadow-xs dark:bg-zinc-900 ${ring}`}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          aria-label="Select"
          className={`mt-1 shrink-0 self-start ${selected ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
          checked={selected}
          onChange={onToggleSelect}
        />
      )}
      <div className="min-w-0 flex-1">
        <ItemContent item={item} actions={actions} onOpen={onOpen} />
      </div>
    </article>
  )
}

/**
 * What a card shows for each kind of item, without the card around it.
 * `linkFile`: clicking an image opens the original (off on the canvas, where
 * a click selects). `fill`: a note takes the height it is given instead of
 * being cut off at a fixed one.
 */
export function ItemContent({
  item,
  actions,
  onOpen,
  linkFile = true,
  fill = false,
}: {
  item: Item
  actions?: ReactNode
  /** Notes only: open the editor. Clicks on links and controls inside stay theirs. */
  onOpen?: () => void
  linkFile?: boolean
  fill?: boolean
}) {
  const save = useSaveNoteBody()
  if (item.kind === 'link') return <LinkPreview item={item} actions={actions} />
  if (item.kind === 'image') return <ImagePreview item={item} actions={actions} linkFile={linkFile} />
  if (item.kind === 'file') return <FilePreview item={item} actions={actions} />
  return (
    <div className={fill ? 'flex h-full flex-col' : undefined}>
      <div
        className={`${onOpen ? 'cursor-text' : ''} ${fill ? 'min-h-0 flex-1' : ''}`}
        onClick={(event) => {
          const target = event.target as HTMLElement
          if (!target.closest('a, button, input') && !window.getSelection()?.toString()) {
            onOpen?.()
          }
        }}
      >
        {item.title && <h2 className="mb-1 font-medium">{item.title}</h2>}
        {/* One tick at a time: each save needs the version the last one returned. */}
        <Markdown
          id={item.id}
          fill={fill}
          onChange={save.isPending ? undefined : (body) => save.mutate({ item, body })}
        >
          {item.body}
        </Markdown>
      </div>
      <div className="mt-2 flex min-h-6 items-center text-xs text-zinc-500">
        <Time iso={item.created_at} />
        <div className="ml-auto">{actions}</div>
      </div>
    </div>
  )
}
