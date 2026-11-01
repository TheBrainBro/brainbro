import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useCapturePipeline } from '../capture/context'
import { itemKey, itemsKey, updateNoteBody, useItem, type Item } from '../items/api'
import { useSaveOnLeave } from '../lib/useSaveOnLeave'
import { editorOf } from '../live/changes'
import { NoteSaver, localDrafts, type SaverState } from './saver'

/**
 * Autosave for a note open in an editor, wherever it is (its page, a card on
 * a board): drafts kept on this device, flushed when the page goes away and
 * retried when back online. What another tab, device or assistant saves
 * comes back as `outdated` (with who, for an assistant) for the owner to
 * load; it never replaces the text on its own. `initial` is null for a note
 * that doesn't exist until it has text; `onCreated` (as given on the first
 * render) runs once it does.
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
      // What the editor now holds is the latest: not a change still to load.
      onLoaded: (item) => queryClient.setQueryData(itemKey(item.id), item),
      drafts: localDrafts,
    })
    noteSaver.restoreDraft()
    return noteSaver
  })

  useEffect(() => saver.resume(), [saver])
  useSaveOnLeave(saver)

  // Saved elsewhere while nothing here is pending. With something pending,
  // saving it brings up the conflict instead. A new note is followed from the
  // save that creates it (which re-renders).
  const latest = useItem(saver.noteId ?? undefined).data
  const state = reported ?? saver.snapshot
  const outdated =
    latest && latest.version !== saver.version && state.status === 'saved'
      ? { by: editorOf(latest.id), load: () => saver.load(latest) }
      : null

  return { saver, state, latest, outdated }
}
