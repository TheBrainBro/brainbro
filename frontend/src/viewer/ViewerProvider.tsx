import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'

import { useTriage, type Item } from '../items/api'
import { triageMessage } from '../items/triage'
import { useFeedback } from '../ui/feedback'
import { ViewerContext, type Viewer, type ViewerOptions } from './context'

// Loaded the first time something is opened.
const ItemViewer = lazy(() => import('./ItemViewer'))

type Open = { items: Item[]; index: number; options: ViewerOptions }

/** Lets anything in the app open items full screen, one viewer at a time. */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const triage = useTriage()
  const { toast, confirm } = useFeedback()
  const viewer = useMemo<Viewer>(
    () => ({ open: (items, index, options = {}) => setOpen({ items, index, options }) }),
    [],
  )

  async function remove(item: Item) {
    const confirmed = await confirm({
      title: 'Delete this item?',
      message: "It can't be undone.",
      confirm: 'Delete',
      danger: true,
    })
    if (!confirmed) return
    triage.mutate(
      { ids: [item.id], action: 'delete' },
      {
        onSuccess: () => {
          setOpen(null)
          toast({ message: triageMessage('delete', 1) })
        },
        onError: (error) => toast({ message: error.message, tone: 'error' }),
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
            onReplace={(item) =>
              setOpen({
                ...open,
                items: open.items.map((other) => (other.id === item.id ? item : other)),
              })
            }
            onDelete={remove}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </ViewerContext>
  )
}
