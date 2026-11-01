import { useState, type CSSProperties, type ReactNode } from 'react'

import { formatBytes } from '../lib/format'
import { timeAgo } from '../lib/time'
import { Markdown } from './Markdown'
import { OriginMark } from './OriginMark'
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

/** When it was added, and whether an assistant had a hand in it. */
function Stamp({ item }: { item: Item }) {
  return (
    <>
      <Time iso={item.created_at} />
      <OriginMark item={item} />
    </>
  )
}

function LinkPreview({
  item,
  actions,
  onView,
}: {
  item: Item
  actions?: ReactNode
  onView?: () => void
}) {
  const { metadata } = item
  const title = item.title || metadata.title || item.url

  if (item.preview_status === 'pending') {
    return (
      <div className="flex gap-4" aria-busy="true">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-sm text-zinc-500">{item.url}</p>
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
          <p className="sr-only">Fetching preview…</p>
        </div>
        <div className="skeleton h-20 w-32 shrink-0 rounded-lg" />
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
          <Stamp item={item} />
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
        <Viewable onView={onView} label="View" className="shrink-0">
          <img
            src={item.preview_image_url}
            alt=""
            loading="lazy"
            className="h-20 w-32 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800"
          />
        </Viewable>
      )}
    </div>
  )
}

/** A button that opens the item in the viewer, or just its contents when there is none. */
function Viewable({
  onView,
  label,
  className = '',
  style,
  children,
}: {
  onView?: () => void
  label: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  if (!onView) {
    return (
      <div className={`block ${className}`} style={style}>
        {children}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-label={label}
      className={`block cursor-zoom-in text-left transition hover:opacity-90 ${className}`}
      style={style}
      onClick={onView}
    >
      {children}
    </button>
  )
}

function Retry({ item }: { item: Item }) {
  const refresh = useRefreshPreview()
  return (
    <button
      type="button"
      className="font-medium text-accent-600 hover:underline disabled:opacity-50 dark:text-accent-400"
      disabled={refresh.isPending}
      onClick={() => refresh.mutate(item.id)}
    >
      Retry
    </button>
  )
}

/** What was written about an image or album when it was captured. */
function Caption({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <p className="mt-2 line-clamp-4 text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
      {text}
    </p>
  )
}

function ImagePreview({
  item,
  actions,
  onView,
}: {
  item: Item
  actions?: ReactNode
  onView?: () => void
}) {
  const { width, height, filename } = item.metadata
  return (
    <>
      {item.title && <h2 className="mb-2 font-medium">{item.title}</h2>}
      <Viewable
        onView={onView}
        label={`View ${item.title || filename || 'image'}`}
        className="w-full overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
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
      </Viewable>
      <Caption text={item.body} />
      <div className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-zinc-500">
        <Stamp item={item} />
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

function FilePreview({
  item,
  actions,
  onView,
}: {
  item: Item
  actions?: ReactNode
  onView?: () => void
}) {
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
        <Viewable onView={onView} label={`View ${name}`} className="mb-3 w-fit">
          <img
            src={preview}
            alt={name}
            loading="lazy"
            className="max-h-80 rounded-lg border border-zinc-200 bg-zinc-100 object-contain dark:border-zinc-700 dark:bg-zinc-800"
          />
        </Viewable>
      ) : (
        item.preview_status === 'pending' && (
          <div
            className="skeleton mb-3 h-40 w-32 rounded-lg"
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
          {onView ? (
            <button
              type="button"
              title={name}
              className="block max-w-full truncate text-left font-medium hover:underline"
              onClick={onView}
            >
              {name}
            </button>
          ) : (
            <a
              href={item.file_url ?? undefined}
              title={name}
              className="block truncate font-medium hover:underline"
            >
              {name}
            </a>
          )}
          <p className="truncate text-xs text-zinc-500">
            {[size !== undefined && formatBytes(size), mime].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <div className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-zinc-500">
        <Stamp item={item} />
        <div className="ml-auto">{actions}</div>
      </div>
    </>
  )
}

// An album's card shows this many of its images; the rest are a count.
const ALBUM_COVER = 4

function AlbumPreview({
  item,
  actions,
  onView,
}: {
  item: Item
  actions?: ReactNode
  onView?: () => void
}) {
  const images = item.album_items ?? []
  const shown = images.slice(0, ALBUM_COVER)
  const more = images.length - shown.length
  return (
    <>
      {item.title && <h2 className="mb-2 font-medium">{item.title}</h2>}
      <Viewable
        onView={onView}
        label={`View album of ${images.length} images`}
        className={`grid h-64 w-full grid-rows-2 gap-1 overflow-hidden rounded-lg ${
          shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
        }`}
      >
        {shown.map((image, index) => (
          <div
            key={image.id}
            // Two: side by side; three: one tall and two stacked; four: a square of them.
            className={`relative overflow-hidden bg-zinc-100 dark:bg-zinc-800 ${
              shown.length < 3 || (shown.length === 3 && index === 0) ? 'row-span-2' : ''
            }`}
          >
            {image.preview_image_url ? (
              <img
                src={image.preview_image_url}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              image.preview_status === 'pending' && <div className="size-full animate-pulse" />
            )}
            {more > 0 && index === shown.length - 1 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">
                +{more}
              </span>
            )}
          </div>
        ))}
      </Viewable>
      <Caption text={item.body} />
      <div className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-zinc-500">
        <span>{images.length} images</span>
        <span aria-hidden>·</span>
        <Stamp item={item} />
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
  onView,
}: {
  item: Item
  actions?: ReactNode
  selected?: boolean
  focused?: boolean
  onToggleSelect?: () => void
  /** Notes only: open the editor. Clicks on links and controls inside stay theirs. */
  onOpen?: () => void
  /** Open the item in the viewer (images, files, link previews). */
  onView?: () => void
}) {
  // The same selection and focus look as tiles and rows (ItemTile).
  const ring = selected
    ? 'border-accent-500 ring-2 ring-accent-500/30'
    : focused
      ? 'border-zinc-400 dark:border-zinc-600'
      : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
  return (
    <article
      aria-current={focused || undefined}
      className={`group flex gap-3 rounded-xl border bg-white p-4 shadow-xs transition dark:bg-zinc-900 ${ring}`}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          aria-label="Select"
          className={`mt-1 shrink-0 self-start accent-accent-600 transition-opacity ${selected ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
          checked={selected}
          onChange={onToggleSelect}
        />
      )}
      <div className="min-w-0 flex-1">
        <ItemContent item={item} actions={actions} onOpen={onOpen} onView={onView} />
      </div>
    </article>
  )
}

/**
 * What a card shows for each kind of item, without the card around it.
 * `onView`: clicking an image, a file or a link's picture opens the viewer
 * (absent on the canvas, where a click selects). `fill`: a note takes the
 * height it is given instead of being cut off at a fixed one.
 */
export function ItemContent({
  item,
  actions,
  onOpen,
  onView,
  fill = false,
}: {
  item: Item
  actions?: ReactNode
  /** Notes only: open the editor. Clicks on links and controls inside stay theirs. */
  onOpen?: () => void
  onView?: () => void
  fill?: boolean
}) {
  const save = useSaveNoteBody()
  if (item.kind === 'link') return <LinkPreview item={item} actions={actions} onView={onView} />
  if (item.kind === 'image') return <ImagePreview item={item} actions={actions} onView={onView} />
  if (item.kind === 'file') return <FilePreview item={item} actions={actions} onView={onView} />
  if (item.kind === 'album') return <AlbumPreview item={item} actions={actions} onView={onView} />
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
          images={item.images}
          links={item.links}
          onChange={save.isPending ? undefined : (body) => save.mutate({ item, body })}
        >
          {item.body}
        </Markdown>
      </div>
      <div className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-zinc-500">
        <Stamp item={item} />
        <div className="ml-auto">{actions}</div>
      </div>
    </div>
  )
}
