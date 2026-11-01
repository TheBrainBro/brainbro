import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useCapturePipeline } from '../capture/context'
import { itemKey, itemsKey, type Item } from '../items/api'
import { useSaveOnLeave } from '../lib/useSaveOnLeave'
import { NoteSaver, localDrafts, type SaverState } from './saver'

/**
 * Autosave for a note that doesn't exist until it has text: a draft kept on
 * this device, flushed when the page goes away and retried when back online.
 * `onCreated` (as given on the first render) runs once it exists; from there
 * it is edited live.
 */
export function useNewNoteSaver({ onCreated }: { onCreated?: (item: Item) => void } = {}) {
  const queryClient = useQueryClient()
  const { capture, dismiss } = useCapturePipeline()
  // Null until the saver first reports: it may start from a restored draft.
  const [reported, setReported] = useState<SaverState<Item> | null>(null)

  const [saver] = useState(() => {
    const noteSaver = new NoteSaver<Item>({
      // New notes come in through the capture pipeline, like everything else.
      create: async (body) => {
        const [result] = await capture(
          { inputs: [{ kind: 'note', text: body }], skipped: [] },
          { undo: false },
        )
        if ('item' in result) return result.item
        dismiss(result.id)
        throw new Error(result.error)
      },
      onChange: setReported,
      onCreated: (item) => {
        queryClient.setQueryData(itemKey(item.id), item)
        // Lists refetch when shown again; the open note is already up to date.
        queryClient.invalidateQueries({
          queryKey: itemsKey,
          predicate: (query) => query.queryKey[1] !== 'detail',
        })
        onCreated?.(item)
      },
      drafts: localDrafts,
    })
    noteSaver.restoreDraft()
    return noteSaver
  })

  useEffect(() => saver.resume(), [saver])
  useSaveOnLeave(saver)

  return { saver, state: reported ?? saver.snapshot }
}
