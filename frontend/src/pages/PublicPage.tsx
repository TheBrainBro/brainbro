import { ArrowLeft, FileQuestion, Globe, Rss } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { currentLanguage, rich, t, useT } from '../i18n/i18n'
import { ApiError } from '../lib/api'
import { renderNote } from '../lib/markdown'
import { noteTitleIndex } from '../notes/wikilinks'
import {
  useLegacyNote,
  usePublicAuthor,
  usePublicNote,
  usePublicNotes,
  usePublicSite,
  type PublicNote,
  type PublicNoteSummary,
} from '../public/api'
import { EmptyState, ErrorState, Loading } from '../ui/states'

/** A day, as in "June 3, 2026", in the language shown. */
function day(iso: string) {
  return new Intl.DateTimeFormat(currentLanguage(), { dateStyle: 'long' }).format(new Date(iso))
}

/** The page's name in the browser tab, while it is open. */
function useTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return
    const before = document.title
    document.title = title
    return () => {
      document.title = before
    }
  }, [title])
}

/** In the app when it starts with `/`; another blog's full URL otherwise. */
function isLocal(url: string) {
  return url.startsWith('/') && !url.startsWith('//')
}

/** A link that stays in the page when it can, and leaves for another blog when not. */
function AnyLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return isLocal(to) ? (
    <Link to={to} className={className}>
      {children}
    </Link>
  ) : (
    <a href={to} className={className}>
      {children}
    </a>
  )
}

/**
 * The note's Markdown without its first line when that is a `# Title` equal
 * to the title the page already shows on top.
 */
function withoutTitle(body: string, title: string) {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(body)
  if (!match || match[1].trim().toLowerCase() !== title.trim().toLowerCase()) return body
  return body.slice(match[0].length)
}

