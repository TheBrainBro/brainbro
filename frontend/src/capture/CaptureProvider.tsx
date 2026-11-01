import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

import { useSession } from '../auth/session'
import { t, useT } from '../i18n/i18n'
import { itemsKey, makeAlbum, ungroupAlbum, type Item } from '../items/api'
import { api, ApiError, upload } from '../lib/api'
import { isEditable } from '../lib/dom'
import { formatBytes } from '../lib/format'
import { useFeedback, type Toast } from '../ui/feedback'
import { isClaimed } from './claims'
import {
  CaptureContext,
  type CaptureDestination,
  type CaptureOptions,
  type CaptureResult,
  type CaptureTarget,
  type PendingCapture,
} from './context'
import { isCapturableDrag, toCaptureInputs, type CaptureInput, type CaptureInputs } from './inputs'

const MAX_PARALLEL_UPLOADS = 3
const TOAST_MS = 6000
const CAPTURE_TOAST = 'capture'

type Batch = {
  id: string
  total: number
  undoable: boolean
  retryLater: boolean
  created: string[]
  /** Kept by the caller to send later (see `retryLater`). */
  deferred: string[]
  failed: { label: string; error: string }[]
  settled: boolean
  undone: boolean
  /** Group the images into an album once all of them are in. */
  album: boolean
  /** Created images, by the position of their input. */
  images: Map<number, string>
  /** Where each entry's input was, to keep the album in the order given. */
  positions: Map<string, number>
  albumId?: string
  /** The collection it all went into, for the toast. */
  into?: CaptureDestination
}

