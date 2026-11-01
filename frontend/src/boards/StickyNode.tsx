import { NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { useT } from '../i18n/i18n'
import { ConnectHandles } from './ConnectHandles'
import { useBoardActions } from './context'
import { STICKY_COLORS, STICKY_DEFAULT, type StickyFlowNode } from './layout'

/** A sticky note: text on a colored card that lives only on the board. */
export const StickyNode = memo(function StickyNode({ id, data, selected }: NodeProps<StickyFlowNode>) {
  const t = useT()
  const { readOnly, updateSticky, editSticky } = useBoardActions()
  const color = data.color || STICKY_DEFAULT

  return (
    <>
      {!readOnly && (
        <>
          <NodeResizer isVisible={selected && !data.editing} minWidth={80} minHeight={80} color="#8b5cf6" />
          <NodeToolbar isVisible={data.editing ? false : undefined} position={Position.Top}>
            <div role="radiogroup" aria-label={t('nodes.color')} className="popover flex items-center gap-1 p-1.5">
              {STICKY_COLORS.map((option) => (
                <button
                  key={option || 'default'}
                  type="button"
                  role="radio"
                  aria-checked={data.color === option}
                  aria-label={option || t('nodes.yellow')}
                  className={`size-5 rounded-md border border-black/10 transition hover:scale-110 ${
                    data.color === option ? 'ring-2 ring-zinc-900 ring-offset-1 dark:ring-zinc-100' : ''
                  }`}
                  style={{ background: option || STICKY_DEFAULT }}
                  onClick={() => updateSticky(id, { color: option })}
                />
              ))}
            </div>
          </NodeToolbar>
        </>
      )}
      <div
        className={`flex h-full w-full rounded-sm p-4 text-zinc-900 shadow-md transition-shadow ${
          selected ? 'shadow-lg ring-2 ring-accent-500' : ''
        }`}
        style={{ background: color }}
        onDoubleClick={() => !readOnly && editSticky(id)}
      >
        {data.editing ? (
          <textarea
            autoFocus
            aria-label={t('nodes.sticky')}
            defaultValue={data.text}
            placeholder={t('nodes.stickyPlaceholder')}
            className="nodrag nowheel h-full w-full resize-none bg-transparent text-base leading-snug outline-none placeholder:text-zinc-900/40"
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => updateSticky(id, { text: event.target.value, editing: false })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
                event.currentTarget.blur()
              }
            }}
          />
        ) : (
          <p className="w-full overflow-hidden text-base leading-snug break-words whitespace-pre-wrap">
            {data.text}
          </p>
        )}
      </div>
      {!data.editing && <ConnectHandles id={id} readOnly={readOnly} />}
    </>
  )
})
