import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { dropCursor, EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useEffectEvent, useRef } from 'react'

import type { NoteImages, NoteLinks } from '../items/api'
import { imageUploads } from './imageUploads'
import { setNoteLinks } from './linkWidgets'
import { livePreview, setNoteImages } from './livePreview'

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
  // Code blocks: each language's grammar loads the first time a note uses it.
  { tag: [tags.keyword, tags.controlKeyword, tags.modifier], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: 'var(--code-string)' },
  // `character` derives from `string`, but in notes it's `:emoji:` shortcodes.
  { tag: tags.character, color: 'var(--md-muted)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--code-comment)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--code-function)',
  },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--code-type)' },
])

const theme = EditorView.theme({
  '&': { fontSize: 'var(--note-editor-font-size, 1rem)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.65' },
  // Set --note-editor-min-height (and --note-editor-font-size) on a parent
  // for a smaller editor, as in a card.
  '.cm-content': {
    minHeight: 'var(--note-editor-min-height, 60vh)',
    padding: '0.5rem 0',
    caretColor: 'currentColor',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'currentColor' },
})

/**
 * CodeMirror over the raw Markdown: the document is the stored text, so what
 * comes in is exactly what goes out, and it reads rendered except where the
 * cursor is (live preview). `initial` is read once; remount (key)
 * to load other text. Images show the note's stored copies (`images`);
 * pasted or dropped ones are uploaded with `uploadImage` and linked.
 */
export function NoteEditor({
  initial,
  onChange,
  onSave,
  autoFocus = false,
  images,
  links,
  uploadImage,
  onUploadError,
}: {
  initial: string
  onChange: (body: string) => void
  /** Mod-S: save now instead of waiting for the debounce. */
  onSave?: () => void
  autoFocus?: boolean
  images?: NoteImages | null
  /** The previews of its card and embed links, by URL. */
  links?: NoteLinks | null
  uploadImage?: (file: File) => Promise<{ src: string }>
  onUploadError?: (message: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  // Only the starting text and focus: the editor owns the document from here.
  const startup = useRef({ initial, autoFocus, images, links, uploads: Boolean(uploadImage) })
  const changed = useEffectEvent((body: string) => onChange(body))
  const save = useEffectEvent(() => onSave?.())
  const upload = useEffectEvent((file: File) => uploadImage!(file))
  const uploadFailed = useEffectEvent((message: string) => onUploadError?.(message))

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: startup.current.initial,
        extensions: [
          history(),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          livePreview(startup.current.images ?? {}, startup.current.links ?? {}),
          startup.current.uploads
            ? [imageUploads({ upload, onError: uploadFailed }), dropCursor()]
            : [],
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
    view.current = editor
    if (startup.current.autoFocus) {
      editor.focus()
      editor.dispatch({ selection: { anchor: editor.state.doc.length } })
    }
    return () => {
      view.current = null
      editor.destroy()
    }
  }, [])

  // Copies made since (fetched, or pasted ones re-encoded) replace the placeholders.
  useEffect(() => {
    view.current?.dispatch({ effects: setNoteImages.of(images ?? {}) })
  }, [images])

  useEffect(() => {
    view.current?.dispatch({ effects: setNoteLinks.of(links ?? {}) })
  }, [links])

  return <div ref={host} className="note-editor" />
}
