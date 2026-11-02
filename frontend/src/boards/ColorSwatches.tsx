import { useT } from '../i18n/i18n'
import { PALETTE } from './layout'

/** Picks one of the board's colors; '' is the default, shown as `fallback`. */
export function ColorSwatches({
  value,
  fallback,
  onChange,
}: {
  value: string
  fallback: string
  onChange: (color: string) => void
}) {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={t('nodes.color')} className="flex items-center gap-1 px-1">
      {PALETTE.map((color) => (
        <button
          key={color || 'default'}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color || t('nodes.defaultColor')}
          className={`size-4 rounded-full ring-offset-1 ring-offset-white transition hover:scale-110 dark:ring-offset-zinc-900 ${
            value === color ? 'ring-2 ring-zinc-900 dark:ring-zinc-100' : ''
          }`}
          style={{ background: color || fallback }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}
