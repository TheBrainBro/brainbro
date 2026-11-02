import { useState } from 'react'

import { useRemoveSampleContent, useSession } from '../auth/session'
import { useT } from '../i18n/i18n'
import { useFeedback } from '../ui/feedback'

/** Lets a person remove the example content created from the welcome tour. */
export function SampleContentPanel() {
  const t = useT()
  const { data: session } = useSession()
  const remove = useRemoveSampleContent()
  const { confirm } = useFeedback()
  const [failed, setFailed] = useState(false)

  async function removeSamples() {
    const confirmed = await confirm({
      title: t('sampleContent.removeTitle'),
      message: t('sampleContent.removeHint'),
      confirm: t('sampleContent.remove'),
      danger: true,
    })
    if (!confirmed) return
    setFailed(false)
    try {
      await remove.mutateAsync()
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="max-w-lg">
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('sampleContent.description')}</p>
      {session?.has_sample_content ? (
        <button type="button" className="button-danger mt-4" disabled={remove.isPending} onClick={removeSamples}>
          {t('sampleContent.remove')}
        </button>
      ) : (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{t('sampleContent.none')}</p>
      )}
      {failed && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{t('sampleContent.failed')}</p>}
    </div>
  )
}
