import { useState } from 'react'

/** How a list of items is laid out. */
export type ViewMode = 'cards' | 'grid' | 'masonry' | 'list'

export const VIEW_MODES: ViewMode[] = ['cards', 'grid', 'masonry', 'list']

/** How wide the page gets: cards and lists read best narrow, grids want room. */
export const MODE_WIDTH: Record<ViewMode, string> = {
  cards: 'max-w-2xl',
  list: 'max-w-3xl',
  grid: 'max-w-6xl',
  masonry: 'max-w-6xl',
}

const KEY = 'brainbro:view-mode:'

/** The mode chosen for `view` (the inbox, collections), remembered on this device. */
export function useViewMode(view: string) {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(KEY + view)
      return VIEW_MODES.includes(stored as ViewMode) ? (stored as ViewMode) : 'cards'
    } catch {
      return 'cards'
    }
  })
  function choose(next: ViewMode) {
    setMode(next)
    try {
      localStorage.setItem(KEY + view, next)
    } catch {
      // Blocked storage: it holds for this visit only.
    }
  }
  return [mode, choose] as const
}
