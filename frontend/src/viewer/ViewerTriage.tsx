import { Archive, FolderInput, Inbox, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useTriage, type Collection, type Item, type TriagePayload } from '../items/api'
import { CollectionPicker } from '../items/CollectionPicker'
import { OrganizeMenu } from '../items/OrganizeMenu'
import { triageMessage, undoTriage, useUndoAction } from '../items/triage'
import { useT } from '../i18n/i18n'
import { useFeedback } from '../ui/feedback'

/**
 * Triage from the viewer, as from a card: organize (tick to add, untick to
 * take out), archive or back to the inbox, delete. The viewer stays open on
 * the item, with its new place; deleting closes it.
 */
export function ViewerTriage({
  item,
  onChanged,
  onDeleted,
}: {
  item: Item
  onChanged: (item: Item) => void
  onDeleted: () => void
}) {
  const t = useT()
  const triage = useTriage()
  const { toast, confirm } = useFeedback()
  const undoAction = useUndoAction()
  const [organizing, setOrganizing] = useState(false)

  function run(payload: Omit<TriagePayload, 'ids'>, message: string, undo: TriagePayload[] | null) {
    triage.mutate(
      { ids: [item.id], ...payload },
      {
        onSuccess: (updated) => {
          const changed = (updated as Item[]).find((other) => other.id === item.id)
          if (changed) onChanged(changed)
          toast({ message, actions: undoAction(undo) })
        },
        onError: (error) => toast({ message: error.message, tone: 'error' }),
      },
    )
  }

  function organize(collections: Collection[]) {
    const names = collections.map((collection) => collection.name).join(', ')
    run(
      { action: 'organize', collections: collections.map((collection) => collection.id) },
      triageMessage('organize', 1, names),
      null,
    )
  }

  function takeOutOf(collection: Collection) {
    run(
      { action: 'unorganize', collections: [collection.id] },
      triageMessage('unorganize', 1, collection.name),
      [{ ids: [item.id], action: 'organize', collections: [collection.id] }],
    )
  }

  const archived = item.status === 'archived'
  function archive() {
    const action = archived ? 'inbox' : 'archive'
    run({ action }, triageMessage(action, 1), undoTriage(action, [item]))
  }

  async function remove() {
    const confirmed = await confirm({
      title: t('itemList.deleteOne'),
      message: t('itemList.cantUndo'),
      confirm: t('common.delete'),
      danger: true,
    })
    if (!confirmed) return
    triage.mutate(
      { ids: [item.id], action: 'delete' },
      {
        onSuccess: () => {
          onDeleted()
          toast({ message: triageMessage('delete', 1) })
        },
        onError: (error) => toast({ message: error.message, tone: 'error' }),
      },
    )
  }

  return (
    <>
      <OrganizeMenu
        current={item.collections}
        onPick={(collection) => organize([collection])}
        onRemove={takeOutOf}
        onMore={() => setOrganizing(true)}
        trigger={(props) => (
          <button type="button" className="viewer-button" {...props}>
            <FolderInput className="size-4" aria-hidden="true" />
            {t('viewer.organize')}
          </button>
        )}
      />
      <button type="button" className="viewer-button" onClick={archive}>
        {archived ? (
          <Inbox className="size-4" aria-hidden="true" />
        ) : (
          <Archive className="size-4" aria-hidden="true" />
        )}
        {archived ? t('viewer.toInbox') : t('viewer.archive')}
      </button>
      <button type="button" className="viewer-button" onClick={remove}>
        <Trash2 className="size-4" aria-hidden="true" />
        {t('common.delete')}
      </button>
      {organizing && (
        // Above the viewer, like the confirmation dialogs.
        <div
          className="fixed inset-0 z-[60] text-zinc-900 dark:text-zinc-100"
          // Its keys (Esc) aren't the viewer's.
          onKeyDown={(event) => event.stopPropagation()}
        >
          <CollectionPicker
            count={1}
            onClose={() => setOrganizing(false)}
            onConfirm={(ids, names) => {
              setOrganizing(false)
              run({ action: 'organize', collections: ids }, triageMessage('organize', 1, names), null)
            }}
          />
        </div>
      )}
    </>
  )
}
