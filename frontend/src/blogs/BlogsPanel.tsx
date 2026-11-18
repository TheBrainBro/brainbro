import {
  ChevronDown,
  GripVertical,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Folder,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { useT } from '../i18n/i18n'
import { SettingsSection } from '../settings/SettingsSection'
import { useCollections, type Collection } from '../items/api'
import { socialImage, squareImage } from '../lib/image'
import { CopyField } from '../ui/CopyField'
import { useFeedback } from '../ui/feedback'
import {
  useBlogs,
  useCreateBlog,
  useDeleteBlog,
  useSetBlogAvatar,
  useSetBlogSocialImage,
  useUpdateBlog,
  useVerifyBlog,
  type Blog,
} from './api'

/** As many as the server takes. */
const MAX_LINKS = 10

/**
 * Blogs on the user's own domains: a collection's published notes, served at
 * `https://<domain>/<slug>` once a TXT record proves the domain is theirs.
 */
export function BlogsPanel() {
  const t = useT()
  const blogs = useBlogs()
  const collections = useCollections()

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('blogs.intro')}</p>
      {blogs.data?.map((blog) => (
        <BlogCard key={blog.id} blog={blog} collections={collections.data ?? []} />
      ))}
      <NewBlog collections={collections.data ?? []} first={blogs.data?.length === 0} />
    </div>
  )
}

function CollectionSelect({
  id,
  label,
  value,
  collections,
  onChange,
}: {
  id: string
  /** When no <label> names it. */
  label?: string
  value: string | null
  collections: Collection[]
  onChange: (value: string | null) => void
}) {
  const t = useT()
  return (
    <select
      id={id}
      aria-label={label}
      className="input"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{t('blogs.noCollection')}</option>
      {collections.map((collection) => (
        <option key={collection.id} value={collection.id}>
          {collection.name}
        </option>
      ))}
    </select>
  )
}

/**
 * A card that opens into the form for a new blog. With no blog yet it starts
 * open: it is the only thing to do on the page.
 */
function NewBlog({ collections, first }: { collections: Collection[]; first: boolean }) {
  const t = useT()
  const create = useCreateBlog()
  // Null until the user opens or closes it: then it follows whether there are blogs.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? first
  const [hostname, setHostname] = useState('')
  const [collection, setCollection] = useState<string | null>(null)
  const ids = { hostname: useId(), collection: useId(), title: useId() }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!hostname.trim() || create.isPending) return
    create.mutate(
      { hostname: hostname.trim(), collection },
      {
        onSuccess: () => {
          setHostname('')
          setCollection(null)
          setChosen(false)
        },
      },
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-600 transition hover:border-accent-400 hover:text-accent-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-accent-500 dark:hover:text-accent-300"
        onClick={() => setChosen(true)}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('blogs.add')}
      </button>
    )
  }

  return (
    <form
      aria-labelledby={ids.title}
      className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
      onSubmit={submit}
    >
      <h4 id={ids.title} className="text-sm font-semibold">
        {t('blogs.add')}
      </h4>
      <div className="space-y-1">
        <label htmlFor={ids.hostname} className="block text-sm font-medium">
          {t('blogs.domain')}
        </label>
        <input
          id={ids.hostname}
          className="input"
          value={hostname}
          placeholder="blog.example.com"
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => setHostname(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.collection} className="block text-sm font-medium">
          {t('blogs.collection')}
        </label>
        <CollectionSelect
          id={ids.collection}
          value={collection}
          collections={collections}
          onChange={setCollection}
        />
        <p className="text-xs text-zinc-500">{t('blogs.collectionHint')}</p>
      </div>
      {create.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {!first && (
          <button type="button" className="button-secondary" onClick={() => setChosen(false)}>
            {t('common.cancel')}
          </button>
        )}
        <button type="submit" className="button-primary" disabled={!hostname.trim() || create.isPending}>
          {t('blogs.addButton')}
        </button>
      </div>
    </form>
  )
}

