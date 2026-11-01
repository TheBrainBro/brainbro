import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  History,
  ImageMinus,
  Pencil,
  Ungroup,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'

import { NoteHistory } from '../history/HistoryPanel'
import {
  itemsKey,
  renameItem,
  updateNoteBody,
  useSetAlbumItems,
  useUngroupAlbum,
  type Item,
} from '../items/api'
import { AudioPlayer } from '../items/AudioPlayer'
import { itemLabel } from '../items/label'
import { Markdown } from '../items/Markdown'
import { originText } from '../items/origin'
import { t, useT } from '../i18n/i18n'
import { isEditable } from '../lib/dom'
import { formatBytes } from '../lib/format'
import { timeAgo } from '../lib/time'

// Text files shown as they are, up to this size; bigger ones are a download.
const TEXT_LIMIT = 512 * 1024
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|x-sh))/
const ZOOMS = [1, 1.5, 2, 3, 4]

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function describe(item: Item) {
  const { mime, size, site_name: site } = item.metadata
  // "Edited by Claude, 2 hours ago", when an assistant had a hand in it.
  const origin = originText(item)
  if (item.kind === 'link') return [site || hostname(item.url), origin].filter(Boolean).join(' · ')
  if (item.kind === 'note') return t('viewer.note', { when: origin ?? timeAgo(item.updated_at) })
  return [size !== undefined && formatBytes(size), mime, origin].filter(Boolean).join(' · ')
}

/**
 * Items full screen, over everything: images at full size with zoom, PDFs
 * in the browser's viewer, text files, audio and video, link previews and
 * notes. ← and → step through the items it was opened with (and through
 * an album's images on the way); Esc closes.
 */
export default function ItemViewer({
  items,
  index,
  actions,
  image,
  onIndex,
  onReplace,
  controls,
  onClose,
}: {
  items: Item[]
  index: number
  actions?: (item: Item, close: () => void) => ReactNode
  /** The album image to start on, if the item opened is an album. */
  image?: string
  onIndex: (index: number) => void
  /** An item changed while shown (an album edited). */
  onReplace: (item: Item) => void
  /** Triage buttons for the item shown (organize, archive, delete). */
  controls?: (item: Item) => ReactNode
  onClose: () => void
}) {
  useT()
  const item = items[index]
  const dialog = useRef<HTMLDivElement>(null)
  // Which of an album's images is shown; back to the first on another item.
  const [place, setPlace] = useState(() => {
    const start = items[index]?.album_items?.findIndex((shown) => shown.id === image) ?? -1
    return start > 0 ? { id: items[index].id, at: start } : { id: '', at: 0 }
  })
  // The note whose history is open, instead of the note itself.
  const [history, setHistory] = useState<string | null>(null)
  const showHistory = item?.kind === 'note' && history === item.id
  const images = item?.kind === 'album' ? (item.album_items ?? []) : []
  const at = place.id === item?.id ? Math.min(place.at, Math.max(images.length - 1, 0)) : 0
  const canBack = at > 0 || index > 0
  const canForward = (images.length > 0 && at < images.length - 1) || index < items.length - 1

  function step(delta: number) {
    const inside = at + delta
    if (images.length > 0 && inside >= 0 && inside < images.length) {
      setPlace({ id: item.id, at: inside })
      return
    }
    const next = index + delta
    if (next >= 0 && next < items.length) onIndex(next)
  }

  // Focus comes in, and goes back where it was on closing.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])

  if (!item) return null
  const shown = images[at]
  const original = item.kind === 'link' ? item.url : (shown ?? item).file_url

  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={itemLabel(item)}
      tabIndex={-1}
      className="viewer fixed inset-0 z-50 flex flex-col bg-zinc-950/90 text-zinc-100 outline-none backdrop-blur-sm"
      // Keys stop here: the page's own shortcuts (j/k, Delete on a board) don't see them.
      onKeyDown={(event) => {
        event.stopPropagation()
        // Typing a caption: arrows move the cursor, Esc leaves the field (saving it).
        if (isEditable(event.target)) {
          if (event.key === 'Escape') (event.target as HTMLElement).blur()
          return
        }
        if (event.key === 'Escape') onClose()
        else if (event.key === 'ArrowLeft') step(-1)
        else if (event.key === 'ArrowRight') step(1)
      }}
      onPaste={(event) => event.stopPropagation()}
    >
      <header className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          {item.kind === 'file' || item.kind === 'image' || item.kind === 'audio' ? (
            <NameField key={item.id} item={item} onSaved={onReplace} />
          ) : (
            <h2 className="truncate font-medium">{itemLabel(item)}</h2>
          )}
          <p className="truncate text-xs text-zinc-400">
            {shown ? t('viewer.albumImage', { at: at + 1, total: images.length }) : describe(item)}
            {items.length > 1 && t('viewer.position', { at: index + 1, total: items.length })}
          </p>
        </div>
        {actions?.(item, onClose)}
        {item.kind === 'note' && (
          <button
            type="button"
            className="viewer-button"
            aria-pressed={showHistory}
            onClick={() => setHistory(showHistory ? null : item.id)}
          >
            <History className="size-4" aria-hidden="true" />
            {t('viewer.history')}
          </button>
        )}
        {item.kind === 'note' && (
          <Link to={`/notes/${item.id}`} className="viewer-button" onClick={onClose}>
            <Pencil className="size-4" aria-hidden="true" />
            {t('viewer.edit')}
          </Link>
        )}
        {original && item.kind === 'link' && (
          <a href={original} target="_blank" rel="noopener noreferrer" className="viewer-button">
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('viewer.openOriginal')}
          </a>
        )}
        {original && item.kind !== 'link' && (
          <a href={original} download className="viewer-button">
            <Download className="size-4" aria-hidden="true" />
            {t('viewer.download')}
          </a>
        )}
        {controls?.(item)}
        <button type="button" aria-label={t('common.close')} className="viewer-icon" onClick={onClose}>
          <X className="size-5" aria-hidden="true" />
        </button>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16"
        onClick={(event) => event.target === event.currentTarget && onClose()}
      >
        {showHistory ? (
          <NoteHistory note={item} onRestored={onReplace} onClose={() => setHistory(null)} />
        ) : item.kind === 'album' ? (
          <AlbumView
            album={item}
            at={at}
            onAt={(next) => setPlace({ id: item.id, at: next })}
            onReplace={onReplace}
            onUngrouped={onClose}
          />
        ) : (
          <Content key={item.id} item={item} onClose={onClose} />
        )}
        {canBack && (
          <button
            type="button"
            aria-label={t('viewer.previous')}
            className="viewer-icon absolute top-1/2 left-2 -translate-y-1/2 sm:left-4"
            onClick={() => step(-1)}
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </button>
        )}
        {canForward && (
          <button
            type="button"
            aria-label={t('viewer.next')}
            className="viewer-icon absolute top-1/2 right-2 -translate-y-1/2 sm:right-4"
            onClick={() => step(1)}
          >
            <ChevronRight className="size-6" aria-hidden="true" />
          </button>
        )}
      </div>
      {(item.kind === 'image' || item.kind === 'audio' || item.kind === 'album') && (
        <CaptionEditor key={item.id} item={item} onSaved={onReplace} />
      )}
    </div>,
    document.body,
  )
}

