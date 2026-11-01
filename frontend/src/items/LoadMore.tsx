import { ChevronDown, LoaderCircle } from 'lucide-react'

import { useT } from '../i18n/i18n'

/** The next page of a list, on request. */
export function LoadMore({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      className="button-secondary mt-4 flex w-full items-center justify-center gap-1.5"
      disabled={loading}
      onClick={onClick}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <ChevronDown className="size-4" aria-hidden="true" />
      )}
      {loading ? t('common.loading') : t('items.loadMore')}
    </button>
  )
}
