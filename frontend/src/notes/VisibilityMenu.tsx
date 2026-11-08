import { Check, ExternalLink, Globe, Link2, Lock, Settings2, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { useT } from '../i18n/i18n'
import { usePublication, type Item, type Visibility } from '../items/api'
import { CopyField } from '../ui/CopyField'
import { Dropdown } from '../ui/Dropdown'

/**
 * Who can read the note: only its owner (private, the default), anyone with
 * its link (unlisted) or anyone, on its blog and feeds too (public), at
 * `/@<handle>/<slug>` or on its blog. Choosing one applies it at once; the
 * link and page settings of a published note show here.
 */
export function VisibilityMenu({ note, onSettings }: { note: Item; onSettings: () => void }) {
  const t = useT()
  const publication = usePublication()
  const [error, setError] = useState<string>()
  const visibility: Visibility = !note.published_at
    ? 'private'
    : note.public_listed
      ? 'public'
      : 'unlisted'
  const states: Record<
    Visibility,
    { icon: LucideIcon; title: string; detail: string; state: string }
  > = {
    private: {
      icon: Lock,
      title: t('visibility.private'),
      detail: t('visibility.privateHint'),
      state: t('visibility.isPrivate'),
    },
    unlisted: {
      icon: Link2,
      title: t('visibility.unlisted'),
      detail: t('visibility.unlistedHint'),
      state: t('visibility.isUnlisted'),
    },
    public: {
      icon: Globe,
      title: t('visibility.public'),
      detail: t('visibility.publicHint'),
      state: t('visibility.isPublic'),
    },
  }
  const current = states[visibility]
  const CurrentIcon = current.icon
  // A path on the server, or its blog's full URL.
  const url = new URL(note.public_url ?? '/', window.location.origin).href

  function choose(next: Visibility) {
    if (next === visibility || publication.isPending) return
    setError(undefined)
    publication.mutate(
      { id: note.id, visibility: next },
      { onError: (failure) => setError(failure.message) },
    )
  }

  return (
    <Dropdown
      role="dialog"
      label={t('visibility.label')}
      className="w-80"
      trigger={(props) => (
        <button
          type="button"
          aria-label={current.state}
          className="button-ghost group/tip relative"
          {...props}
        >
          <CurrentIcon
            className={
              visibility === 'private'
                ? 'size-3.5'
                : 'size-3.5 text-accent-600 dark:text-accent-400'
            }
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{current.title}</span>
          <span className="tooltip top-full mt-2 sm:hidden">{current.title}</span>
        </button>
      )}
    >
      {(close) => (
        <>
          {(['private', 'unlisted', 'public'] as const).map((option) => (
            <Choice
              key={option}
              icon={states[option].icon}
              title={states[option].title}
              detail={states[option].detail}
              selected={option === visibility}
              onClick={() => choose(option)}
            />
          ))}
          {error && (
            <p role="alert" className="px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
          {visibility !== 'private' && (
            <>
              <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              <div className="space-y-1 p-2">
                <CopyField label={t('visibility.link')} value={url} />
              </div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="menu-item">
                <ExternalLink className="size-4" aria-hidden="true" />
                {t('visibility.openPage')}
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
                {t('visibility.settings')}
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
