import { Check, ExternalLink, Globe, Lock, Settings2, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { usePublication, type Item } from '../items/api'
import { CopyField } from '../ui/CopyField'
import { Dropdown } from '../ui/Dropdown'

/**
 * Who can read the note: only its owner (private, the default) or anyone
 * with its link, at `/p/<slug>`. Choosing public publishes it at once; its
 * link and page settings then show here.
 */
export function VisibilityMenu({ note, onSettings }: { note: Item; onSettings: () => void }) {
  const publication = usePublication()
  const [error, setError] = useState<string>()
  const isPublic = Boolean(note.published_at)
  const path = `/p/${note.public_slug}`

  function choose(publish: boolean) {
    if (publish === isPublic || publication.isPending) return
    setError(undefined)
    publication.mutate(
      { id: note.id, publish },
      { onError: (failure) => setError(failure.message) },
    )
  }

  return (
    <Dropdown
      role="dialog"
      label="Visibility"
      className="w-80"
      trigger={(props) => (
        <button
          type="button"
          aria-label={isPublic ? 'Visibility: public' : 'Visibility: private'}
          className="button-ghost group/tip relative"
          {...props}
        >
          {isPublic ? (
            <Globe className="size-3.5 text-accent-600 dark:text-accent-400" aria-hidden="true" />
          ) : (
            <Lock className="size-3.5" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{isPublic ? 'Public' : 'Private'}</span>
          <span className="tooltip top-full mt-2 sm:hidden">{isPublic ? 'Public' : 'Private'}</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <Choice
            icon={Lock}
            title="Private"
            detail="Only you can see it."
            selected={!isPublic}
            onClick={() => choose(false)}
          />
          <Choice
            icon={Globe}
            title="Public"
            detail="Anyone with the link can read it, without signing in."
            selected={isPublic}
            onClick={() => choose(true)}
          />
          {error && (
            <p role="alert" className="px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
          {isPublic && (
            <>
              <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              <div className="space-y-1 p-2">
                <CopyField label="Public link" value={`${window.location.origin}${path}`} />
              </div>
              <a href={path} target="_blank" rel="noopener noreferrer" className="menu-item">
                <ExternalLink className="size-4" aria-hidden="true" />
                Open page
              </a>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close()
                  onSettings()
                }}
              >
                <Settings2 className="size-4" aria-hidden="true" />
                Page settings…
              </button>
            </>
          )}
        </>
      )}
    </Dropdown>
  )
}

function Choice({
  icon: Icon,
  title,
  detail,
  selected,
  onClick,
}: {
  icon: LucideIcon
  title: string
  detail: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className="menu-item items-start"
      onClick={onClick}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-zinc-500">{detail}</span>
      </span>
      {selected && <Check className="mt-0.5 size-4 shrink-0 text-accent-600" aria-hidden="true" />}
    </button>
  )
}
