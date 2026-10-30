import { CircleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { FeedbackContext, type ConfirmRequest, type Feedback, type Toast } from './feedback'

const TOAST_MS = 5000
// Older toasts make way: more than this at once is noise.
const MAX_TOASTS = 3

type Shown = Toast & { id: string }
type Pending = ConfirmRequest & { resolve: (confirmed: boolean) => void }

let nextId = 0

/** Toasts and confirmation dialogs, one look for the whole app. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Shown[]>([])
  const [pending, setPending] = useState<Pending | null>(null)

  const [feedback] = useState<Feedback>(() => ({
    toast: (toast) => {
      const id = toast.id ?? `toast-${++nextId}`
      setToasts((current) => {
        const shown = { ...toast, id }
        if (current.some((entry) => entry.id === id)) {
          return current.map((entry) => (entry.id === id ? shown : entry))
        }
        return [...current, shown].slice(-MAX_TOASTS)
      })
      return id
    },
    dismissToast: (id) => setToasts((current) => current.filter((entry) => entry.id !== id)),
    confirm: (request) =>
      new Promise((resolve) => {
        setPending((current) => {
          current?.resolve(false)
          return { ...request, resolve }
        })
      }),
  }))

  function answer(confirmed: boolean) {
    pending?.resolve(confirmed)
    setPending(null)
  }

  return (
    <FeedbackContext value={feedback}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+4.5rem))] z-50 mx-auto flex w-[min(28rem,calc(100%-2rem))] flex-col gap-2 md:right-4 md:bottom-4 md:left-auto md:mx-0 md:w-96">
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} dismiss={feedback.dismissToast} />
        ))}
      </div>
      {pending && <ConfirmDialog request={pending} onAnswer={answer} />}
    </FeedbackContext>
  )
}

function ToastView({ toast, dismiss }: { toast: Shown; dismiss: (id: string) => void }) {
  const [hovered, setHovered] = useState(false)
  const duration = toast.duration === undefined ? TOAST_MS : toast.duration
  const error = toast.tone === 'error'

  // Paused while the pointer is over it, so an action can still be reached.
  useEffect(() => {
    if (duration === null || hovered) return
    const timer = setTimeout(() => dismiss(toast.id), duration)
    return () => clearTimeout(timer)
  }, [duration, hovered, toast, dismiss])

  const onDismiss = () => dismiss(toast.id)

  return (
    <div
      role={error ? 'alert' : 'status'}
      className="toast"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2">
        {error && (
          <CircleAlert className="size-4 shrink-0 text-red-400" aria-hidden="true" />
        )}
        <span className="mr-auto">{toast.message}</span>
        {toast.actions?.map((action) => (
          <button
            key={action.label}
            type="button"
            className="toast-action"
            onClick={() => {
              onDismiss()
              action.onClick()
            }}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Dismiss"
          className="-mr-1 rounded-md p-1 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          onClick={onDismiss}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {toast.details && toast.details.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-red-300">
          {toast.details.map((detail, index) => (
            <li key={index} className="truncate">
              {detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ConfirmDialog({
  request,
  onAnswer,
}: {
  request: ConfirmRequest
  onAnswer: (confirmed: boolean) => void
}) {
  const confirmButton = useRef<HTMLButtonElement>(null)
  useEffect(() => confirmButton.current?.focus(), [])

  return (
    <>
      <div className="backdrop" onMouseDown={() => onAnswer(false)} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[20vh]">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby={request.message ? 'confirm-message' : undefined}
          className="popover pointer-events-auto w-full max-w-sm p-5"
          // Keys stop here: the page's shortcuts (e, #, Esc) don't see them.
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onAnswer(false)
          }}
        >
          <h2 id="confirm-title" className="font-semibold">
            {request.title}
          </h2>
          {request.message && (
            <p id="confirm-message" className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {request.message}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="button-secondary" onClick={() => onAnswer(false)}>
              Cancel
            </button>
            <button
              ref={confirmButton}
              type="button"
              className={request.danger ? 'button-danger' : 'button-primary'}
              onClick={() => onAnswer(true)}
            >
              {request.confirm}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
