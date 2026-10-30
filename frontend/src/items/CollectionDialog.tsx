import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { squareImage } from '../lib/image'
import {
  collectionsKey,
  setCollectionImage,
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  type Collection,
  type CollectionKind,
} from './api'
import { CollectionAvatar } from './CollectionAvatar'
import { COLLECTION_COLORS, COLLECTION_KINDS, firstGrapheme, SUGGESTED_EMOJI } from './collectionKinds'
import { collectionPath, withDescendants } from './collectionTree'

/**
 * Creates a collection (inside `parent`, if given), or edits `collection`:
 * name, where it sits, kind and look (an emoji on a color, or an image).
 */
export function CollectionDialog({
  collection,
  parent: initialParent = null,
  onSaved,
  onClose,
}: {
  collection?: Collection
  parent?: string | null
  onSaved: (collection: Collection) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const create = useCreateCollection()
  const update = useUpdateCollection()
  const [name, setName] = useState(collection?.name ?? '')
  const [parent, setParent] = useState(collection ? collection.parent : initialParent)
  const [kind, setKind] = useState<CollectionKind>(collection?.kind ?? 'project')
  const [icon, setIcon] = useState(collection?.icon ?? '')
  const [color, setColor] = useState(collection?.color ?? '')
  // A new image to upload, null to remove the current one, undefined to keep it.
  const [image, setImage] = useState<Blob | null | undefined>(undefined)
  const [preview, setPreview] = useState<string | null>(collection?.image_url ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const collections = useCollections()
  // Anywhere but inside itself, labelled by where each one sits.
  const places = useMemo(() => {
    const all = collections.data ?? []
    const own = collection ? withDescendants(all, collection.id) : new Set<string>()
    return all
      .filter((candidate) => !own.has(candidate.id))
      .map((candidate) => {
        const path = collectionPath(all, candidate.id)
        return { id: candidate.id, label: path ? `${path} / ${candidate.name}` : candidate.name }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [collections.data, collection])

  // The local preview of a picked image, freed when replaced or closed.
  const objectUrl = useRef<string | null>(null)
  function showLocal(blob: Blob | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = blob ? URL.createObjectURL(blob) : null
    setPreview(objectUrl.current)
  }
  useEffect(() => () => showLocal(null), [])

  async function pickImage(file: File | undefined) {
    if (!file) return
    try {
      const square = await squareImage(file)
      setImage(square)
      showLocal(square)
      setError(undefined)
    } catch {
      setError("That file isn't an image this browser can read.")
    }
  }

  async function save() {
    setSaving(true)
    setError(undefined)
    const fields = { name: name.trim(), parent, kind, icon, color }
    try {
      let saved = collection
        ? await update.mutateAsync({ id: collection.id, ...fields })
        : await create.mutateAsync(fields)
      if (image || (image === null && collection?.image_url)) {
        saved = await setCollectionImage(saved.id, image)
        // Its new face, everywhere it shows, without a reload.
        await queryClient.invalidateQueries({ queryKey: collectionsKey })
      }
      onSaved(saved)
    } catch (caught) {
      setError((caught as Error).message)
      setSaving(false)
    }
  }

  const look = { kind, icon, color, image_url: preview }

  return (
    <div
      className="backdrop flex items-start justify-center overflow-auto p-4 pt-[10vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-dialog-title"
        className="popover w-full max-w-md p-5"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && !saving) save()
        }}
      >
        <h2 id="collection-dialog-title" className="mb-4 font-semibold">
          {collection ? 'Edit collection' : 'New collection'}
        </h2>

        <div className="flex items-end gap-3">
          <CollectionAvatar collection={look} size="lg" />
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor="collection-name">
              Name
            </label>
            <input
              id="collection-name"
              className="input"
              placeholder="Trip to Japan, Health, Typography…"
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>

        {places.length > 0 && (
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium" htmlFor="collection-parent">
              Inside
            </label>
            <select
              id="collection-parent"
              className="input"
              value={parent ?? ''}
              onChange={(event) => setParent(event.target.value || null)}
            >
              <option value="">Nothing, at the top</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">Kind</legend>
          <div className="grid grid-cols-3 gap-2">
            {COLLECTION_KINDS.map(({ value, label, hint, icon: Icon }) => (
              <label
                key={value}
                className={`flex cursor-pointer flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition has-focus-visible:ring-3 has-focus-visible:ring-accent-500/30 ${
                  kind === value
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-500/10'
                    : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600'
                }`}
              >
                <input
                  type="radio"
                  name="collection-kind"
                  className="sr-only"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                <Icon className="size-4 text-accent-600 dark:text-accent-300" aria-hidden="true" />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-zinc-500">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">Look</legend>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input w-16 text-center text-lg"
              aria-label="Emoji"
              placeholder="🙂"
              value={icon}
              onChange={(event) => setIcon(firstGrapheme(event.target.value))}
            />
            <button
              type="button"
              className="button-outline px-3 py-2"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden="true" />
              {preview ? 'Change image' : 'Upload image'}
            </button>
            {preview && (
              <button
                type="button"
                className="button-ghost"
                onClick={() => {
                  setImage(null)
                  showLocal(null)
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
                Remove image
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Image"
              onChange={(event) => {
                pickImage(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-0.5" aria-label="Suggested emoji">
            {SUGGESTED_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={emoji}
                aria-pressed={icon === emoji}
                className={`flex size-8 items-center justify-center rounded-md text-lg transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                  icon === emoji ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                }`}
                onClick={() => setIcon(icon === emoji ? '' : emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Color" className="mt-2 flex flex-wrap gap-1.5">
            {COLLECTION_COLORS.map((swatch) => (
              <button
                key={swatch || 'default'}
                type="button"
                role="radio"
                aria-checked={color === swatch}
                aria-label={swatch || 'Default'}
                className={`size-6 rounded-full border border-zinc-300 ring-offset-2 ring-offset-white transition hover:scale-110 dark:border-zinc-700 dark:ring-offset-zinc-900 ${
                  color === swatch ? 'ring-2 ring-zinc-900 dark:ring-zinc-100' : ''
                } ${swatch ? '' : 'bg-accent-100 dark:bg-accent-500/20'}`}
                style={swatch ? { background: swatch } : undefined}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
          {preview && (
            <p className="mt-2 text-xs text-zinc-500">The image shows instead of the emoji.</p>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!name.trim() || saving}>
            {collection ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
