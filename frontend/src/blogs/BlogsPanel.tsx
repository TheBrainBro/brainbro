import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { useT } from '../i18n/i18n'
import { useCollections, type Collection } from '../items/api'
import { CopyField } from '../ui/CopyField'
import { useFeedback } from '../ui/feedback'
import {
  useBlogs,
  useCreateBlog,
  useDeleteBlog,
  useUpdateBlog,
  useVerifyBlog,
  type Blog,
} from './api'

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

function BlogCard({ blog, collections }: { blog: Blog; collections: Collection[] }) {
  const t = useT()
  const { confirm } = useFeedback()
  const update = useUpdateBlog(blog.id)
  const remove = useDeleteBlog(blog.id)
  const verify = useVerifyBlog(blog.id)
  const [title, setTitle] = useState(blog.title)
  const [description, setDescription] = useState(blog.description)
  const ids = { collection: useId(), title: useId(), description: useId() }
  const error = update.error ?? remove.error ?? verify.error
  const changed = title.trim() !== blog.title || description.trim() !== blog.description

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
        <Status blog={blog} />
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

      {blog.status !== 'verified' && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('blogs.dnsIntro')}</p>
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
          <button
            type="button"
            className="button-primary"
            disabled={verify.isPending || blog.status === 'checking'}
            onClick={() => verify.mutate()}
          >
            {t('blogs.verify')}
          </button>
        </div>
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

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (changed) update.mutate({ title: title.trim(), description: description.trim() })
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
        <button type="submit" className="button-outline" disabled={!changed || update.isPending}>
          {t('common.save')}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error.message}
        </p>
      )}
    </section>
  )
}

function Status({ blog }: { blog: Blog }) {
  const t = useT()
  if (blog.status === 'verified') {
    return (
      <span role="status" className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
        <CircleCheck className="size-4" aria-hidden="true" />
        {t('blogs.verified')}
      </span>
    )
  }
  if (blog.status === 'checking') {
    return (
      <span role="status" className="flex items-center gap-1 text-sm text-zinc-500">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {t('blogs.checking')}
      </span>
    )
  }
  if (blog.status === 'failed') {
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
