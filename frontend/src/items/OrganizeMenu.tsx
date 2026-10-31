import { Check, FolderPlus } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

import { useCollections, useCreateCollection, type Collection } from './api'
import { CollectionAvatar } from './CollectionAvatar'
import { CollectionPlace } from './CollectionPlace'

const OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 250
const MENU_WIDTH = 256
const MENU_MAX_HEIGHT = 340

export type OrganizeTriggerProps = {
  ref: Ref<HTMLButtonElement>
  onClick: () => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
}

/**
 * Organize in one click: hovering the trigger (or clicking it, on touch and
 * keyboard) lists the collections, and picking one organizes into it. Typing
 * filters the list or creates a collection; "Several collections…" opens the
 * full picker. With `onRemove`, picking a ticked collection takes it out.
 */
export function OrganizeMenu({
  current = [],
  onPick,
  onRemove,
  onMore,
  trigger,
}: {
  /** Collections it is already in: shown ticked. */
  current?: string[]
  onPick: (collection: Collection) => void
  onRemove?: (collection: Collection) => void
  onMore: () => void
  trigger: (props: OrganizeTriggerProps) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  // Opened by a click, not by hovering: the filter takes the keyboard.
  const [focusFilter, setFocusFilter] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  function later(action: () => void, ms: number) {
    clearTimeout(timer.current)
    timer.current = setTimeout(action, ms)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const hover = {
    onPointerEnter: (event: ReactPointerEvent) => {
      if (event.pointerType !== 'mouse') return
      later(() => setOpen(true), open ? 0 : OPEN_DELAY_MS)
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      if (event.pointerType !== 'mouse') return
      later(() => setOpen(false), CLOSE_DELAY_MS)
    },
  }

  function close() {
    clearTimeout(timer.current)
    setOpen(false)
    setFocusFilter(false)
  }

  return (
    <span className="relative inline-flex" {...hover}>
      {trigger({
        ref: button,
        onClick: () => {
          clearTimeout(timer.current)
          setFocusFilter(true)
          setOpen(true)
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      })}
      {open &&
        createPortal(
          <Menu
            anchor={button}
            current={current}
            focusFilter={focusFilter}
            hover={hover}
            onPick={(collection) => {
              close()
              onPick(collection)
            }}
            onRemove={
              onRemove &&
              ((collection) => {
                close()
                onRemove(collection)
              })
            }
            onMore={() => {
              close()
              onMore()
            }}
            onClose={() => {
              close()
              button.current?.focus()
            }}
          />,
          document.body,
        )}
    </span>
  )
}

function Menu({
  anchor,
  current,
  focusFilter,
  hover,
  onPick,
  onRemove,
  onMore,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>
  current: string[]
  focusFilter: boolean
  hover: Record<'onPointerEnter' | 'onPointerLeave', (event: ReactPointerEvent) => void>
  onPick: (collection: Collection) => void
  onRemove?: (collection: Collection) => void
  onMore: () => void
  onClose: () => void
}) {
  const collections = useCollections()
  const create = useCreateCollection()
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const menu = useRef<HTMLDivElement>(null)

  // Below the trigger, or above it when there's no room; inside the window.
  useLayoutEffect(() => {
    const trigger = anchor.current
    if (!trigger) return
    const place = () => {
      const rect = trigger.getBoundingClientRect()
      const up = window.innerHeight - rect.bottom < MENU_MAX_HEIGHT && rect.top > MENU_MAX_HEIGHT
      const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8)
      setPosition({ top: up ? rect.top - 4 : rect.bottom + 4, left, up })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  // A click anywhere else closes it.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !anchor.current?.contains(target)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [anchor, onClose])

  const all = collections.data ?? []
  const needle = query.trim().toLowerCase()
  const visible = needle ? all.filter((c) => c.name.toLowerCase().includes(needle)) : all
  const exact = all.find((c) => c.name.toLowerCase() === needle)

  /** Into it, or out of it when it's already in it (and that's allowed). */
  function toggle(collection: Collection) {
    if (!current.includes(collection.id)) onPick(collection)
    else if (onRemove) onRemove(collection)
  }

  function createAndPick() {
    create.mutate({ name: query.trim() }, { onSuccess: onPick })
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Organize into"
      className="popover fixed z-50 flex flex-col p-1.5"
      style={{
        width: MENU_WIDTH,
        maxHeight: MENU_MAX_HEIGHT,
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        transform: position?.up ? 'translateY(-100%)' : undefined,
      }}
      {...hover}
      // Inside a card: clicks here aren't the card's.
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') onClose()
      }}
    >
      <input
        className="input mb-1 py-1.5"
        placeholder="Find or create a collection"
        aria-label="Find or create a collection"
        autoFocus={focusFilter}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          const match = exact ?? (visible.length === 1 ? visible[0] : undefined)
          if (match) toggle(match)
          else if (needle) createAndPick()
        }}
      />
      {create.isError && (
        <p role="alert" className="px-2 py-1 text-xs text-red-600">
          {create.error.message}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.map((collection) => {
          const inIt = current.includes(collection.id)
          return (
            <button
              key={collection.id}
              type="button"
              role="menuitem"
              className="menu-item py-1.5"
              disabled={inIt && !onRemove}
              onClick={() => toggle(collection)}
            >
              <CollectionAvatar collection={collection} size="sm" />
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="truncate">{collection.name}</span>
                <CollectionPlace collections={all} id={collection.id} />
              </span>
              {inIt && (
                <Check
                  className="size-4 text-accent-500"
                  aria-label={onRemove ? 'In it: click to take it out' : 'Already in it'}
                />
              )}
            </button>
          )
        })}
        {collections.isSuccess && all.length === 0 && !needle && (
          <p className="px-3 py-2 text-sm text-zinc-500">Type a name to create the first collection.</p>
        )}
        {needle && !exact && (
          <button
            type="button"
            role="menuitem"
            className="menu-item py-1.5"
            disabled={create.isPending}
            onClick={createAndPick}
          >
            <FolderPlus className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Create “{query.trim()}”</span>
          </button>
        )}
      </div>
      <button
        type="button"
        role="menuitem"
        className="menu-item mt-1 border-t border-zinc-200 py-1.5 text-xs text-zinc-500 dark:border-zinc-800"
        onClick={onMore}
      >
        Several collections…
      </button>
    </div>
  )
}
