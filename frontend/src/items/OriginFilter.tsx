import { useItemApps, type ItemFilters } from './api'

export type OriginFilters = Pick<ItemFilters, 'origin' | 'app'>

/** As one value for the select: "", "mine", "assistants" or "app:<name>". */
function encode({ origin, app }: OriginFilters) {
  return app ? `app:${app}` : (origin ?? '')
}

function decode(value: string): OriginFilters {
  if (value.startsWith('app:')) return { app: value.slice(4) }
  if (value === 'mine' || value === 'assistants') return { origin: value }
  return {}
}

/** Picks whose items show: everyone's, only mine, any assistant's or one app's. */
export function OriginFilter({
  value,
  onChange,
}: {
  value: OriginFilters
  onChange: (value: OriginFilters) => void
}) {
  const apps = useItemApps()
  const names = apps.data ?? []
  // Nothing an app made yet: nothing to filter by.
  if (names.length === 0 && !value.origin && !value.app) return null
  return (
    <select
      aria-label="Made by"
      className="input w-auto py-1.5"
      value={encode(value)}
      onChange={(event) => onChange(decode(event.target.value))}
    >
      <option value="">Everyone</option>
      <option value="mine">Only mine</option>
      <option value="assistants">Assistants</option>
      {names.map((name) => (
        <option key={name} value={`app:${name}`}>
          {name}
        </option>
      ))}
    </select>
  )
}
