import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { useT } from '../i18n/i18n'
import { shareToCaptureInputs } from '../share/inputs'

/**
 * `/share`. Android's share sheet POSTs here and the service worker takes it
 * (straight to the inbox), so this page only sees:
 * - `?lost=1`: the POST reached the server instead (no service worker).
 * - `?title=&text=&url=`: a link, such as an iOS Shortcut from the share
 *   sheet. Any site could link here, so it asks before saving.
 */
export function SharePage() {
  const t = useT()
  const [params] = useSearchParams()
  const { capture } = useCapturePipeline()
  const navigate = useNavigate()

  const shared = {
    title: params.get('title') ?? '',
    text: params.get('text') ?? '',
    url: params.get('url') ?? '',
    files: [],
  }
  const found = shareToCaptureInputs(shared)

  if (params.has('lost')) {
    return (
      <SharePanel title={t('share.lost')}>
        <p className="text-sm text-zinc-500">
          {t('share.lostHint')}
        </p>
        <Link to="/" className="button-primary mt-4 inline-block">
          {t('share.toInbox')}
        </Link>
      </SharePanel>
    )
  }
  if (!found.inputs.length) return <Navigate to="/" replace />

  const [input] = found.inputs
  const preview = input.kind === 'url' ? input.url : input.kind === 'file' ? '' : input.text

  return (
    <SharePanel title={t('share.save')}>
      <p className="max-h-60 overflow-auto rounded-lg bg-zinc-100 p-3 text-sm break-words whitespace-pre-wrap dark:bg-zinc-800">
        {preview}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Link to="/" replace className="button-secondary">
          {t('common.cancel')}
        </Link>
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            // The inbox shows it arriving, with Undo.
            navigate('/', { replace: true })
            void capture(found)
          }}
        >
          {t('common.save')}
        </button>
      </div>
    </SharePanel>
  )
}

function SharePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="surface p-6">
        <h1 className="mb-3 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  )
}
