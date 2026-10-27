import { useState, type ReactNode } from 'react'

import { timeAgo } from '../lib/time'
import { useRefreshPreview, type Item } from './api'

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

function LinkPreview({ item }: { item: Item }) {
  const refresh = useRefreshPreview()
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
        <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
          <Favicon src={metadata.favicon_url} />
          <span className="truncate">{metadata.site_name || hostname(item.url)}</span>
          {item.preview_status === 'failed' && (
            <>
              <span aria-hidden>·</span>
              <span>Preview unavailable</span>
              <button
                type="button"
                className="font-medium text-zinc-700 hover:underline disabled:opacity-50 dark:text-zinc-300"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate(item.id)}
              >
                Retry
              </button>
            </>
          )}
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

export function ItemCard({ item, actions }: { item: Item; actions?: ReactNode }) {
  return (
    <article className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      {item.kind === 'link' ? (
        <LinkPreview item={item} />
      ) : (
        <>
          {item.title && <h2 className="mb-1 font-medium">{item.title}</h2>}
          <p className="line-clamp-6 text-sm break-words whitespace-pre-wrap">{item.body}</p>
        </>
      )}
      <footer className="mt-3 flex items-center justify-between text-xs text-zinc-400">
        <time dateTime={item.created_at}>{timeAgo(item.created_at)}</time>
        {actions}
      </footer>
    </article>
  )
}
