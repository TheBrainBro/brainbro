import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useEffectEvent, useRef } from 'react'

import { livePreview } from './livePreview'

// The text is the note. Live preview renders it around the cursor; this
// styles what stays visible: headings large, emphasis emphasized, markers
// faded where they show.
const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.6em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '600' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], class: 'cm-md-link' },
  { tag: tags.monospace, class: 'cm-md-code' },
  { tag: tags.quote, class: 'cm-md-quote' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], class: 'cm-md-mark' },
])

const theme = EditorView.theme({
  '&': { fontSize: '1rem', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.65' },
  '.cm-content': { minHeight: '60vh', padding: '0.5rem 0', caretColor: 'currentColor' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'currentColor' },
})

/**
 * CodeMirror over the raw Markdown: the document is the stored text, so what
 * comes in is exactly what goes out, and it reads rendered except where the
 * cursor is (live preview). `initial` is read once; remount (key)
 * to load other text.
 */
export function NoteEditor({
  initial,
  onChange,
  onSave,
  autoFocus = false,
}: {
  initial: string
  onChange: (body: string) => void
  /** Mod-S: save now instead of waiting for the debounce. */
  onSave?: () => void
  autoFocus?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  // Only the starting text and focus: the editor owns the document from here.
  const startup = useRef({ initial, autoFocus })
  const changed = useEffectEvent((body: string) => onChange(body))
  const save = useEffectEvent(() => onSave?.())

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: startup.current.initial,
        extensions: [
          history(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          livePreview(),
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Note', spellcheck: 'true' }),
          placeholder('Write in Markdown…'),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (save(), true) },
            ...markdownKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed(update.state.doc.toString())
          }),
        ],
      }),
    })
    if (startup.current.autoFocus) {
      view.focus()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
    }
    return () => view.destroy()
  }, [])

  return <div ref={host} className="note-editor" />
}
