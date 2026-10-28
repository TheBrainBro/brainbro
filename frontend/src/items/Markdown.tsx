import { useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]

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
}

/**
 * A note's Markdown, rendered without raw HTML: tags in the text are dropped
 * (never parsed into the page) and react-markdown strips `javascript:` URLs.
 * Long notes are cut off with a fade.
 */
export function Markdown({ children }: { children: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)

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
      <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  )
}