/** Someone's photo, or the first letter of their name on the accent color. */
function PublicAvatar({ url, name, className }: { url: string | null; name: string; className: string }) {
  if (url) return <img src={url} alt="" className={`rounded-full object-cover ${className}`} />
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-accent-600 font-semibold text-white uppercase ${className}`}
    >
      {name.replace(/^@/, '').slice(0, 1) || '?'}
    </span>
  )
}

/** Who a page is about, on top of it: photo, name, handle, blurb and feed. */
function ProfileHeader({
  avatarUrl,
  name,
  detail,
  description,
  links = [],
  home,
  feed = false,
}: {
  avatarUrl: string | null
  name: string
  detail?: string
  description?: string
  links?: { name: string; url: string }[]
  /** Where the name leads; it is the page's heading when absent. */
  home?: string
  feed?: boolean
}) {
  useT()
  return (
    <header className="relative flex flex-col items-center text-center">
      {feed && (
        <a
          href="/rss"
          className="button-icon absolute top-0 right-0 size-9 text-zinc-400"
          aria-label={t('public.feed')}
          title={t('public.feed')}
        >
          <Rss className="size-4" aria-hidden="true" />
        </a>
      )}
      <PublicAvatar
        url={avatarUrl}
        name={name}
        className="size-24 text-3xl shadow-sm ring-4 ring-white dark:ring-zinc-900"
      />
      {home ? (
        <Link
          to={home}
          className="mt-5 font-display text-3xl font-semibold tracking-tight hover:text-accent-700 dark:hover:text-accent-300"
        >
          {name}
        </Link>
      ) : (
        <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">{name}</h1>
      )}
      {detail && <p className="mt-1 text-zinc-500">{detail}</p>}
      {description && (
        <p className="mt-4 max-w-md text-zinc-700 dark:text-zinc-300">{description}</p>
      )}
      {links.length > 0 && (
        <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
          {links.map((link) => (
            <li key={`${link.name}-${link.url}`}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-700 hover:underline dark:text-accent-300"
              >
                {link.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </header>
  )
}

/** A published note in a list: its title, the start of its text, its date and its cover. */
function NoteCard({ note }: { note: PublicNoteSummary }) {
  return (
    <AnyLink
      to={note.url}
      className="group -mx-4 flex gap-5 rounded-2xl px-4 py-5 transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-xl leading-snug font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-300">
          {note.title}
        </h2>
        {note.excerpt && (
          <p className="mt-1.5 line-clamp-3 text-zinc-600 dark:text-zinc-400">{note.excerpt}</p>
        )}
        <time dateTime={note.published_at} className="mt-3 block text-sm text-zinc-500">
          {day(note.published_at)}
        </time>
      </div>
      {note.image_url && (
        <img
          src={note.image_url}
          alt=""
          className="size-20 shrink-0 self-center rounded-xl object-cover sm:size-28"
        />
      )}
    </AnyLink>
  )
}

/**
 * The published notes the server lists here: all of them, the blog's, or
 * one author's; without `except`, and up to `limit` of them.
 */
function NoteList({
  author,
  category,
  except,
  limit,
  empty = true,
}: {
  author?: string
  /** On a blog, one of its categories. */
  category?: string
  except?: string
  limit?: number
  /** Says so when there are none; otherwise shows nothing. */
  empty?: boolean
}) {
  useT()
  const notes = usePublicNotes({ author, category })

  if (notes.isPending) return empty ? <Loading /> : null
  if (notes.isError) {
    return empty ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : null
  }
  const shown = notes.data.results.filter((note) => note.slug !== except).slice(0, limit)
  if (shown.length === 0) return empty ? <EmptyState icon={Globe} title={t('public.none')} /> : null
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
      {shown.map((note) => (
        <li key={note.url}>
          <NoteCard note={note} />
        </li>
      ))}
    </ul>
  )
}

/** `/p`: every published note, the last published first. Open to anyone. */
export function PublicIndexPage() {
  useT()
  useTitle(t('public.notes'))

  return (
    <Frame poweredBy>
      <h1 className="mb-6 font-display text-3xl font-semibold">{t('public.notes')}</h1>
      <NoteList />
    </Frame>
  )
}

/**
 * `/@<handle>`: an author's page, with all their public notes, newest first.
 * The route matches any one segment, so anything else goes back to the app.
 */
export function PublicAuthorPage() {
  const { handle = '' } = useParams()
  if (!handle.startsWith('@')) return <Navigate to="/" replace />
  return <AuthorPage handle={handle.slice(1)} />
}

function AuthorPage({ handle }: { handle: string }) {
  useT()
  const author = usePublicAuthor(handle)
  const name = author.data ? author.data.author || `@${author.data.handle}` : undefined
  useTitle(name)

  return (
    <Frame poweredBy>
      {author.isError ? (
        <Missing error={author.error} onRetry={() => author.refetch()} />
      ) : author.data && name ? (
        <>
          <ProfileHeader
            avatarUrl={author.data.avatar_url}
            name={name}
            detail={author.data.author ? `@${author.data.handle}` : undefined}
          />
          <div className="mt-12">
            <NoteList author={handle} />
          </div>
        </>
      ) : (
        <Loading />
      )}
    </Frame>
  )
}

/**
 * `/@<handle>/<slug>`: a published note, read-only and open to anyone. The
 * route matches any two segments, so anything else goes back to the app.
 */
export function PublicNotePage() {
  const { handle = '', slug = '' } = useParams()
  if (!handle.startsWith('@')) return <Navigate to="/" replace />
  return <PublicNoteView handle={handle.slice(1)} slug={slug} />
}

/** `/p/<slug>`, where notes were before handles: off to where it lives now. */
export function LegacyPublicNotePage() {
  useT()
  const { slug = '' } = useParams()
  const found = useLegacyNote(slug)

  useEffect(() => {
    if (found.data && !isLocal(found.data.url)) window.location.replace(found.data.url)
  }, [found.data])

  if (found.data && isLocal(found.data.url)) return <Navigate to={found.data.url} replace />
  if (found.isError) {
    return (
      <Frame>
        <Missing error={found.error} onRetry={() => found.refetch()} />
      </Frame>
    )
  }
  return (
    <Frame>
      <Loading />
    </Frame>
  )
}

function PublicNoteView({ handle, slug }: { handle: string; slug: string }) {
  useT()
  const note = usePublicNote(handle, slug)
  useTitle(note.data?.title)

  return (
    <>
      <TopBar
        home={`/@${handle}`}
        name={note.data ? note.data.author || `@${note.data.handle}` : undefined}
        avatarUrl={note.data?.avatar_url ?? null}
      />
      <Frame poweredBy>
        {note.isPending ? (
          <Loading />
        ) : note.isError ? (
          <Missing error={note.error} onRetry={() => note.refetch()} />
        ) : (
          <PublicArticle note={note.data} home={`/@${handle}`} author={handle} />
        )}
      </Frame>
    </>
  )
}

/** On top of a note: whose it is (the blog, or its author), leading back to all their posts. */
function TopBar({
  home,
  name,
  avatarUrl,
  feed = false,
}: {
  home: string
  name: string | undefined
  avatarUrl: string | null
  feed?: boolean
}) {
  useT()
  return (
    <nav className="sticky top-0 z-10 border-b border-zinc-100 bg-white/85 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/85">
      <div className="mx-auto flex min-h-14 max-w-2xl items-center justify-between gap-4 px-4 py-3">
        <Link
          to={home}
          className="flex min-w-0 items-center gap-2.5 font-semibold hover:text-accent-700 dark:hover:text-accent-300"
        >
          {name && <PublicAvatar url={avatarUrl} name={name} className="size-7 text-xs" />}
          <span className="truncate">{name ?? '\u00a0'}</span>
        </Link>
        {feed && (
          <a href="/rss" className="button-icon size-8" aria-label={t('public.feed')}>
            <Rss className="size-4" aria-hidden="true" />
          </a>
        )}
      </div>
    </nav>
  )
}

function Missing({ error, onRetry }: { error: Error; onRetry: () => void }) {
  useT()
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState icon={FileQuestion} title={t('public.missing')}>
        {t('public.missingHint')}
      </EmptyState>
    )
  }
  return <ErrorState error={error} onRetry={onRetry} />
}

/**
 * A published note as an article: its date, its title, its text, then more
 * of the author's notes. Whose it is shows in the `TopBar` above. `home` is
 * where all their posts are (their page, or the blog's index); `author`
 * narrows "more" to theirs.
 */
function PublicArticle({ note, home, author }: { note: PublicNote; home: string; author?: string }) {
  useT()
  const navigate = useNavigate()
  const name = note.author || `@${note.handle}`
  const html = useMemo(
    () =>
      renderNote(withoutTitle(note.body, note.title), {
        images: note.images,
        links: note.links,
        // Its author chose to show these players.
        embeds: true,
        notes: noteTitleIndex(note.notes.map(({ url, title }) => ({ id: url, title }))),
        isPublic: true,
      }),
    [note],
  )
  const edited = note.edited_at && note.edited_at > note.published_at ? note.edited_at : null

  return (
    <article>
      <p className="text-sm text-zinc-500">
        <time dateTime={note.published_at}>{day(note.published_at)}</time>
        {edited && (
          <>
            {' · '}
            {rich('public.updated', { date: <time dateTime={edited}>{day(edited)}</time> })}
          </>
        )}
      </p>
      <h1 className="mt-2 font-display text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
        {note.title}
      </h1>

      <div
        className="markdown markdown-article mt-8 break-words"
        onClick={(event) => {
          // Links to other published notes stay in the page; another blog's open as links.
          const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.wikilink')
          const href = link?.getAttribute('href')
          if (!href || !isLocal(href) || event.metaKey || event.ctrlKey || event.shiftKey) return
          event.preventDefault()
          navigate(href)
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <footer className="mt-16 border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <MoreNotes author={author} except={note.slug} name={name} />
        <Link
          to={home}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 hover:underline dark:text-accent-300"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('public.allPosts')}
        </Link>
      </footer>
    </article>
  )
}

/** Up to three more of their notes, under a heading; nothing when there are none. */
function MoreNotes({ author, except, name }: { author?: string; except: string; name: string }) {
  useT()
  const notes = usePublicNotes({ author })
  const more = (notes.data?.results ?? []).filter((note) => note.slug !== except).slice(0, 3)
  if (more.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold text-zinc-500">{t('public.moreFrom', { name })}</h2>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800/70">
        {more.map((other) => (
          <li key={other.url}>
            <NoteCard note={other} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A blog's index, at the root of its own domain. */
export function SiteIndexPage() {
  useT()
  const { category } = useParams()
  const site = usePublicSite()
  const current = site.data?.categories.find((each) => each.slug === category)
  useTitle(site.data && (current ? `${current.name} · ${site.data.title}` : site.data.title))

  return (
    <Frame poweredBy={site.data?.powered_by}>
      {site.isError ? (
        <Missing error={site.error} onRetry={() => site.refetch()} />
      ) : site.data ? (
        <>
          <ProfileHeader
            avatarUrl={site.data.avatar_url}
            name={site.data.title || site.data.hostname}
            detail={
              site.data.author && site.data.author !== site.data.title ? site.data.author : undefined
            }
            description={site.data.description}
            links={site.data.links}
            home="/"
            feed
          />
          {site.data.categories.length > 0 && (
            <Categories categories={site.data.categories} current={category} />
          )}
          <div className={site.data.categories.length > 0 ? 'mt-6' : 'mt-12'}>
            <NoteList category={category} />
          </div>
        </>
      ) : (
        <Loading />
      )}
    </Frame>
  )
}

/** A blog's categories as tabs: all its posts, then each one's, at `/c/<slug>`. */
function Categories({
  categories,
  current,
}: {
  categories: { slug: string; name: string }[]
  current: string | undefined
}) {
  useT()
  const tabs: { slug?: string; name: string; to: string }[] = [
    { name: t('public.allPosts'), to: '/' },
    ...categories.map((each) => ({ slug: each.slug, name: each.name, to: `/c/${each.slug}` })),
  ]
  return (
    <nav
      aria-label={t('public.categories')}
      className="mt-12 flex gap-1 overflow-x-auto border-b border-zinc-100 dark:border-zinc-800/70"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={tab.slug === current ? 'page' : undefined}
          className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-zinc-500 hover:text-zinc-900 aria-[current=page]:border-accent-500 aria-[current=page]:font-semibold aria-[current=page]:text-zinc-900 dark:hover:text-zinc-100 dark:aria-[current=page]:text-zinc-100"
        >
          {tab.name}
        </Link>
      ))}
    </nav>
  )
}

/** A note on a blog's own domain: `/<slug>`, under a bar back to the blog. */
export function SiteNotePage() {
  useT()
  const { slug = '' } = useParams()
  const site = usePublicSite()
  const note = usePublicNote(site.data?.handle ?? '', slug)
  useTitle(note.data?.title)

  return (
    <>
      <TopBar
        home="/"
        name={site.data ? site.data.title || site.data.hostname : undefined}
        avatarUrl={site.data?.avatar_url ?? null}
        feed
      />
      <Frame poweredBy={site.data?.powered_by}>
        {site.isError ? (
          <Missing error={site.error} onRetry={() => site.refetch()} />
        ) : note.isError ? (
          <Missing error={note.error} onRetry={() => note.refetch()} />
        ) : note.data ? (
          <PublicArticle note={note.data} home="/" />
        ) : (
          <Loading />
        )}
      </Frame>
    </>
  )
}

/** A public page's column; `poweredBy` ends it with a small line about BrainBro. */
function Frame({ children, poweredBy = false }: { children: ReactNode; poweredBy?: boolean }) {
  useT()
  return (
    <div className="min-h-full bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl px-4 pt-14 pb-20 sm:pt-20">
        {children}
        {poweredBy && (
          <p className="mt-20 text-center text-xs text-zinc-400 dark:text-zinc-600">
            {rich('public.poweredBy', {
              brand: (
                <a
                  href="https://brainbro.app"
                  className="font-medium hover:text-accent-700 dark:hover:text-accent-300"
                >
                  BrainBro
                </a>
              ),
            })}
          </p>
        )}
      </div>
    </div>
  )
}