function Content({ item, onClose }: { item: Item; onClose: () => void }) {
  const mime = item.metadata.mime ?? ''
  if (item.kind === 'image') return <ImageView item={item} />
  if (item.kind === 'link') return <LinkView item={item} />
  if (item.kind === 'note') {
    return (
      <div className="viewer-sheet max-w-3xl">
        {item.title && <h1 className="mb-3 text-2xl font-semibold">{item.title}</h1>}
        <Markdown
          id={`viewer-${item.id}`}
          fill
          images={item.images}
          links={item.links}
          embeds
          onFollow={onClose}
        >
          {item.body}
        </Markdown>
      </div>
    )
  }
  if (mime === 'application/pdf') return <PdfView item={item} />
  if (mime === 'image/svg+xml') return <ImageView item={item} />
  if (mime.startsWith('video/')) {
    return (
      <video src={item.file_url ?? undefined} controls autoPlay className="max-h-full max-w-full" />
    )
  }
  if (item.kind === 'audio' || mime.startsWith('audio/')) {
    return (
      <AudioPlayer
        src={item.file_url}
        size={item.metadata.size}
        autoPlay
        className="w-full max-w-xl rounded-2xl bg-zinc-900/80 p-4"
      />
    )
  }
  if (TEXT_TYPES.test(mime) && (item.metadata.size ?? 0) <= TEXT_LIMIT) {
    return <TextView item={item} />
  }
  return <NoPreview item={item} />
}

/**
 * A file's or image's name, as a field: click it to rename. Enter or leaving
 * it saves; Esc puts it back as it was. Without an extension, it keeps its own.
 */
