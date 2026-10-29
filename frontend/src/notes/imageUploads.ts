import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'

import { claimEvent } from '../capture/claims'
import { imageKey } from '../lib/markdown'
import { addLocalImage, localImages } from './livePreview'

/*
 * Images pasted or dropped into a note go into its text: each is uploaded,
 * then linked where it was put (`![name](attachments/…)`). Until then a
 * placeholder holds the spot, outside the text. Anything that isn't only
 * images (a PDF, a folder) goes to the inbox as anywhere else.
 */

export type ImageUploadOptions = {
  /** Uploads one image; resolves with the `src` to link it by. */
  upload: (file: File) => Promise<{ src: string }>
  onError: (message: string) => void
}

// Raster types the server keeps; SVG can carry scripts and never is.
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|heic|heif)$/

/** The files of a paste or drop, if there are some and all are images. */
export function imageFilesOf(data: Pick<DataTransfer, 'files'> | null): File[] | null {
  const files = Array.from(data?.files ?? [])
  return files.length && files.every((file) => IMAGE_TYPES.test(file.type)) ? files : null
}

/** While dragging only the type is known: whether every file is an image. */
function draggingImages(data: DataTransfer) {
  const files = Array.from(data.items ?? []).filter((item) => item.kind === 'file')
  return files.length > 0 && files.every((item) => IMAGE_TYPES.test(item.type))
}

/** Alt text from the file name: no extension, nothing that would end it early. */
export function altText(file: File) {
  return file.name.replace(/\.[^.]*$/, '').replace(/[[\]\\]/g, '').trim() || 'image'
}

const startUpload = StateEffect.define<{ id: number; pos: number; count: number }>({
  map: (value, mapping) => ({ ...value, pos: mapping.mapPos(value.pos) }),
})
const endUpload = StateEffect.define<number>()

class UploadingWidget extends WidgetType {
  readonly count: number
  constructor(count: number) {
    super()
    this.count = count
  }
  eq(other: UploadingWidget) {
    return other.count === this.count
  }
  toDOM() {
    const chip = document.createElement('span')
    chip.className = 'cm-md-image'
    chip.dataset.status = 'pending'
    chip.textContent = this.count === 1 ? 'Uploading image…' : `Uploading ${this.count} images…`
    return chip
  }
}

/** Placeholders for uploads in flight, kept in place as the text changes around them. */
const uploading = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(placeholders, tr) {
    placeholders = placeholders.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(startUpload)) {
        const { id, pos, count } = effect.value
        const widget = Decoration.widget({ widget: new UploadingWidget(count), side: 1, id })
        placeholders = placeholders.update({ add: [widget.range(pos)] })
      }
      if (effect.is(endUpload)) {
        placeholders = placeholders.update({
          filter: (_from, _to, decoration) => decoration.spec.id !== effect.value,
        })
      }
    }
    return placeholders
  },
  provide: (field) => EditorView.decorations.from(field),
})

function placeholderAt(state: EditorState, id: number) {
  let found: number | null = null
  state.field(uploading).between(0, state.doc.length, (from, _to, decoration) => {
    if (decoration.spec.id !== id) return
    found = from
    return false
  })
  return found
}

let uploads = 0

/** Uploads `files` and links them at `pos` (where it is by then), one per line. */
export async function insertImages(
  view: EditorView,
  files: File[],
  pos: number,
  { upload, onError }: ImageUploadOptions,
) {
  const id = ++uploads
  view.dispatch({ effects: startUpload.of({ id, pos, count: files.length }) })
  const results = await Promise.allSettled(files.map((file) => upload(file)))
  // The editor closed meanwhile: the uploads stay unused and are cleaned up.
  if (!view.dom.isConnected) return
  const at = placeholderAt(view.state, id)
  if (at === null) return
  const links: string[] = []
  const effects: StateEffect<unknown>[] = [endUpload.of(id)]
  results.forEach((result, index) => {
    const file = files[index]
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : 'Upload failed'
      onError(`${file.name || 'Image'}: ${reason}`)
      return
    }
    const { src } = result.value
    links.push(`![${altText(file)}](${src})`)
    // Shown from the device until the stored copy is ready.
    effects.push(addLocalImage.of({ src: imageKey(src), url: URL.createObjectURL(file) }))
  })
  view.dispatch({
    changes: links.length ? { from: at, insert: links.join('\n') } : undefined,
    effects,
  })
}

/** Local copies are only needed while the editor is open. */
const revokeLocalImages = ViewPlugin.define((view) => ({
  destroy() {
    for (const url of Object.values(view.state.field(localImages))) URL.revokeObjectURL(url)
  },
}))

export function imageUploads(options: ImageUploadOptions): Extension {
  return [
    uploading,
    revokeLocalImages,
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData
        if (!data) return false
        // Text copied with a picture of it (a spreadsheet, a document): the
        // text goes in, and nothing else is captured.
        if (data.getData('text/plain')) {
          claimEvent(event)
          return false
        }
        const files = imageFilesOf(data)
        if (!files) return false
        claimEvent(event)
        event.preventDefault()
        const { from, to } = view.state.selection.main
        if (to > from) view.dispatch({ changes: { from, to }, selection: { anchor: from } })
        insertImages(view, files, from, options)
        return true
      },
      dragover(event) {
        if (!event.dataTransfer || !draggingImages(event.dataTransfer)) return false
        claimEvent(event)
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        return false
      },
      drop(event, view) {
        const data = event.dataTransfer
        if (!data?.types.includes('Files')) return false
        const files = imageFilesOf(data)
        // Other files go to the inbox; never their bytes into the text.
        if (!files) return true
        claimEvent(event)
        event.preventDefault()
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
        insertImages(view, files, at ?? view.state.selection.main.head, options)
        return true
      },
    }),
  ]
}
