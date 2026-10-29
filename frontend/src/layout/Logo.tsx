/** Brain's mark: three linked thoughts (the favicon, drawn to follow the theme). */
export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" className="fill-zinc-900 dark:fill-zinc-100" />
      <path
        d="M11 12 21 10M11 12 19 21M21 10 19 21"
        strokeWidth="1.2"
        className="stroke-zinc-50 opacity-60 dark:stroke-zinc-900"
      />
      <circle cx="11" cy="12" r="3" className="fill-accent-400 dark:fill-accent-500" />
      <circle cx="21" cy="10" r="2.5" className="fill-zinc-50 dark:fill-zinc-900" />
      <circle cx="19" cy="21" r="3.5" className="fill-accent-400 dark:fill-accent-500" />
    </svg>
  )
}
