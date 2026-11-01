import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

import { useNoteTitleList } from '../items/api'
import { noteTitleIndex, NoteTitlesContext, type NoteTitles } from './wikilinks'

/** Lets notes anywhere in the app resolve and follow their `[[Title]]` links. */
export function NoteTitlesProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { data } = useNoteTitleList()
  const value = useMemo<NoteTitles>(() => {
    const titles = data ?? []
    return { titles, index: noteTitleIndex(titles), open: (id) => navigate(`/notes/${id}`) }
  }, [data, navigate])
  return <NoteTitlesContext value={value}>{children}</NoteTitlesContext>
}