function NameField({ item, onSaved }: { item: Item; onSaved: (item: Item) => void }) {
  useT()
  const queryClient = useQueryClient()
  const saved = item.metadata.filename ?? ''
  const [name, setName] = useState(saved)
  const [error, setError] = useState('')
  // Esc: the blur that follows doesn't save.
  const cancelled = useRef(false)

  async function save() {
    const next = name.trim()
    if (cancelled.current || !next || next === saved) {
      cancelled.current = false
      setName(saved)
      return
    }
    try {
      const renamed = await renameItem(item.id, next)
      setError('')
      onSaved(renamed)
      queryClient.invalidateQueries({ queryKey: itemsKey })
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  return (
    <>
      <input
        aria-label={t('viewer.name')}
        className="-mx-2 w-full truncate rounded-md bg-transparent px-2 py-0.5 font-medium text-zinc-100 transition outline-none hover:bg-white/10 focus:bg-white/10"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => {
          // The name without its extension, ready to type over.
          const dot = event.target.value.lastIndexOf('.')
          event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length)
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          // The viewer blurs it on Esc.
          else if (event.key === 'Escape') cancelled.current = true
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * What an image, recording or album is about, written under it: the context that only
 * exists in your head when you capture it. Saved when the field is left.
 */
function CaptionEditor({ item, onSaved }: { item: Item; onSaved: (item: Item) => void }) {
  useT()
  const queryClient = useQueryClient()
  const [text, setText] = useState(item.body)
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const saved = useRef(item)
  const field = useRef<HTMLTextAreaElement>(null)

  // Grows with the text, up to a few lines.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [text])

  async function save() {
    if (text === saved.current.body) return
    setState('saving')
    try {
      saved.current = await updateNoteBody(item.id, text, saved.current.version)
      setState('idle')
      onSaved(saved.current)
      queryClient.invalidateQueries({ queryKey: itemsKey })
    } catch {
      setState('error')
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-4">
      <textarea
        ref={field}
        rows={1}
        aria-label={t('viewer.caption')}
        placeholder={t('viewer.captionPlaceholder')}
        className="max-h-40 w-full resize-none rounded-lg border border-transparent bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 transition outline-none placeholder:text-zinc-500 hover:border-zinc-700 focus:border-zinc-600"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.blur()
        }}
      />
      {state !== 'idle' && (
        <p role={state === 'error' ? 'alert' : 'status'} className="mt-1 text-xs text-zinc-400">
          {state === 'saving' ? t('viewer.saving') : (
            <>
              {t('viewer.captionFailed')}{' '}
              <button type="button" className="underline" onClick={save}>
                {t('viewer.retry')}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * An album: one image at a time over a strip of all of them, where the
 * shown one can be moved or taken out, and the album ungrouped.
 */
function AlbumView({
  album,
  at,
  onAt,
  onReplace,
  onUngrouped,
}: {
  album: Item
  at: number
  onAt: (at: number) => void
  onReplace: (album: Item) => void
  onUngrouped: () => void
}) {
  useT()
  const images = album.album_items ?? []
  const setItems = useSetAlbumItems()
  const ungroup = useUngroupAlbum()
  const busy = setItems.isPending || ungroup.isPending
  const shown = images[at]

  function save(ids: string[], nextAt: number) {
    setItems.mutate(
      { album: album.id, ids },
      {
        onSuccess: (updated) => {
          onReplace(updated)
          onAt(nextAt)
        },
      },
    )
  }
  function move(delta: number) {
    const ids = images.map((image) => image.id)
    ;[ids[at], ids[at + delta]] = [ids[at + delta], ids[at]]
    save(ids, at + delta)
  }

  return (
    <div className="flex size-full flex-col items-center gap-3">
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        {shown && <ImageView key={shown.id} item={shown} />}
      </div>
      <div className="flex max-w-full flex-col items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="viewer-button"
            disabled={busy || at === 0}
            onClick={() => move(-1)}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('viewer.moveEarlier')}
          </button>
          <button
            type="button"
            className="viewer-button"
            disabled={busy || at === images.length - 1}
            onClick={() => move(1)}
          >
            {t('viewer.moveLater')}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="viewer-button"
            disabled={busy || images.length < 2}
            title={t('viewer.takeOutHint')}
            onClick={() =>
              save(
                images.filter((image) => image !== shown).map((image) => image.id),
                Math.max(at - 1, 0),
              )
            }
          >
            <ImageMinus className="size-4" aria-hidden="true" />
            {t('viewer.takeOut')}
          </button>
          <button
            type="button"
            className="viewer-button"
            disabled={busy}
            title={t('viewer.ungroupHint')}
            onClick={() => ungroup.mutate(album.id, { onSuccess: onUngrouped })}
          >
            <Ungroup className="size-4" aria-hidden="true" />
            {t('viewer.ungroup')}
          </button>
        </div>
        <div role="listbox" aria-label={t('viewer.images')} className="flex max-w-full gap-1.5 overflow-x-auto p-1">
          {images.map((image, position) => (
            <button
              key={image.id}
              type="button"
              role="option"
              aria-selected={position === at}
              aria-label={t('viewer.image', { number: position + 1 })}
              className={`size-14 shrink-0 overflow-hidden rounded-md transition ${
                position === at ? 'ring-2 ring-accent-400' : 'opacity-60 hover:opacity-100'
              }`}
              onClick={() => onAt(position)}
            >
              {image.preview_image_url && (
                <img src={image.preview_image_url} alt="" className="size-full object-cover" />
              )}
            </button>
          ))}
        </div>
        {(setItems.isError || ungroup.isError) && (
          <p role="alert" className="text-sm text-red-400">
            {(setItems.error ?? ungroup.error)?.message}
          </p>
        )}
      </div>
    </div>
  )
}

function ImageView({ item }: { item: Item }) {
  useT()
  const [zoom, setZoom] = useState(0)
  const src = item.file_url ?? item.preview_image_url ?? undefined
  const fitted = zoom === 0
  const { width } = item.metadata

  return (
    <>
      <div className={`flex size-full ${fitted ? 'items-center justify-center' : 'overflow-auto'}`}>
        <img
          src={src}
          alt={itemLabel(item)}
          draggable={false}
          className={`m-auto select-none ${
            fitted ? 'max-h-full max-w-full cursor-zoom-in object-contain' : 'max-w-none cursor-zoom-out'
          }`}
          style={fitted || !width ? undefined : { width: width * ZOOMS[zoom - 1] }}
          onClick={() => setZoom(fitted ? 1 : 0)}
        />
      </div>
      {width && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900/80 p-1">
          <button
            type="button"
            aria-label={t('viewer.zoomOut')}
            className="viewer-icon size-8"
            disabled={fitted}
            onClick={() => setZoom(zoom - 1)}
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </button>
          <span className="w-14 text-center text-xs tabular-nums">
            {fitted ? t('viewer.fit') : `${ZOOMS[zoom - 1] * 100}%`}
          </span>
          <button
            type="button"
            aria-label={t('viewer.zoomIn')}
            className="viewer-icon size-8"
            disabled={zoom === ZOOMS.length}
            onClick={() => setZoom(zoom + 1)}
          >
            <ZoomIn className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  )
}

/**
 * The server sends PDFs as downloads (nothing uploaded runs on our origin),
 * so it is fetched and shown from memory, in the browser's own PDF viewer.
 */
function PdfView({ item }: { item: Item }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!item.file_url) return
    let objectUrl: string | null = null
    let cancelled = false
    fetch(item.file_url, { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(response.statusText)
        return response.blob()
      })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
        setUrl(objectUrl)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.file_url])

  if (failed) return <NoPreview item={item} />
  if (!url) return <Loading />
  return (
    <iframe
      title={itemLabel(item)}
      src={url}
      className="size-full max-w-5xl rounded-lg bg-white shadow-2xl"
    />
  )
}

function TextView({ item }: { item: Item }) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!item.file_url) return
    let cancelled = false
    fetch(item.file_url, { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(response.statusText)
        return response.text()
      })
      .then((body) => !cancelled && setText(body))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [item.file_url])

  if (failed) return <NoPreview item={item} />
  if (text === null) return <Loading />
  return (
    <pre className="viewer-sheet max-w-4xl font-mono text-sm whitespace-pre-wrap">{text}</pre>
  )
}

function LinkView({ item }: { item: Item }) {
  const { metadata } = item
  return (
    <div className="viewer-sheet max-w-2xl p-0">
      {item.preview_image_url && (
        <img
          src={item.preview_image_url}
          alt=""
          className="max-h-[50vh] w-full rounded-t-2xl object-cover"
        />
      )}
      <div className="p-6">
        <h1 className="text-xl font-semibold">{item.title || metadata.title || item.url}</h1>
        {metadata.description && (
          <p className="mt-2 text-zinc-600 dark:text-zinc-300">{metadata.description}</p>
        )}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent-600 hover:underline dark:text-accent-300"
        >
          {hostname(item.url)}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}

function NoPreview({ item }: { item: Item }) {
  useT()
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <FileText className="size-16 text-zinc-500" strokeWidth={1.25} aria-hidden="true" />
      <p className="text-sm text-zinc-400">{t('viewer.noPreview')}</p>
      {item.file_url && (
        <a href={item.file_url} download className="button-primary inline-flex items-center gap-2">
          <Download className="size-4" aria-hidden="true" />
          {t('viewer.download')}
        </a>
      )}
    </div>
  )
}

function Loading() {
  return <div className="size-10 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
}
