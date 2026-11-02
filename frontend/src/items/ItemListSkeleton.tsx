import { useT } from '../i18n/i18n'
import type { ViewMode } from './viewMode'

const SHAPES: Record<ViewMode, { list: string; item: string; count: number }> = {
  cards: { list: 'space-y-3', item: 'h-28 rounded-xl', count: 4 },
  list: { list: 'space-y-1.5', item: 'h-14 rounded-xl', count: 6 },
  grid: { list: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', item: 'aspect-[4/5] rounded-xl', count: 8 },
  masonry: { list: 'columns-1 gap-4 sm:columns-2 lg:columns-3', item: 'mb-4 rounded-xl', count: 6 },
}

// Masonry columns look like masonry only with uneven heights.
const MASONRY_HEIGHTS = ['h-40', 'h-28', 'h-56', 'h-32', 'h-48', 'h-24']

/** Where the items will be, shaped like the view they'll show in. */
export function ItemListSkeleton({ mode }: { mode: ViewMode }) {
  const t = useT()
  const shape = SHAPES[mode]
  return (
    <div role="status" aria-label={t('items.loadingItems')} className={shape.list}>
      {Array.from({ length: shape.count }, (_, index) => (
        <div
          key={index}
          className={`skeleton ${shape.item} ${mode === 'masonry' ? MASONRY_HEIGHTS[index] : ''}`}
        />
      ))}
    </div>
  )
}
