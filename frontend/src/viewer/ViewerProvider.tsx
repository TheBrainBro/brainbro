import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'

import type { Item } from '../items/api'
import { ViewerContext, type Viewer, type ViewerOptions } from './context'

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

  return (
    <ViewerContext value={viewer}>
      {children}
      {open && (
        <Suspense>
          <ItemViewer
            items={open.items}
            index={open.index}
            actions={open.options.actions}
            onIndex={(index) => setOpen({ ...open, index })}
            onReplace={(item) =>
              setOpen({
                ...open,
                items: open.items.map((other) => (other.id === item.id ? item : other)),
              })
            }
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </ViewerContext>
  )
}
