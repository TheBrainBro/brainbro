import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { useT } from '../i18n/i18n'
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
      <NewBlog collections={collections.data ?? []} />
    </div>
  )
}

function CollectionSelect({
  id,
  value,
  collections,
  onChange,
}: {
  id: string
  value: string | null
  collections: Collection[]
  onChange: (value: string | null) => void
}) {
  const t = useT()
  return (
    <select
      id={id}
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

function NewBlog({ collections }: { collections: Collection[] }) {
  const t = useT()
  const create = useCreateBlog()
  const [hostname, setHostname] = useState('')
  const [collection, setCollection] = useState<string | null>(null)
  const ids = { hostname: useId(), collection: useId() }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!hostname.trim() || create.isPending) return
    create.mutate(
      { hostname: hostname.trim(), collection },
      {
        onSuccess: () => {
          setHostname('')
          setCollection(null)
        },
      },
    )
  }

  return (
    <form className="space-y-3 sm:max-w-md" onSubmit={submit}>
      <h4 className="text-sm font-semibold">{t('blogs.add')}</h4>
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
      <button type="submit" className="button-primary" disabled={!hostname.trim() || create.isPending}>
        {t('blogs.addButton')}
      </button>
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
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setError(undefined)
    let square: Blob
    try {
      square = await squareImage(file)
    } catch {
      return setError(t('profile.notAnImage'))
    }
    setAvatar.mutate(square, { onError: (failure) => setError(failure.message) })
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{t('blogs.photo')}</p>
      <div className="flex items-center gap-4">
        {blog.avatar_url ? (
          <img src={blog.avatar_url} alt="" className="size-16 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
          >
            <ImagePlus className="size-5" />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button-outline"
            disabled={setAvatar.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {blog.avatar_url ? t('profile.changePhoto') : t('profile.uploadPhoto')}
          </button>
          {blog.avatar_url && (
            <button
              type="button"
              className="button-secondary inline-flex items-center gap-2"
              disabled={setAvatar.isPending}
              onClick={() =>
                setAvatar.mutate(null, { onError: (failure) => setError(failure.message) })
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('common.remove')}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label={t('blogs.photo')}
            className="hidden"
            onChange={(event) => {
              void pickPhoto(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
      </div>
      <p className="text-xs text-zinc-500">{t('blogs.photoHint')}</p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

/** What links to the blog, and to its posts with no image of their own, show. */
function BlogSocialImage({ blog }: { blog: Blog }) {
  const t = useT()
  const setImage = useSetBlogSocialImage(blog.id)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)

  async function pickImage(file: File | undefined) {
    if (!file) return
    setError(undefined)
    let image: Blob
    try {
      image = await socialImage(file)
    } catch {
      return setError(t('profile.notAnImage'))
    }
    setImage.mutate(image, { onError: (failure) => setError(failure.message) })
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{t('blogs.socialImage')}</p>
      <div className="flex flex-wrap items-center gap-4">
        {blog.social_image_url ? (
          <img
            src={blog.social_image_url}
            alt=""
            className="aspect-[1200/630] h-16 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex aspect-[1200/630] h-16 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
          >
            <ImagePlus className="size-5" />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button-outline"
            disabled={setImage.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {blog.social_image_url ? t('blogs.changeImage') : t('blogs.uploadImage')}
          </button>
          {blog.social_image_url && (
            <button
              type="button"
              className="button-secondary inline-flex items-center gap-2"
              disabled={setImage.isPending}
              onClick={() =>
                setImage.mutate(null, { onError: (failure) => setError(failure.message) })
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('common.remove')}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label={t('blogs.socialImage')}
            className="hidden"
            onChange={(event) => {
              void pickImage(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
      </div>
      <p className="text-xs text-zinc-500">{t('blogs.socialImageHint')}</p>
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
  const [title, setTitle] = useState(blog.title)
  const [description, setDescription] = useState(blog.description)
  const [author, setAuthor] = useState(blog.author)
  const [authorUrl, setAuthorUrl] = useState(blog.author_url)
  const [links, setLinks] = useState(blog.links)
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
        <h4 className="mr-auto font-semibold break-all">{blog.hostname}</h4>
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
          className="button-icon size-8"
          aria-label={t('blogs.delete')}
          disabled={remove.isPending}
          onClick={() => void deleteBlog()}
        >
          <Trash2 className="size-4" aria-hidden="true" />
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

      <div className="space-y-1">
        <label htmlFor={ids.collection} className="block text-sm font-medium">
          {t('blogs.collection')}
        </label>
        <CollectionSelect
          id={ids.collection}
          value={blog.collection}
          collections={collections}
          onChange={(collection) => update.mutate({ collection })}
        />
      </div>

      <BlogPhoto blog={blog} />
      <BlogSocialImage blog={blog} />

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
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{t('blogs.links')}</legend>
          {links.map((link, index) => (
            <div key={index} className="flex gap-2">
              <input
                className="input"
                aria-label={t('blogs.linkName', { number: index + 1 })}
                placeholder={t('blogs.linkNamePlaceholder')}
                value={link.name}
                maxLength={60}
                onChange={(event) =>
                  setLinks(links.map((each, at) => (at === index ? { ...each, name: event.target.value } : each)))
                }
              />
              <input
                className="input"
                type="url"
                aria-label={t('blogs.linkUrl', { number: index + 1 })}
                placeholder="https://"
                value={link.url}
                maxLength={500}
                onChange={(event) =>
                  setLinks(links.map((each, at) => (at === index ? { ...each, url: event.target.value } : each)))
                }
              />
              <button
                type="button"
                className="button-icon size-9 shrink-0"
                aria-label={t('blogs.removeLink', { number: index + 1 })}
                onClick={() => setLinks(links.filter((_, at) => at !== index))}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          {links.length < MAX_LINKS && (
            <button
              type="button"
              className="button-ghost inline-flex items-center gap-1.5 text-sm"
              onClick={() => setLinks([...links, { name: '', url: '' }])}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('blogs.addLink')}
            </button>
          )}
        </fieldset>
        <button type="submit" className="button-outline cursor-pointer" disabled={!changed || update.isPending}>
          {t('common.save')}
        </button>
      </form>

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

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}
    </section>
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
