import { t, useT } from '../i18n/i18n'
import type { Permission } from './api'

const CHOICES = [
  { id: 'read', label: 'tokens.permRead', hint: 'tokens.permReadHint' },
  { id: 'capture', label: 'tokens.permCapture', hint: 'tokens.permCaptureHint' },
  { id: 'edit', label: 'tokens.permEdit', hint: 'tokens.permEditHint' },
  { id: 'publish', label: 'tokens.permPublish', hint: 'tokens.permPublishHint' },
] as const

/** These act on what the assistant finds, so they come with reading. */
function needsRead(permission: Permission) {
  return permission === 'edit' || permission === 'publish'
}

function toggled(value: Permission[], permission: Permission) {
  if (!value.includes(permission)) {
    return CHOICES.map(({ id }) => id).filter((id) => id === permission || value.includes(id))
  }
  return value.filter(
    (other) => other !== permission && !(permission === 'read' && needsRead(other)),
  )
}

/** What a connected assistant may do. It always keeps at least one. */
export function PermissionChoices({
  value,
  onChange,
  disabled = false,
}: {
  value: Permission[]
  onChange: (permissions: Permission[]) => void
  disabled?: boolean
}) {
  useT()
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="sr-only">{t('tokens.permissionsLegend')}</legend>
      {CHOICES.map(({ id, label, hint }) => {
        const next = toggled(value, id)
        return (
          <label key={id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.includes(id)}
              disabled={next.length === 0 || (needsRead(id) && !value.includes('read'))}
              onChange={() => onChange(next)}
            />
            <span>
              <span className="block font-medium">{t(label)}</span>
              <span className="block text-xs text-zinc-500">{t(hint)}</span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