function labelOf(input: CaptureInput) {
  if (input.kind === 'file') return input.file.name || t('capturing.pastedFile')
  return input.kind === 'url' ? input.url : input.text
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Worth sending again later: no network, no session, or the server failed. */
function isTransient(error: unknown) {
  if (!(error instanceof ApiError)) return true
  return error.status >= 500 || [401, 403, 408, 429].includes(error.status)
}

/**
 * The one capture pipeline. Pastes and drops anywhere in the app, and the
 * capture box, all come through here: each input becomes an optimistic card
 * (with upload progress for files) until the server item replaces it. They
 * land in the inbox, or in the collection that is open.
 */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const feedback = useFeedback()
  const { data: session } = useSession()
  const maxSize = session?.limits?.upload_max_size

  const [pending, setPending] = useState<PendingCapture[]>([])
  const [toast, setToast] = useState<Batch | null>(null)
  const [dragging, setDragging] = useState(false)
  // The drag is over something that takes the drop itself (a note).
  const [overClaimed, setOverClaimed] = useState(false)

  const controllers = useRef(new Map<string, AbortController>())
  const settlers = useRef(new Map<string, (result: CaptureResult) => void>())
  const observers = useRef(new Map<string, (result: CaptureResult) => void>())
  const [target, setTarget] = useState<CaptureTarget | null>(null)
  const [destination, setDestination] = useState<CaptureDestination | null>(null)
  const batches = useRef(new Map<string, Batch>())
  const queue = useRef<PendingCapture[]>([])
  const running = useRef(0)

  function update(id: string, changes: Partial<PendingCapture>) {
    setPending((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)),
    )
  }

  function remove(id: string) {
    setPending((current) => {
      const entry = current.find((candidate) => candidate.id === id)
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl)
      return current.filter((candidate) => candidate.id !== id)
    })
    controllers.current.delete(id)
  }

  function showBatch(batch: Batch) {
    // A copy, so React sees each change.
    setToast((current) => (current === null || current.id === batch.id ? { ...batch } : current))
  }

  function settle(entry: PendingCapture, result: CaptureResult) {
    settlers.current.get(entry.id)?.(result)
    settlers.current.delete(entry.id)
    const observer = observers.current.get(entry.id)
    if (!('error' in result) || result.deferred) observers.current.delete(entry.id)
    observer?.(result)
    const batch = batches.current.get(entry.batch)
    if (!batch) return
    if ('item' in result) {
      batch.created.push(result.item.id)
      if (result.item.kind === 'image') {
        batch.images.set(batch.positions.get(entry.id)!, result.item.id)
      }
    } else if (result.deferred) batch.deferred.push(entry.label)
    else batch.failed.push({ label: entry.label, error: result.error })
    const wasSettled = batch.settled
    batch.settled =
      batch.created.length + batch.deferred.length + batch.failed.length === batch.total
    if (batch.settled && !wasSettled) groupImages(batch)
    if (batch.undoable) showBatch(batch)
  }

  /** Images captured together become one album (once, when the batch is first all in). */
  async function groupImages(batch: Batch) {
    if (!batch.album || batch.undone || batch.albumId || batch.images.size < 2) return
    const ids = [...batch.images.entries()].sort(([a], [b]) => a - b).map(([, id]) => id)
    try {
      const album = await makeAlbum(ids)
      batch.albumId = album.id
      await queryClient.invalidateQueries({ queryKey: itemsKey })
      if (batch.undoable) showBatch(batch)
    } catch {
      // They stay as separate images: nothing is lost.
    }
  }

  async function separate(batch: Batch) {
    const albumId = batch.albumId
    if (!albumId) return
    batch.albumId = undefined
    batch.album = false
    showBatch(batch)
    await ungroupAlbum(albumId)
    await queryClient.invalidateQueries({ queryKey: itemsKey })
  }

  async function send(entry: PendingCapture, signal: AbortSignal) {
    const input = entry.input!
    const collection = entry.collection ? { collection: entry.collection } : {}
    if (input.kind !== 'file') {
      const payload =
        input.kind === 'url'
          ? { text: input.url, ...collection }
          : input.kind === 'note'
            ? { text: input.text, kind: 'note', ...collection }
            : { text: input.text, ...collection }
      return api<Item>('/items/capture/', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      })
    }
    const form = new FormData()
    form.append('file', input.file)
    if (entry.collection) form.append('collection', entry.collection)
    return upload<Item>('/items/capture/', form, {
      signal,
      onProgress: (progress) => update(entry.id, { progress }),
    })
  }

  async function run(entry: PendingCapture) {
    const controller = new AbortController()
    controllers.current.set(entry.id, controller)
    update(entry.id, { state: 'uploading', progress: 0, error: undefined })
    try {
      const item = await send(entry, controller.signal)
      const batch = batches.current.get(entry.batch)
      if (batch?.undone) {
        // Undo came while the response was on its way.
        await api('/items/triage/', {
          method: 'POST',
          body: JSON.stringify({ ids: [item.id], action: 'delete' }),
        })
        return
      }
      // Swap in the server item once the list has it, so nothing flickers.
      await queryClient.invalidateQueries({ queryKey: itemsKey })
      remove(entry.id)
      settle(entry, { id: entry.id, item })
    } catch (error) {
      if (isAbort(error)) return
      const message = error instanceof Error ? error.message : t('capturing.failed')
      if (batches.current.get(entry.batch)?.retryLater && isTransient(error)) {
        remove(entry.id)
        settle(entry, { id: entry.id, error: message, deferred: true })
        return
      }
      update(entry.id, { state: 'error', error: message, retryable: true })
      settle(entry, { id: entry.id, error: message })
    }
  }

  function pump() {
    while (running.current < MAX_PARALLEL_UPLOADS && queue.current.length) {
      const entry = queue.current.shift()!
      running.current++
      run(entry).finally(() => {
        running.current--
        pump()
      })
    }
  }

  /** Refuse what the server would refuse anyway, before uploading a byte. */
  function precheck(input: CaptureInput) {
    if (input.kind !== 'file') return undefined
    if (input.file.size === 0) return t('capturing.empty')
    if (maxSize && input.file.size > maxSize) {
      return t('capturing.tooLarge', { max: formatBytes(maxSize) })
    }
    return undefined
  }

  function capture(
    found: CaptureInputs,
    { undo = true, retryLater = false, album = true, into, onQueued, onSettled }: CaptureOptions = {},
  ) {
    const batchId = crypto.randomUUID()
    const entries: PendingCapture[] = []
    const promises: Promise<CaptureResult>[] = []
    const refused: { label: string; error: string }[] = []

    for (const input of found.inputs) {
      const error = precheck(input)
      const isImage = input.kind === 'file' && input.file.type.startsWith('image/')
      const entry: PendingCapture = {
        id: crypto.randomUUID(),
        batch: batchId,
        label: labelOf(input),
        input,
        state: error ? 'error' : 'queued',
        progress: 0,
        error,
        retryable: false,
        previewUrl: !error && isImage ? URL.createObjectURL(input.file) : undefined,
        collection: into?.id,
      }
      entries.push(entry)
      if (error) {
        refused.push({ label: entry.label, error })
        promises.push(Promise.resolve({ id: entry.id, error }))
      } else {
        promises.push(new Promise((resolve) => settlers.current.set(entry.id, resolve)))
      }
    }
    for (const skipped of found.skipped) {
      const error = skipped.reason
      entries.push({
        id: crypto.randomUUID(),
        batch: batchId,
        label: skipped.name,
        state: 'error',
        progress: 0,
        error,
        retryable: false,
        collection: into?.id,
      })
      refused.push({ label: skipped.name, error })
    }
    if (!entries.length) return Promise.resolve([])

    const batch: Batch = {
      id: batchId,
      total: entries.length,
      undoable: undo,
      retryLater,
      created: [],
      deferred: [],
      failed: refused,
      settled: refused.length === entries.length,
      undone: false,
      album,
      images: new Map(),
      positions: new Map(entries.map((entry, position) => [entry.id, position])),
      into,
    }
    batches.current.set(batchId, batch)
    if (onSettled) {
      for (const entry of entries) {
        if (entry.state === 'queued') observers.current.set(entry.id, onSettled)
      }
    }
    onQueued?.(entries.map((entry) => entry.id))
    setPending((current) => [...entries, ...current])
    if (undo) setToast({ ...batch })

    queue.current.push(...entries.filter((entry) => entry.state === 'queued'))
    pump()
    return Promise.all(promises)
  }

  function retry(id: string) {
    const entry = pending.find((candidate) => candidate.id === id)
    if (!entry?.input || !entry.retryable) return
    const batch = batches.current.get(entry.batch)
    if (batch) {
      batch.failed = batch.failed.filter((failure) => failure.label !== entry.label)
      batch.settled = false
    }
    update(id, { state: 'queued', error: undefined, progress: 0 })
    queue.current.push(entry)
    pump()
  }

  function dismiss(id: string) {
    observers.current.delete(id)
    remove(id)
  }

  async function undoBatch(batch: Batch) {
    batch.undone = true
    setToast(null)
    queue.current = queue.current.filter((entry) => entry.batch !== batch.id)
    for (const entry of pending.filter((candidate) => candidate.batch === batch.id)) {
      controllers.current.get(entry.id)?.abort()
      remove(entry.id)
    }
    if (batch.created.length) {
      // The album too, if they were grouped (deleting it takes its images).
      const ids = batch.albumId ? [...batch.created, batch.albumId] : batch.created
      await api('/items/triage/', {
        method: 'POST',
        body: JSON.stringify({ ids, action: 'delete' }),
      })
      await queryClient.invalidateQueries({ queryKey: itemsKey })
    }
  }

  // Stable, so a target registers once.
  const register = useCallback((next: CaptureTarget) => {
    setTarget(next)
    return () => setTarget((current) => (current === next ? null : current))
  }, [])

  const registerDestination = useCallback((next: CaptureDestination) => {
    setDestination(next)
    return () => setDestination((current) => (current === next ? null : current))
  }, [])

  const here = destination ? { into: destination } : undefined

  // One toast for the batch on screen, kept in step with it.
  const showToast = useEffectEvent((batch: Batch | null) => {
    if (!batch) return feedback.dismissToast(CAPTURE_TOAST)
    feedback.toast(
      batchToast(
        batch,
        () => undoBatch(batches.current.get(batch.id)!),
        () => separate(batches.current.get(batch.id)!),
      ),
    )
  })
  useEffect(() => showToast(toast), [toast])

  // The toast stays while the batch is in flight, then a few seconds more.
  useEffect(() => {
    if (!toast?.settled) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  // Paste and drop anywhere. Drags that start inside the app (a link in a
  // card) are not captures.
  const dragDepth = useRef(0)
  const internalDrag = useRef(false)
  const cancelled = useRef(false)

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const data = event.clipboardData
    if (!data || isClaimed(event)) return
    // Text fields keep their own paste, unless it's a file they can't hold.
    // An editor that already took the paste (CodeMirror) may have replaced
    // the target node by now, so a handled paste counts as a text field's.
    const handled = event.defaultPrevented || isEditable(event.target)
    if (handled && !data.types.includes('Files')) return
    const found = toCaptureInputs(data)
    if (!found.inputs.length && !found.skipped.length) return
    event.preventDefault()
    if (target) target.capture(found, null)
    else capture(found, here)
  })

  const onDragStart = useEffectEvent(() => {
    internalDrag.current = true
  })
  const onDragEnd = useEffectEvent(() => {
    internalDrag.current = false
  })

  const onDragEnter = useEffectEvent((event: DragEvent) => {
    if (internalDrag.current || !event.dataTransfer) return
    if (!isCapturableDrag(event.dataTransfer.types)) return
    dragDepth.current++
    if (dragDepth.current === 1) {
      cancelled.current = false
      setDragging(true)
    }
  })

  const onDragLeave = useEffectEvent(() => {
    if (dragDepth.current === 0) return
    dragDepth.current--
    if (dragDepth.current === 0) setDragging(false)
  })

  const onDragOver = useEffectEvent((event: DragEvent) => {
    if (internalDrag.current || !event.dataTransfer) return
    setOverClaimed(isClaimed(event))
    // Always for files: otherwise the browser navigates away to open them.
    if (dragDepth.current > 0 || event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = cancelled.current ? 'none' : 'copy'
    }
  })

  const onDrop = useEffectEvent((event: DragEvent) => {
    const wasCapturing = dragDepth.current > 0 && !cancelled.current
    dragDepth.current = 0
    setDragging(false)
    setOverClaimed(false)
    if (internalDrag.current || !event.dataTransfer || isClaimed(event)) return
    if (!wasCapturing && !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (!wasCapturing) return
    const found = toCaptureInputs(event.dataTransfer)
    if (target && event.target instanceof Node && target.contains(event.target)) {
      target.capture(found, { x: event.clientX, y: event.clientY })
    } else {
      capture(found, here)
    }
  })

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape' && dragDepth.current > 0) {
      cancelled.current = true
      setDragging(false)
    }
  })

  useEffect(() => {
    const listeners: [string, (event: never) => void][] = [
      ['paste', onPaste],
      ['dragstart', onDragStart],
      ['dragend', onDragEnd],
      ['dragenter', onDragEnter],
      ['dragleave', onDragLeave],
      ['dragover', onDragOver],
      ['drop', onDrop],
      ['keydown', onKeyDown],
    ]
    for (const [type, listener] of listeners)
      window.addEventListener(type, listener as EventListener)
    return () => {
      for (const [type, listener] of listeners) {
        window.removeEventListener(type, listener as EventListener)
      }
    }
  }, [])

  return (
    <CaptureContext
      value={{
        pending,
        capture,
        retry,
        dismiss,
        target: register,
        destination: registerDestination,
        dragging,
      }}
    >
      {children}
      {dragging && !target && !overClaimed && <DropOverlay into={destination} />}
    </CaptureContext>
  )
}

