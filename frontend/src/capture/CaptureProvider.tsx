import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

import { useSession } from '../auth/session'
import { itemsKey, type Item } from '../items/api'
import { api, upload } from '../lib/api'
import { isEditable } from '../lib/dom'
import { formatBytes } from '../lib/format'
import {
  CaptureContext,
  type CaptureOptions,
  type CaptureResult,
  type PendingCapture,
} from './context'
import { isCapturableDrag, toCaptureInputs, type CaptureInput, type CaptureInputs } from './inputs'

const MAX_PARALLEL_UPLOADS = 3
const TOAST_MS = 6000

type Batch = {
  id: string
  total: number
  undoable: boolean
  created: string[]
  failed: { label: string; error: string }[]
  settled: boolean
  undone: boolean
}

function labelOf(input: CaptureInput) {
  if (input.kind === 'file') return input.file.name || 'Pasted file'
  return input.kind === 'url' ? input.url : input.text
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * The one capture pipeline. Pastes and drops anywhere in the app, and the
 * capture box, all come through here: each input becomes an optimistic card
 * (with upload progress for files) until the server item replaces it.
 */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const maxSize = session?.limits?.upload_max_size

  const [pending, setPending] = useState<PendingCapture[]>([])
  const [toast, setToast] = useState<Batch | null>(null)
  const [dragging, setDragging] = useState(false)

  const controllers = useRef(new Map<string, AbortController>())
  const settlers = useRef(new Map<string, (result: CaptureResult) => void>())
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
    const batch = batches.current.get(entry.batch)
    if (!batch) return
    if ('item' in result) batch.created.push(result.item.id)
    else batch.failed.push({ label: entry.label, error: result.error })
    batch.settled = batch.created.length + batch.failed.length === batch.total
    if (batch.undoable) showBatch(batch)
  }

  async function send(entry: PendingCapture, signal: AbortSignal) {
    const input = entry.input!
    if (input.kind !== 'file') {
      const payload =
        input.kind === 'url'
          ? { text: input.url }
          : input.kind === 'note'
            ? { text: input.text, kind: 'note' }
            : { text: input.text }
      return api<Item>('/items/capture/', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      })
    }
    const form = new FormData()
    form.append('file', input.file)
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
      const message = error instanceof Error ? error.message : 'Capture failed'
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
    if (input.file.size === 0) return 'The file is empty.'
    if (maxSize && input.file.size > maxSize) {
      return `The file is too large (max ${formatBytes(maxSize)}).`
    }
    return undefined
  }

  function capture(found: CaptureInputs, { undo = true }: CaptureOptions = {}) {
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
      })
      refused.push({ label: skipped.name, error })
    }
    if (!entries.length) return Promise.resolve([])

    const batch: Batch = {
      id: batchId,
      total: entries.length,
      undoable: undo,
      created: [],
      failed: refused,
      settled: refused.length === entries.length,
      undone: false,
    }
    batches.current.set(batchId, batch)
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
      await api('/items/triage/', {
        method: 'POST',
        body: JSON.stringify({ ids: batch.created, action: 'delete' }),
      })
      await queryClient.invalidateQueries({ queryKey: itemsKey })
    }
  }

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
    if (!data) return
    // Text fields keep their own paste, unless it's a file they can't hold.
    if (isEditable(event.target) && !data.types.includes('Files')) return
    const found = toCaptureInputs(data)
    if (!found.inputs.length && !found.skipped.length) return
    event.preventDefault()
    capture(found)
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
    if (internalDrag.current || !event.dataTransfer) return
    if (!wasCapturing && !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (wasCapturing) capture(toCaptureInputs(event.dataTransfer))
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
    <CaptureContext value={{ pending, capture, retry, dismiss }}>
      {children}
      {dragging && <DropOverlay />}
      {toast && (
        <CaptureToast batch={toast} onUndo={() => undoBatch(batches.current.get(toast.id)!)} />
      )}
    </CaptureContext>
  )
}

function DropOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-6 backdrop-blur-sm">
      <div className="pointer-events-none flex size-full items-center justify-center rounded-3xl border-2 border-dashed border-white/80 text-2xl font-semibold text-white">
        Drop to capture
      </div>
    </div>
  )
}

function CaptureToast({ batch, onUndo }: { batch: Batch; onUndo: () => void }) {
  const done = batch.created.length
  const count = (n: number) => (n === 1 ? '1 item' : `${n} items`)
  const message = !batch.settled
    ? `Capturing ${count(batch.total)}…`
    : batch.failed.length === 0
      ? `Captured ${count(done)}`
      : done === 0
        ? `Couldn't capture ${count(batch.total)}`
        : `Captured ${done} of ${batch.total}`
  const canUndo = batch.undoable && (done > 0 || !batch.settled)

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
    >
      <div className="flex items-center gap-3">
        <span className="mr-auto">{message}</span>
        {canUndo && (
          <button type="button" className="font-semibold hover:underline" onClick={onUndo}>
            Undo
          </button>
        )}
      </div>
      {batch.failed.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-red-300 dark:text-red-700">
          {batch.failed.map((failure, index) => (
            <li key={index} className="truncate">
              {failure.label}: {failure.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
