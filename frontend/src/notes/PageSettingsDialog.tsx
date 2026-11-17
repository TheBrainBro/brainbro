import { ImageOff, Sparkles } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import {
  usePageSettings,
  useSavePage,
  type Item,
  type PageChanges,
  type PageSettings,
} from '../items/api'
import { useT } from '../i18n/i18n'
import { useAppHost } from '../lib/address'
import { ErrorState, Loading } from '../ui/states'

const NO_IMAGE = 'none'

/**
 * A public note's page: its address, and how it shows in search results and
 * when its link is shared (OpenGraph). Empty fields take the defaults shown
 * as placeholders: the note's title, the start of its text, its first image.
 */
export function PageSettingsDialog({ note, onClose }: { note: Item; onClose: () => void }) {
  const t = useT()
  const page = usePageSettings(note.id)

  return (
    <div
      className="backdrop flex items-start justify-center overflow-auto p-4 pt-[8vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-settings-title"
        className="popover w-full max-w-lg p-5"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 id="page-settings-title" className="mb-4 font-semibold">
          {t('pageSettings.title')}
        </h2>
        {page.isPending ? (
          <Loading />
        ) : page.isError ? (
          <ErrorState error={page.error} onRetry={() => page.refetch()} />
        ) : (
          <SettingsForm note={note} page={page.data} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

function SettingsForm({
  note,
  page,
  onClose,
}: {
  note: Item
  page: PageSettings
  onClose: () => void
}) {
  const t = useT()
  const appHost = useAppHost()
  // Where the page lives: on the server, or on its blog's domain.
  const pageHost = page.address.startsWith('/') ? appHost : new URL(page.address).host
  const save = useSavePage(note.id)
  const [slug, setSlug] = useState(page.slug ?? '')
  const [title, setTitle] = useState(page.title)
  const [description, setDescription] = useState(page.description)
  const [image, setImage] = useState(page.image)
  const [error, setError] = useState<string>()
  const ids = { slug: useId(), title: useId(), description: useId() }

  // The note's images that have a stored copy, to pick from.
  const images = Object.entries(note.images ?? {}).flatMap(([src, stored]) =>
    stored.url ? [{ src, url: stored.url }] : [],
  )
  const chosen = image === NO_IMAGE ? null : image || page.defaults.image
  const previewImage = images.find((candidate) => candidate.src === chosen)?.url ?? null

  const changes: PageChanges = {}
  if (slug.trim() !== (page.slug ?? '')) changes.slug = slug.trim()
  if (title.trim() !== page.title) changes.title = title.trim()
  if (description.trim() !== page.description) changes.description = description.trim()
  if (image !== page.image) changes.image = image
  const changed = Object.keys(changes).length > 0

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!changed || !slug.trim() || save.isPending) return
        setError(undefined)
        save.mutate(changes, { onSuccess: onClose, onError: (failure) => setError(failure.message) })
      }}
    >
      <Field id={ids.slug} label={t('pageSettings.address')} hint={t('pageSettings.addressHint')}>
        <div className="flex items-center gap-1.5">
          <span className="text-sm whitespace-nowrap text-zinc-500">
            {page.address.startsWith('/')
              ? `${appHost}${page.address}`
              : page.address.replace(/^https?:\/\//, '')}
          </span>
          <input
            id={ids.slug}
            className="input"
            value={slug}
            maxLength={80}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </div>
      </Field>

      <Field id={ids.title} label={t('pageSettings.pageTitle')}>
        <input
          id={ids.title}
          className="input"
          value={title}
          maxLength={200}
          placeholder={page.defaults.title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <Field id={ids.description} label={t('pageSettings.description')}>
        <textarea
          id={ids.description}
          className="input min-h-20 resize-y"
          value={description}
          maxLength={300}
          placeholder={page.defaults.description || t('pageSettings.descriptionPlaceholder')}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t('pageSettings.image')}</legend>
        <div className="flex flex-wrap gap-2">
          <ImageChoice
            label={t('pageSettings.firstImage')}
            selected={image === ''}
            onClick={() => setImage('')}
          >
            <Sparkles className="size-4" aria-hidden="true" />
          </ImageChoice>
          {images.map((candidate) => (
            <ImageChoice
              key={candidate.src}
              label={candidate.src}
              selected={image === candidate.src}
              onClick={() => setImage(candidate.src)}
            >
              <img src={candidate.url} alt="" className="size-full object-cover" />
            </ImageChoice>
          ))}
          <ImageChoice
            label={t('pageSettings.noImage')}
            selected={image === NO_IMAGE}
            onClick={() => setImage(NO_IMAGE)}
          >
            <ImageOff className="size-4" aria-hidden="true" />
          </ImageChoice>
        </div>
      </fieldset>

      <div>
        <div className="mb-1 text-sm font-medium">{t('pageSettings.preview')}</div>
        <div
          aria-label={t('pageSettings.linkPreview')}
          className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          {previewImage && (
            <img src={previewImage} alt="" className="aspect-[1.91/1] w-full object-cover" />
          )}
          <div className="space-y-0.5 p-3">
            <div className="text-xs text-zinc-500">{pageHost}</div>
            <div className="truncate text-sm font-medium">{title.trim() || page.defaults.title}</div>
            <div className="line-clamp-2 text-xs text-zinc-500">
              {description.trim() || page.defaults.description}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="button-secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="button-primary"
          disabled={!changed || !slug.trim() || save.isPending}
        >
          {t('common.save')}
        </button>
      </div>
    </form>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  )
}

function ImageChoice({
  label,
  selected,
  onClick,
  children,
}: {
  label: string
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={`flex size-14 items-center justify-center overflow-hidden rounded-lg border text-zinc-500 transition ${
        selected
          ? 'border-accent-500 ring-2 ring-accent-500'
          : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
