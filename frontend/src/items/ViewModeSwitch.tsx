import { LayoutDashboard, LayoutGrid, List, Rows3, type LucideIcon } from 'lucide-react'

import type { ViewMode } from './viewMode'

const MODES: { mode: ViewMode; label: string; icon: LucideIcon }[] = [
  { mode: 'cards', label: 'Cards', icon: Rows3 },
  { mode: 'grid', label: 'Grid', icon: LayoutGrid },
  { mode: 'masonry', label: 'Masonry', icon: LayoutDashboard },
  { mode: 'list', label: 'List', icon: List },
]

export function ViewModeSwitch({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="View"
      className="flex items-center rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900"
    >
      {MODES.map(({ mode: value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          aria-label={label}
          className="group relative flex size-8 items-center justify-center rounded-md text-zinc-500 transition hover:text-zinc-900 aria-checked:bg-white aria-checked:text-accent-600 aria-checked:shadow-xs dark:hover:text-zinc-100 dark:aria-checked:bg-zinc-800 dark:aria-checked:text-accent-300"
          onClick={() => onChange(value)}
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="tooltip top-full mt-2">{label}</span>
        </button>
      ))}
    </div>
  )
}