/** Lets drags through, so an element that takes drops itself (a note) gets them. */
function DropOverlay({ into }: { into: CaptureDestination | null }) {
  useT()
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-6 backdrop-blur-sm">
      <div className="pointer-events-none flex size-full items-center justify-center rounded-3xl border-2 border-dashed border-white/80 text-2xl font-semibold text-white">
        {into ? t('capturing.dropInto', { name: into.name }) : t('capturing.drop')}
      </div>
    </div>
  )
}

/** What the toast says about a batch, and what it offers (Undo, Separate). */
function batchToast(batch: Batch, onUndo: () => void, onSeparate: () => void): Toast {
  const done = batch.created.length
  const later = batch.deferred.length
  const items = (count: number) => t('counts.items', { count })
  const images = batch.images.size
  const message = !batch.settled
    ? t('capturing.inProgress', { items: items(batch.total) })
    : batch.albumId
      ? done > images
        ? t('capturing.groupedAnd', { count: images, items: items(done - images) })
        : t('capturing.grouped', { count: images })
    : later > 0
      ? done > 0
        ? t('capturing.capturedKept', { done, items: items(later) })
        : t('capturing.kept', { items: items(later) })
      : batch.failed.length === 0
        ? batch.into
          ? t('capturing.capturedInto', { items: items(done), name: batch.into.name })
          : t('capturing.captured', { items: items(done) })
        : done === 0
          ? t('capturing.none', { items: items(batch.total) })
          : t('capturing.some', { done, total: batch.total })
  const canUndo = batch.undoable && (done > 0 || !batch.settled)

  return {
    id: CAPTURE_TOAST,
    message,
    // The provider's own timer: in flight it stays, then TOAST_MS more.
    duration: null,
    actions: [
      ...(batch.albumId ? [{ label: t('capturing.separate'), onClick: onSeparate }] : []),
      ...(canUndo ? [{ label: t('capturing.undo'), onClick: onUndo }] : []),
    ],
    details: batch.failed.map((failure) => `${failure.label}: ${failure.error}`),
  }
}
