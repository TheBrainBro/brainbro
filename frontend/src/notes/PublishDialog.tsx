import { ExternalLink } from 'lucide-react'
import { useId, useState } from 'react'

import { usePublication, type Item } from '../items/api'
import { CopyField } from '../ui/CopyField'

/**
 * Publishes a note at `/p/<slug>`, where anyone can read it, or shows its
 * link, lets its address change and takes it down.
 */
export function PublishDialog({ note, onClose }: { note: Item; onClose: () => void }) {
  const publication = usePublication()
  const [slug, setSlug] = useState(note.public_slug ?? '')
  const [error, setError] = useState<string>()
  const slugId = useId()
  const published = Boolean(note.published_at)
  const path = `/p/${note.public_slug}`

  function change(publish: boolean, newSlug?: string) {
    setError(undefined)
    publication.mutate(
      { id: note.id, publish, slug: newSlug },
      {
        onSuccess: (item) => setSlug(item.public_slug ?? ''),
        onError: (failure) => setError(failure.message),
      },
    )
  }

  return (
    <div
      className="backdrop flex items-start justify-center overflow-auto p-4 pt-[10vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
        className="popover w-full max-w-md p-5"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (publication.isPending) return
          if (!published) change(true)
          else if (slug.trim() && slug.trim() !== note.public_slug) change(true, slug.trim())
        }}
      >
        <h2 id="publish-dialog-title" className="mb-2 font-semibold">
          {published ? 'This note is public' : 'Publish this note'}
        </h2>

        {published ? (
          <div className="space-y-4">
            <CopyField label="Public link" value={`${window.location.origin}${path}`} />
            <div className="space-y-1">
              <label htmlFor={slugId} className="block text-sm font-medium">
                Address
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">/p/</span>
                <input
                  id={slugId}
                  className="input"
                  value={slug}
                  maxLength={80}
                  spellCheck={false}
                  autoCapitalize="none"
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                />
                <button
                  type="submit"
                  className="button-secondary shrink-0"
                  disabled={!slug.trim() || slug.trim() === note.public_slug || publication.isPending}
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-zinc-500">Changing it breaks links to the old one.</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Anyone with the link can read it, without signing in, and it shows on the list of
            public notes. Its images go with it. Links to your other notes only work where those
            are public too.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          {published ? (
            <>
              <button
                type="button"
                className="button-danger mr-auto"
                disabled={publication.isPending}
                onClick={() => change(false)}
              >
                Unpublish
              </button>
              <a href={path} target="_blank" rel="noopener noreferrer" className="button-ghost">
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Open
              </a>
              <button type="button" className="button-primary" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="button-primary" disabled={publication.isPending}>
                Publish
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