/** A verified blog's new domain stays pending; until then it serves at this one. */
function ChangeDomain({ blog, onDone }: { blog: Blog; onDone: () => void }) {
  const t = useT()
  const update = useUpdateBlog(blog.id)
  const [hostname, setHostname] = useState(blog.hostname)
  const id = useId()
  const changed = hostname.trim() !== '' && hostname.trim() !== blog.hostname

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!changed || update.isPending) return
    update.mutate({ hostname: hostname.trim() }, { onSuccess: onDone })
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium">
          {t('blogs.newDomain')}
        </label>
        <input
          id={id}
          className="input"
          value={hostname}
          placeholder="blog.example.com"
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => setHostname(event.target.value)}
        />
        {blog.status === 'verified' && (
          <p className="text-xs text-zinc-500">{t('blogs.changeDomainHint')}</p>
        )}
      </div>
      {update.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {update.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="button-primary" disabled={!changed || update.isPending}>
          {t('common.save')}
        </button>
        <button type="button" className="button-outline" onClick={onDone}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

/** The DNS records to add, and the button that checks them. */
function DnsSetup({
  blog,
  intro,
  checking,
  verifying,
  onVerify,
  children,
}: {
  blog: Blog
  intro: string
  checking: boolean
  verifying: boolean
  onVerify: () => void
  children?: ReactNode
}) {
  const t = useT()
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{intro}</p>
      {blog.records.map((record) => (
        <div key={`${record.type}-${record.name}`} className="space-y-1">
          <p className="text-xs font-medium text-zinc-500">
            {record.type === 'A' ? t('blogs.recordA') : record.type === 'TXT' ? t('blogs.recordTxt') : t('blogs.recordCname')}
          </p>
          <CopyField label={t('blogs.recordName', { type: record.type })} value={record.name} />
          <CopyField label={t('blogs.recordValue', { type: record.type })} value={record.value} />
        </div>
      ))}
      <p className="text-xs text-zinc-500">{t('blogs.tunnelHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="button-primary"
          disabled={verifying || checking}
          onClick={onVerify}
        >
          {t('blogs.verify')}
        </button>
        {children}
      </div>
    </div>
  )
}

/** The blog's own photo; without one, the profile's shows on the blog. */
function BlogPhoto({ blog }: { blog: Blog }) {
  const t = useT()
  const setAvatar = useSetBlogAvatar(blog.id)
  return (
    <ImagePicker
      label={t('blogs.photo')}
      hint={t('blogs.photoHint')}
      url={blog.avatar_url}
      round
      prepare={squareImage}
      mutation={setAvatar}
    />
  )
}

/** What links to the blog, and to its posts with no image of their own, show. */
function BlogSocialImage({ blog }: { blog: Blog }) {
  const t = useT()
  const setImage = useSetBlogSocialImage(blog.id)
  return (
    <ImagePicker
      label={t('blogs.socialImage')}
      hint={t('blogs.socialImageHint')}
      url={blog.social_image_url}
      prepare={socialImage}
      mutation={setImage}
    />
  )
}

/**
 * One of the blog's images, laid out the same for both: its name, a preview,
 * Upload (or Change) and Remove, and a hint.
 */
function ImagePicker({
  label,
  hint,
  url,
  round = false,
  prepare,
  mutation,
}: {
  label: string
  hint: string
  url: string | null
  round?: boolean
  /** Crops the picked file to what the server takes. */
  prepare: (file: File) => Promise<Blob>
  mutation: { mutate: (image: Blob | null, options: { onError: (failure: Error) => void }) => void; isPending: boolean }
}) {
  const t = useT()
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const shape = round ? 'aspect-square rounded-full' : 'aspect-[1200/630] rounded-md'

  async function pick(file: File | undefined) {
    if (!file) return
    setError(undefined)
    let image: Blob
    try {
      image = await prepare(file)
    } catch {
      return setError(t('profile.notAnImage'))
    }
    mutation.mutate(image, { onError: (failure) => setError(failure.message) })
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {url ? (
        <img src={url} alt="" className={`h-20 object-cover ${shape}`} />
      ) : (
        <span
          aria-hidden="true"
          className={`flex h-20 items-center justify-center bg-zinc-100 text-zinc-400 dark:bg-zinc-800 ${shape}`}
        >
          <ImagePlus className="size-5" />
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="button-outline px-3 py-1.5"
          disabled={mutation.isPending}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {url ? t('blogs.changeImage') : t('blogs.uploadImage')}
        </button>
        {url && (
          <button
            type="button"
            className="button-danger-ghost"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(null, { onError: (failure) => setError(failure.message) })}
          >
            {t('common.remove')}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          aria-label={label}
          className="hidden"
          onChange={(event) => {
            void pick(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      <p className="text-xs text-zinc-500">{hint}</p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function BlogCard({ blog, collections }: { blog: Blog; collections: Collection[] }) {
  const t = useT()
  const { confirm } = useFeedback()
  const update = useUpdateBlog(blog.id)
  const remove = useDeleteBlog(blog.id)
  const verify = useVerifyBlog(blog.id)
  const [editingDomain, setEditingDomain] = useState(false)
  // A verified blog is set up: its settings stay folded until asked for.
  const [expanded, setExpanded] = useState(blog.status !== 'verified')
  const bodyId = useId()
  const collectionName = collections.find((c) => c.id === blog.collection)?.name
  const [title, setTitle] = useState(blog.title)
  const [description, setDescription] = useState(blog.description)
  const [author, setAuthor] = useState(blog.author)
  const [authorUrl, setAuthorUrl] = useState(blog.author_url)
  const [links, setLinks] = useState(() => blog.links.map(withKey))
  // Rows left empty aren't links.
  const filled = links
    .map((link) => ({ name: link.name.trim(), url: link.url.trim() }))
    .filter((link) => link.name || link.url)
  const ids = {
    collection: useId(),
    title: useId(),
    description: useId(),
    author: useId(),
    authorUrl: useId(),
  }
  const error = update.error ?? remove.error ?? verify.error
  const changed =
    title.trim() !== blog.title ||
    description.trim() !== blog.description ||
    author.trim() !== blog.author ||
    authorUrl.trim() !== blog.author_url ||
    JSON.stringify(filled) !== JSON.stringify(blog.links)

  async function deleteBlog() {
    const confirmed = await confirm({
      title: t('blogs.deleteTitle', { domain: blog.hostname }),
      message: t('blogs.deleteMessage'),
      confirm: t('blogs.delete'),
      danger: true,
    })
    if (confirmed) remove.mutate()
  }

  return (
    <section
      aria-label={blog.hostname}
      className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h4 className="font-semibold break-all">{blog.hostname}</h4>
          <p className="flex items-center gap-1 text-xs text-zinc-500">
            <Folder className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{collectionName ?? t('blogs.noCollection')}</span>
          </p>
        </div>
        <Status status={blog.status} />
        {blog.status === 'verified' && (
          <a
            href={blog.url}
            target="_blank"
            rel="noopener noreferrer"
            className="button-icon size-8"
            aria-label={t('blogs.open')}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        )}
        {!blog.pending_hostname && (
          <button
            type="button"
            className="button-icon size-8"
            aria-label={t('blogs.changeDomain')}
            aria-expanded={editingDomain}
            onClick={() => setEditingDomain(!editingDomain)}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="button-icon size-8 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          aria-label={t('blogs.delete')}
          disabled={remove.isPending}
          onClick={() => void deleteBlog()}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="button-icon size-8"
          aria-label={t('blogs.edit')}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown className={`size-4 transition ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {editingDomain && !blog.pending_hostname && (
        <ChangeDomain blog={blog} onDone={() => setEditingDomain(false)} />
      )}

      {blog.pending_hostname ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-medium break-all">
              {t('blogs.movingTo', { domain: blog.pending_hostname })}
            </p>
            <Status status={blog.pending_status} />
          </div>
          <DnsSetup
            blog={blog}
            intro={t('blogs.moveIntro', { domain: blog.hostname })}
            checking={blog.pending_status === 'checking'}
            verifying={verify.isPending}
            onVerify={() => verify.mutate()}
          >
            <button
              type="button"
              className="button-outline"
              disabled={update.isPending}
              onClick={() => update.mutate({ hostname: blog.hostname })}
            >
              {t('blogs.cancelMove')}
            </button>
          </DnsSetup>
        </div>
      ) : (
        blog.status !== 'verified' && (
          <DnsSetup
            blog={blog}
            intro={t('blogs.dnsIntro')}
            checking={blog.status === 'checking'}
            verifying={verify.isPending}
            onVerify={() => verify.mutate()}
          />
        )
      )}

      {expanded && (
        <div
          id={bodyId}
          className="divide-y divide-zinc-200 border-t border-zinc-200 pt-6 dark:divide-zinc-800 dark:border-zinc-800"
        >
          <SettingsSection title={t('blogs.collection')} description={t('blogs.collectionHint')}>
            <CollectionSelect
              id={ids.collection}
              label={t('blogs.collection')}
              value={blog.collection}
              collections={collections}
              onChange={(collection) => update.mutate({ collection })}
            />
          </SettingsSection>

          <SettingsSection title={t('blogs.images')}>
            <div className="grid gap-6 sm:grid-cols-2">
              <BlogPhoto blog={blog} />
              <BlogSocialImage blog={blog} />
            </div>
          </SettingsSection>

          <SettingsSection title={t('blogs.about')}>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (!changed) return
                update.mutate({
                  title: title.trim(),
                  description: description.trim(),
                  author: author.trim(),
                  author_url: authorUrl.trim(),
                  links: filled,
                })
              }}
            >
              <div className="space-y-1">
                <label htmlFor={ids.title} className="block text-sm font-medium">
                  {t('blogs.title')}
                </label>
                <input
                  id={ids.title}
                  className="input"
                  value={title}
                  maxLength={120}
                  placeholder={collections.find((c) => c.id === blog.collection)?.name}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={ids.description} className="block text-sm font-medium">
                  {t('blogs.description')}
                </label>
                <input
                  id={ids.description}
                  className="input"
                  value={description}
                  maxLength={300}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor={ids.author} className="block text-sm font-medium">
                    {t('blogs.author')}
                  </label>
                  <input
                    id={ids.author}
                    className="input"
                    value={author}
                    maxLength={80}
                    onChange={(event) => setAuthor(event.target.value)}
                  />
                  <p className="text-xs text-zinc-500">{t('blogs.authorHint')}</p>
                </div>
                <div className="space-y-1">
                  <label htmlFor={ids.authorUrl} className="block text-sm font-medium">
                    {t('blogs.authorUrl')}
                  </label>
                  <input
                    id={ids.authorUrl}
                    className="input"
                    type="url"
                    value={authorUrl}
                    maxLength={500}
                    placeholder="https://"
                    onChange={(event) => setAuthorUrl(event.target.value)}
                  />
                  <p className="text-xs text-zinc-500">{t('blogs.authorUrlHint')}</p>
                </div>
              </div>
              <LinksEditor links={links} onChange={setLinks} />
              <div className="flex justify-end">
                <button type="submit" className="button-primary" disabled={!changed || update.isPending}>
                  {t('common.save')}
                </button>
              </div>
            </form>
          </SettingsSection>

          <SettingsSection title={t('blogs.display')}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={blog.show_author}
                disabled={update.isPending}
                onChange={(event) => update.mutate({ show_author: event.target.checked })}
              />
              <span>
                <span className="block font-medium">{t('blogs.showAuthor')}</span>
                <span className="block text-xs text-zinc-500">{t('blogs.showAuthorHint')}</span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={blog.powered_by}
                disabled={update.isPending}
                onChange={(event) => update.mutate({ powered_by: event.target.checked })}
              />
              <span>
                <span className="block font-medium">{t('blogs.poweredBy')}</span>
                <span className="block text-xs text-zinc-500">{t('blogs.poweredByHint')}</span>
              </span>
            </label>
          </SettingsSection>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}
    </section>
  )
}

type EditedLink = Blog['links'][number] & { key: number }

// Rows keep their key while they move, so typing and focus stay with the row.
let nextLinkKey = 0
function withKey(link: Blog['links'][number]): EditedLink {
  return { ...link, key: nextLinkKey++ }
}

/** Moves the row at `from` to `to`. */
function moved<T>(list: T[], from: number, to: number) {
  const next = [...list]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row)
  return next
}

/**
 * The blog's links, in the order its pages show them. Rows move by dragging
 * their handle, or with the arrow keys on it.
 */
function LinksEditor({ links, onChange }: { links: EditedLink[]; onChange: (links: EditedLink[]) => void }) {
  const t = useT()
  // The row whose handle is held: only that row is draggable, so text in the inputs stays selectable.
  const [held, setHeld] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const set = (index: number, changes: Partial<EditedLink>) =>
    onChange(links.map((each, at) => (at === index ? { ...each, ...changes } : each)))

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{t('blogs.links')}</legend>
      {links.map((link, index) => (
        <div
          key={link.key}
          draggable={held === link.key}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            setDragging(index)
          }}
          onDragOver={(event) => {
            if (dragging === null) return
            event.preventDefault()
            if (dragging !== index) {
              onChange(moved(links, dragging, index))
              setDragging(index)
            }
          }}
          onDragEnd={() => {
            setDragging(null)
            setHeld(null)
          }}
          className={`flex items-center gap-2 rounded-lg transition ${dragging === index ? 'opacity-50' : ''}`}
        >
          <button
            type="button"
            className="button-icon size-9 shrink-0 cursor-grab active:cursor-grabbing"
            aria-label={t('blogs.moveLink', { number: index + 1 })}
            onPointerDown={() => setHeld(link.key)}
            onPointerUp={() => dragging === null && setHeld(null)}
            onKeyDown={(event) => {
              const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null
              if (to === null || to < 0 || to >= links.length) return
              event.preventDefault()
              onChange(moved(links, index, to))
            }}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
          <input
            className="input"
            aria-label={t('blogs.linkName', { number: index + 1 })}
            placeholder={t('blogs.linkNamePlaceholder')}
            value={link.name}
            maxLength={60}
            onChange={(event) => set(index, { name: event.target.value })}
          />
          <input
            className="input"
            type="url"
            aria-label={t('blogs.linkUrl', { number: index + 1 })}
            placeholder="https://"
            value={link.url}
            maxLength={500}
            onChange={(event) => set(index, { url: event.target.value })}
          />
          <button
            type="button"
            className="button-icon size-9 shrink-0"
            aria-label={t('blogs.removeLink', { number: index + 1 })}
            onClick={() => onChange(links.filter((_, at) => at !== index))}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      {links.length < MAX_LINKS && (
        <button
          type="button"
          className="button-ghost inline-flex items-center gap-1.5 text-sm"
          onClick={() => onChange([...links, withKey({ name: '', url: '' })])}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('blogs.addLink')}
        </button>
      )}
    </fieldset>
  )
}

function Status({ status }: { status: Blog['status'] }) {
  const t = useT()
  if (status === 'verified') {
    return (
      <span role="status" className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
        <CircleCheck className="size-4" aria-hidden="true" />
        {t('blogs.verified')}
      </span>
    )
  }
  if (status === 'checking') {
    return (
      <span role="status" className="flex items-center gap-1 text-sm text-zinc-500">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {t('blogs.checking')}
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span role="status" className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
        <CircleAlert className="size-4" aria-hidden="true" />
        {t('blogs.failed')}
      </span>
    )
  }
  return (
    <span role="status" className="text-sm text-zinc-500">
      {t('blogs.unverified')}
    </span>
  )
}
