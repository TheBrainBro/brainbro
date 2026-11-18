import type { ReactNode } from 'react'

/**
 * One block of a settings page: a title, an optional one-line description and
 * its content. Put several inside a `divide-y` parent to separate them.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-4 py-6 first:pt-0 last:pb-0">
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold">{title}</h4>
        {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {children}
    </section>
  )
}
