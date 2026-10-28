import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import ReactMarkdown, { type Components, type ExtraProps, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// One `~` is subscript in the editor (`H~2~O`), not strikethrough: keep
// strikethrough to `~~` so cards and editor agree.
const plugins: Options['remarkPlugins'] = [[remarkGfm, { singleTilde: false }]]

// A task item's source starts with its marker and `[ ]`/`[x]`.
const TASK = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\]/

/** The note's source and what to do with a ticked task, for the components below. */
const Tasks = createContext<{ source: string; onTick?: Tick }>({ source: '' })

/** Offset of the task's ` `/`x` in the source, set by its list item. */
const TaskOffset = createContext<number | null>(null)

type Tick = (offset: number, checked: boolean) => void

function TaskItem({ node, ...props }: ComponentProps<'li'> & ExtraProps) {
  const { source } = useContext(Tasks)
  const start = node?.position?.start.offset
  const match = start === undefined ? null : TASK.exec(source.slice(start))
  return (
    <TaskOffset value={match ? start! + match[0].length - 2 : null}>
      <li {...props} />
    </TaskOffset>
  )
}

function TaskBox({ node: _node, ...props }: ComponentProps<'input'> & ExtraProps) {
  const { onTick } = useContext(Tasks)
  const offset = useContext(TaskOffset)
  if (props.type !== 'checkbox' || !onTick || offset === null) return <input {...props} />
  const checked = Boolean(props.checked)
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={checked ? 'Done' : 'To do'}
      className="cursor-pointer"
      onClick={(event) => event.stopPropagation()}
      onChange={() => onTick(offset, checked)}
    />
  )
}

// Stable across renders: new component types would remount the checkboxes
// between mousedown and click, and the click would be lost.
const components: Components = {
  // Links leave the app; the click is theirs, not the card's.
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
    />
  ),
  // Remote images are not loaded in the list: they would tell any site when
  // the inbox is open. The alt text stands in for them.
  img: ({ alt }) => <span className="markdown-image">{alt || 'image'}</span>,
  li: TaskItem,
  input: TaskBox,
}

/** `body` with the task at `offset` checked or unchecked. */
function toggleTask(body: string, offset: number, checked: boolean) {
  return body.slice(0, offset) + (checked ? ' ' : 'x') + body.slice(offset + 1)
}

/**
 * A note's Markdown, rendered without raw HTML: tags in the text are dropped
 * (never parsed into the page) and react-markdown strips `javascript:` URLs.
 * Long notes are cut off with a fade. With `onChange`, task checkboxes can
 * be ticked and the new text is handed back.
 */
export function Markdown({
  children,
  onChange,
}: {
  children: string
  onChange?: (body: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  const tasks = useMemo(
    () => ({
      source: children,
      onTick:
        onChange &&
        ((offset: number, checked: boolean) => onChange(toggleTask(children, offset, checked))),
    }),
    [children, onChange],
  )

  useLayoutEffect(() => {
    const element = box.current
    if (element) setClipped(element.scrollHeight > element.clientHeight + 1)
  }, [children])

  return (
    <div
      ref={box}
      data-clipped={clipped || undefined}
      className="markdown max-h-60 overflow-hidden break-words data-clipped:mask-b-from-60%"
    >
      <Tasks value={tasks}>
        <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>
          {children}
        </ReactMarkdown>
      </Tasks>
    </div>
  )
}
