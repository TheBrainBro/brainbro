import { FileQuestion, Globe, Rss } from 'lucide-react'
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

/** `/p`: every published note, the last published first. Open to anyone. */
export function PublicIndexPage() {
  useT()
  useTitle(t('public.notes'))

  return (
    <Frame>
      <h1 className="mb-6 text-2xl font-semibold">{t('public.notes')}</h1>
      <NoteList />
    </Frame>
  )
}

/** The published notes the server lists here: all of them, the blog's, or one author's. */
function NoteList({ author }: { author?: string }) {
  useT()
  const notes = usePublicNotes(author)

  if (notes.isPending) return <Loading />
  if (notes.isError) return <ErrorState error={notes.error} onRetry={() => notes.refetch()} />
  if (notes.data.results.length === 0) return <EmptyState icon={Globe} title={t('public.none')} />
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {notes.data.results.map((note) => (
        <li key={note.url}>
          <NoteLink note={note} />
        </li>
      ))}
    </ul>
  )
}

function NoteLink({ note }: { note: PublicNoteSummary }) {
  const className =
    'flex items-baseline justify-between gap-4 py-3 hover:text-accent-700 dark:hover:text-accent-300'
  const content = (
    <>
      <span className="font-medium">{note.title}</span>
      <time dateTime={note.published_at} className="shrink-0 text-sm text-zinc-500">
        {day(note.published_at)}
      </time>
    </>
  )
  return isLocal(note.url) ? (
    <Link to={note.url} className={className}>
      {content}
    </Link>
  ) : (
    <a href={note.url} className={className}>
      {content}
    </a>
  )
}

/**
 * `/@<handle>/<slug>`: a published note, read-only and open to anyone. The
 * route matches any two segments, so anything else goes back to the app.
 */
export function PublicNotePage() {
  const { handle = '', slug = '' } = useParams()
  if (!handle.startsWith('@')) return <Navigate to="/" replace />
  return <PublicNote handle={handle.slice(1)} slug={slug} />
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
      ) : author.data ? (
        <>
          <h1 className="text-2xl font-semibold">{name}</h1>
          {author.data.author && <p className="mt-1 text-sm text-zinc-500">@{author.data.handle}</p>}
          <div className="mt-8">
            <NoteList author={handle} />
          </div>
        </>
      ) : (
        <Loading />
      )}
    </Frame>
  )
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

function PublicNote({ handle, slug }: { handle: string; slug: string }) {
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
        <PublicArticle note={note.data} authorPage={`/@${handle}`} />
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

/** A published note; `authorPage` links its byline to its author's page. */
function PublicArticle({ note, authorPage }: { note: PublicNote; authorPage?: string }) {
  useT()
  const navigate = useNavigate()
  const html = useMemo(
    () =>
      renderNote(note.body, {
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
      <p className="mb-6 text-sm text-zinc-500">
        {note.author && (
          <>
            {rich('public.by', {
              author: authorPage ? (
                <Link
                  to={authorPage}
                  className="font-medium text-zinc-700 hover:text-accent-700 dark:text-zinc-300 dark:hover:text-accent-300"
                >
                  {note.author}
                </Link>
              ) : (
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{note.author}</span>
              ),
            })}
            {' · '}
          </>
        )}
        <time dateTime={note.published_at}>{day(note.published_at)}</time>
        {edited && (
          <>
            {' · '}
            {rich('public.updated', { date: <time dateTime={edited}>{day(edited)}</time> })}
          </>
        )}
      </p>
      <div
        className="markdown break-words"
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
    </article>
  )
}

/** A blog's index, at the root of its own domain. */
export function SiteIndexPage() {
  useT()
  const site = usePublicSite()
  useTitle(site.data?.title)

  return (
    <SiteFrame>
      {site.data?.description && (
        <p className="-mt-4 mb-8 text-zinc-600 dark:text-zinc-400">{site.data.description}</p>
      )}
      <NoteList />
    </SiteFrame>
  )
}

/** A note on a blog's own domain: `/<slug>`. */
export function SiteNotePage() {
  useT()
  const { slug = '' } = useParams()
  const site = usePublicSite()
  const note = usePublicNote(site.data?.handle ?? '', slug)
  useTitle(note.data?.title)

  return (
    <SiteFrame>
      {site.isError ? (
        <Missing error={site.error} onRetry={() => site.refetch()} />
      ) : note.isError ? (
        <Missing error={note.error} onRetry={() => note.refetch()} />
      ) : note.data ? (
        <PublicArticle note={note.data} />
      ) : (
        <Loading />
      )}
    </SiteFrame>
  )
}

/** A blog's pages: its name on top, leading back to its index, and its feed. */
function SiteFrame({ children }: { children: ReactNode }) {
  useT()
  const site = usePublicSite()
  return (
    <Frame>
      <header className="mb-10 flex items-center justify-between gap-4">
        <Link to="/" className="text-2xl font-semibold hover:text-accent-700 dark:hover:text-accent-300">
          {site.data?.title || site.data?.hostname || ' '}
        </Link>
        <a href="/rss.xml" className="button-icon size-8" aria-label={t('public.feed')}>
          <Rss className="size-4" aria-hidden="true" />
        </a>
      </header>
      {children}
    </Frame>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl px-4 pt-16 pb-16">
        {children}
      </div>
    </div>
  )
}
