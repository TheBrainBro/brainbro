import { FileQuestion, Globe } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { currentLanguage, rich, t, useT } from '../i18n/i18n'
import { ApiError } from '../lib/api'
import { renderNote } from '../lib/markdown'
import { noteTitleIndex } from '../notes/wikilinks'
import { usePublicNote, usePublicNotes, type PublicNote } from '../public/api'
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

/** `/p`: every published note, the last published first. Open to anyone. */
export function PublicIndexPage() {
  useT()
  const notes = usePublicNotes()
  useTitle(t('public.notes'))

  return (
    <Frame>
      <h1 className="mb-6 text-2xl font-semibold">{t('public.notes')}</h1>
      {notes.isPending ? (
        <Loading />
      ) : notes.isError ? (
        <ErrorState error={notes.error} onRetry={() => notes.refetch()} />
      ) : notes.data.results.length === 0 ? (
        <EmptyState icon={Globe} title={t('public.none')} />
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {notes.data.results.map((note) => (
            <li key={note.slug}>
              <Link
                to={`/p/${note.slug}`}
                className="flex items-baseline justify-between gap-4 py-3 hover:text-accent-700 dark:hover:text-accent-300"
              >
                <span className="font-medium">{note.title}</span>
                <time dateTime={note.published_at} className="shrink-0 text-sm text-zinc-500">
                  {day(note.published_at)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

/** `/p/<slug>`: a published note, read-only and open to anyone. */
export function PublicNotePage() {
  useT()
  const { slug = '' } = useParams()
  const note = usePublicNote(slug)
  useTitle(note.data?.title)

  if (note.isPending) {
    return (
      <Frame>
        <Loading />
      </Frame>
    )
  }
  if (note.isError) {
    const missing = note.error instanceof ApiError && note.error.status === 404
    return (
      <Frame>
        {missing ? (
          <EmptyState icon={FileQuestion} title={t('public.missing')}>
            {t('public.missingHint')}
          </EmptyState>
        ) : (
          <ErrorState error={note.error} onRetry={() => note.refetch()} />
        )}
      </Frame>
    )
  }
  return (
    <Frame>
      <PublicArticle note={note.data} />
    </Frame>
  )
}

function PublicArticle({ note }: { note: PublicNote }) {
  useT()
  const navigate = useNavigate()
  const html = useMemo(
    () =>
      renderNote(note.body, {
        images: note.images,
        links: note.links,
        // Its author chose to show these players.
        embeds: true,
        notes: noteTitleIndex(note.notes.map(({ slug, title }) => ({ id: slug, title }))),
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
              author: (
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
          // Links to other published notes stay in the page.
          const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.wikilink')
          if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return
          event.preventDefault()
          navigate(link.getAttribute('href')!)
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
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
