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
  home,
  feed = false,
}: {
  avatarUrl: string | null
  name: string
  detail?: string
  description?: string
  /** Where the name leads; it is the page's heading when absent. */
  home?: string
  feed?: boolean
}) {
  useT()
  return (
    <header className="flex flex-col items-center text-center">
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
      {feed && (
        <a
          href="/rss"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-600 transition hover:border-accent-300 hover:text-accent-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-accent-700 dark:hover:text-accent-300"
        >
          <Rss className="size-3.5" aria-hidden="true" />
          {t('public.feed')}
        </a>
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
  except,
  limit,
  empty = true,
}: {
  author?: string
  except?: string
  limit?: number
  /** Says so when there are none; otherwise shows nothing. */
  empty?: boolean
}) {
  useT()
  const notes = usePublicNotes(author)

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
    <Frame>
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
    <Frame>
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
    <Frame>
      {note.isPending ? (
        <Loading />
      ) : note.isError ? (
        <Missing error={note.error} onRetry={() => note.refetch()} />
      ) : (
        <PublicArticle note={note.data} home={`/@${handle}`} author={handle} />
      )}
    </Frame>
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
 * A published note as an article: its author and date, its title, its text,
 * then more of the author's notes. `home` is where its author's notes are
 * (their page, or the blog's index); `author` narrows "more" to theirs.
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
      <Link to={home} className="group flex items-center gap-3">
        <PublicAvatar url={note.avatar_url} name={name} className="size-11 text-base" />
        <span className="min-w-0">
          <span className="block font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-300">
            {name}
          </span>
          {note.author && <span className="block text-sm text-zinc-500">@{note.handle}</span>}
        </span>
      </Link>

      <p className="mt-8 text-sm text-zinc-500">
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
        <h2 className="text-sm font-semibold text-zinc-500">{t('public.moreFrom', { name })}</h2>
        <div className="mt-2">
          <NoteList author={author} except={note.slug} limit={3} empty={false} />
        </div>
        <Link
          to={home}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 hover:underline dark:text-accent-300"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('public.allNotes')}
        </Link>
      </footer>
    </article>
  )
}

/** A blog's index, at the root of its own domain. */
export function SiteIndexPage() {
  useT()
  const site = usePublicSite()
  useTitle(site.data?.title)

  return (
    <Frame>
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
            home="/"
            feed
          />
          <div className="mt-12">
            <NoteList />
          </div>
        </>
      ) : (
        <Loading />
      )}
    </Frame>
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
      <nav className="sticky top-0 z-10 border-b border-zinc-100 bg-white/85 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 font-semibold hover:text-accent-700 dark:hover:text-accent-300"
          >
            {site.data && (
              <PublicAvatar url={site.data.avatar_url} name={site.data.title} className="size-7 text-xs" />
            )}
            <span className="truncate">{site.data?.title || site.data?.hostname || ' '}</span>
          </Link>
          <a href="/rss" className="button-icon size-8" aria-label={t('public.feed')}>
            <Rss className="size-4" aria-hidden="true" />
          </a>
        </div>
      </nav>
      <Frame>
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

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl px-4 pt-14 pb-20 sm:pt-20">{children}</div>
    </div>
  )
}
