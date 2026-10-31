import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'

import type { Item } from '../items/api'
import { ViewerContext, type Viewer, type ViewerOptions } from './context'
import { ViewerTriage } from './ViewerTriage'

// Loaded the first time something is opened.
const ItemViewer = lazy(() => import('./ItemViewer'))

type Open = { items: Item[]; index: number; options: ViewerOptions }

/** Lets anything in the app open items full screen, one viewer at a time. */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const viewer = useMemo<Viewer>(
    () => ({ open: (items, index, options = {}) => setOpen({ items, index, options }) }),
    [],
  )

  function replace(item: Item) {
    setOpen((current) =>
      current && {
        ...current,
        items: current.items.map((other) => (other.id === item.id ? item : other)),
      },
    )
  }

  return (
    <ViewerContext value={viewer}>
      {children}
      {open && (
        <Suspense>
          <ItemViewer
            items={open.items}
            index={open.index}
            actions={open.options.actions}
            image={open.options.image}
            onIndex={(index) => setOpen({ ...open, index })}
            onReplace={replace}
            controls={(item) => (
              <ViewerTriage item={item} onChanged={replace} onDeleted={() => setOpen(null)} />
            )}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </ViewerContext>
  )
}
