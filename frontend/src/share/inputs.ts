import type { CaptureInput, CaptureInputs } from '../capture/inputs'
import type { Share } from './queue'

export type SharedContent = Pick<Share, 'title' | 'text' | 'url' | 'files'>

const SINGLE_URL = /^https?:\/\/\S+$/i

/**
 * The text part of a share, as one capture: text and URL together (apps
 * split them differently), or only the URL when that is all there is. The
 * title is kept for notes but dropped for links, whose preview brings it.
 */
function sharedText({ title, text, url }: SharedContent): CaptureInput | null {
  const parts = [text.trim()]
  const link = url.trim()
  if (link && !parts[0].includes(link)) parts.push(link)
  const body = parts.filter(Boolean).join('\n')
  if (SINGLE_URL.test(body)) return { kind: 'url', url: body }

  const heading = title.trim()
  const full = heading && !body.includes(heading) ? [heading, body].filter(Boolean).join('\n\n') : body
  return full ? { kind: 'text', text: full } : null
}

/** What a share becomes in the capture pipeline: each file, then its text. */
export function shareToCaptureInputs(share: SharedContent): CaptureInputs {
  const inputs: CaptureInput[] = share.files.map((file) => ({ kind: 'file', file }))
  const text = sharedText(share)
  if (text) inputs.push(text)
  return { inputs, skipped: [] }
}

/** The part of `share` still to send, given the inputs that have to wait. */
export function remainingShare(share: Share, waiting: CaptureInput[]): Share {
  const keepText = waiting.some((input) => input.kind !== 'file')
  return {
    ...share,
    title: keepText ? share.title : '',
    text: keepText ? share.text : '',
    url: keepText ? share.url : '',
    files: waiting.flatMap((input) => (input.kind === 'file' ? [input.file] : [])),
  }
}
