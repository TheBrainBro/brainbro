import { CircleAlert, LoaderCircle, RotateCw, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { ApiError } from '../lib/api'

/** Nothing to show yet: what this place is for, and the next thing to do. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-50 text-accent-600 ring-1 ring-accent-100 dark:bg-accent-500/10 dark:text-accent-300 dark:ring-accent-500/20">
        <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="font-semibold">{title}</h2>
      {children && (
        <div className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{children}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Something went wrong loading: what, and a way to try again. */
export function ErrorState({
  error,
  title = "Couldn't load this",
  onRetry,
  action,
}: {
  error: Error
  title?: string
  onRetry?: () => void
  action?: ReactNode
}) {
  const offline = error instanceof ApiError ? false : !navigator.onLine
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">
        <CircleAlert className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        {offline ? "You're offline. It loads again once you're back." : error.message}
      </p>
      {(onRetry || action) && (
        <div className="mt-5 flex gap-2">
          {action}
          {onRetry && (
            <button type="button" className="button-outline" onClick={onRetry}>
              <RotateCw className="size-4" aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** A spinner with what is loading, for a whole page or screen. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex h-full min-h-40 items-center justify-center gap-2 text-sm text-zinc-500"
    >
      <LoaderCircle className="size-4 animate-spin text-accent-500" aria-hidden="true" />
      {label}
    </div>
  )
}
