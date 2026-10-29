import { ArrowLeft } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Link } from 'react-router'

/** "← Boards": up one level, the same everywhere. */
export function BackLink({
  to,
  label,
  onClick,
}: {
  to: string
  label: string
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <Link
      to={to}
      className="-ml-2 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      onClick={onClick}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  )
}
