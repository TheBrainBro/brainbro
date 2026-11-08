import { StateField, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

const TITLE = Decoration.line({ class: 'cm-note-title' })

// A list, a quote or code still names the note, but keeps its own look.
const OWN_LOOK = /^\s*(?:[-*+]\s|\d{1,9}[.)]\s|>|```|~~~)/

function decorate(state: EditorState): DecorationSet {
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (line.text.trim()) {
      return OWN_LOOK.test(line.text) ? Decoration.none : Decoration.set(TITLE.range(line.from))
    }
  }
  return Decoration.set(TITLE.range(0))
}

/**
 * Shows the line that names an untitled note (see `noteTitle`) as its title.
 * Only a look: the line stays in the text, exactly as typed.
 */
export const firstLineTitle = StateField.define<DecorationSet>({
  create: decorate,
  update: (value, tr) => (tr.docChanged ? decorate(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
})
