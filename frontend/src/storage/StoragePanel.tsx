import { useT } from '../i18n/i18n'
import { formatBytes } from '../lib/format'
import { useStorage } from './api'

/** How much the user's files take, and how much is left of their quota. */
export function StoragePanel() {
  const t = useT()
  const { data: storage, isError } = useStorage()

  return (
    <div className="max-w-lg">
      <p className="mt-1 mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t('storage.intro')}</p>
      {isError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('storage.failed')}
        </p>
      ) : !storage ? null : storage.quota === null ? (
        <p className="text-sm">{t('storage.usedNoLimit', { used: formatBytes(storage.used) })}</p>
      ) : (
        <Quota used={storage.used} quota={storage.quota} />
      )}
    </div>
  )
}

function Quota({ used, quota }: { used: number; quota: number }) {
  const t = useT()
  const left = Math.max(quota - used, 0)
  const share = quota > 0 ? Math.min(used / quota, 1) : 1
  return (
    <div>
      <div
        role="meter"
        aria-label={t('storage.meter')}
        aria-valuemin={0}
        aria-valuemax={quota}
        aria-valuenow={Math.min(used, quota)}
        aria-valuetext={t('storage.used', { used: formatBytes(used), quota: formatBytes(quota) })}
        className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      >
        <div
          className={`h-full rounded-full ${left === 0 ? 'bg-red-500' : 'bg-accent-500'}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm">
        <span>{t('storage.used', { used: formatBytes(used), quota: formatBytes(quota) })}</span>
        <span className="text-zinc-500 dark:text-zinc-400">{t('storage.left', { left: formatBytes(left) })}</span>
      </div>
      {left === 0 && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{t('storage.full')}</p>
      )}
    </div>
  )
}
