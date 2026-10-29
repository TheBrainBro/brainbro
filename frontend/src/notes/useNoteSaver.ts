import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useCapturePipeline } from '../capture/context'
import { itemKey, itemsKey, updateNoteBody, useItem, type Item } from '../items/api'
import { useSaveOnLeave } from '../lib/useSaveOnLeave'
import { NoteSaver, localDrafts, type SaverState } from './saver'

/**
 * Autosave for a note open in an editor, wherever it is (its page, a card on
 * a board): drafts kept on this device, flushed when the page goes away,
 * retried when back online, and replaced by what another tab saved if
 * nothing here is pending. `initial` is null for a note that doesn't exist
 * until it has text; `onCreated` (as given on the first render) runs once it
 * does.
 */
export function useNoteSaver(
  initial: Item | null,
  { onCreated }: { onCreated?: (item: Item) => void } = {},
) {
  const queryClient = useQueryClient()
  const { capture, dismiss } = useCapturePipeline()
  // Null until the saver first reports: it may start from a restored draft.
  const [reported, setReported] = useState<SaverState<Item> | null>(null)

  const [saver] = useState(() => {
    const noteSaver = new NoteSaver<Item>(initial, {
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
      update: updateNoteBody,
      onChange: setReported,
      onSaved: (item, isNew) => {
        queryClient.setQueryData(itemKey(item.id), item)
        // Lists refetch when shown again; the open note is already up to date.
        queryClient.invalidateQueries({
          queryKey: itemsKey,
          predicate: (query) => query.queryKey[1] !== 'detail',
        })
        if (isNew) onCreated?.(item)
      },
      drafts: localDrafts,
    })
    noteSaver.restoreDraft()
    return noteSaver
  })

  useEffect(() => saver.resume(), [saver])
  useSaveOnLeave(saver)

  // Saved elsewhere (another tab, on focus): take it if nothing here is pending.
  // A new note is followed from the save that creates it (which re-renders).
  const latest = useItem(saver.noteId ?? undefined).data
  useEffect(() => {
    if (latest && latest.version !== saver.version && saver.status === 'saved') {
      saver.load(latest)
    }
  }, [latest, saver])

  return { saver, state: reported ?? saver.snapshot, latest }
}
