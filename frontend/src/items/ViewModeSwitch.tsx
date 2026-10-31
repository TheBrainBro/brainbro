import { LayoutDashboard, LayoutGrid, List, Rows3, type LucideIcon } from 'lucide-react'

import type { ViewMode } from './viewMode'

export type ModeOption<M extends string> = { mode: M; label: string; icon: LucideIcon }

const MODES: ModeOption<ViewMode>[] = [
  { mode: 'cards', label: 'Cards', icon: Rows3 },
  { mode: 'grid', label: 'Grid', icon: LayoutGrid },
  { mode: 'masonry', label: 'Masonry', icon: LayoutDashboard },
  { mode: 'list', label: 'List', icon: List },
]

/** Picks how a page lays out its list: the item modes, or the `modes` given. */
export function ViewModeSwitch<M extends string = ViewMode>({
  mode,
  onChange,
  modes = MODES as ModeOption<string>[] as ModeOption<M>[],
}: {
  mode: M
  onChange: (mode: M) => void
  modes?: ModeOption<M>[]
}) {
  return (
    <div
      role="radiogroup"
      aria-label="View"
      className="flex items-center rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900"
    >
      {modes.map(({ mode: value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          aria-label={label}
          className="group/tip relative flex size-8 items-center justify-center rounded-md text-zinc-500 transition hover:text-zinc-900 aria-checked:bg-white aria-checked:text-accent-600 aria-checked:shadow-xs dark:hover:text-zinc-100 dark:aria-checked:bg-zinc-800 dark:aria-checked:text-accent-300"
          onClick={() => onChange(value)}
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="tooltip top-full mt-2">{label}</span>
        </button>
      ))}
    </div>
  )
}
