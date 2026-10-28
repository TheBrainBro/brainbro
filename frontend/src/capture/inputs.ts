/**
 * Turn a paste or a drop into what to capture. Every way in (typing,
 * pasting, dropping, later the share target and the extension) ends up as a
 * list of these, handled by one pipeline.
 */

export type CaptureInput =
  { kind: 'text'; text: string } | { kind: 'url'; url: string } | { kind: 'file'; file: File }

/** Something in the paste or drop that can't be captured, with the reason. */
export type SkippedInput = { name: string; reason: string }

export type CaptureInputs = { inputs: CaptureInput[]; skipped: SkippedInput[] }

/** The parts of DataTransfer we read; real ones and test doubles both fit. */
export type TransferLike = Pick<DataTransfer, 'getData' | 'types'> & {
  items?: ArrayLike<
    Pick<DataTransferItem, 'kind' | 'getAsFile'> & {
      webkitGetAsEntry?: () => { isDirectory: boolean } | null
    }
  >
  files?: ArrayLike<File>
}

const FOLDER_REASON = "Folders aren't supported, drop the files inside"

/** Whether a drag carries something we would capture (files or links). */
export function isCapturableDrag(types: readonly string[]) {
  return types.includes('Files') || types.includes('text/uri-list')
}

function filesOf(data: TransferLike): CaptureInputs {
  const inputs: CaptureInput[] = []
  const skipped: SkippedInput[] = []
  const items = Array.from(data.items ?? []).filter((item) => item.kind === 'file')
  if (!items.length) {
    for (const file of Array.from(data.files ?? [])) inputs.push({ kind: 'file', file })
    return { inputs, skipped }
  }
  for (const item of items) {
    // Must be read during the event: entries are gone once it returns.
    const entry = item.webkitGetAsEntry?.()
    const file = item.getAsFile()
    if (entry?.isDirectory) skipped.push({ name: file?.name || 'Folder', reason: FOLDER_REASON })
    else if (file) inputs.push({ kind: 'file', file })
  }
  return { inputs, skipped }
}

/**
 * Files first (one input each), then `text/uri-list`, then `text/plain`.
 * `text/html` is never read, so no untrusted markup gets in. Text is never
 * split: one text drop is one input, as typed.
 */
export function toCaptureInputs(data: TransferLike): CaptureInputs {
  const files = filesOf(data)
  if (files.inputs.length || files.skipped.length) return files

  const uris = data
    .getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (uris.length === 1) return { inputs: [{ kind: 'url', url: uris[0] }], skipped: [] }
  if (uris.length > 1) return { inputs: [{ kind: 'text', text: uris.join('\n') }], skipped: [] }

  const text = data.getData('text/plain').trim()
  return { inputs: text ? [{ kind: 'text', text }] : [], skipped: [] }
}
