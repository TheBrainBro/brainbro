import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isClaimed } from '../capture/claims'
import { altText, imageUploads, type ImageUploadOptions } from './imageUploads'
import { livePreview } from './livePreview'

const SRC = 'attachments/0b8e7c4a-1d2e-4f3a-9b8c-7d6e5f4a3b2c.png'

let view: EditorView

function open(doc: string, options: ImageUploadOptions) {
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage }), livePreview(), imageUploads(options)],
  })
  view = new EditorView({ state, parent: document.body })
  return view
}

/** Lets the uploads settle, then rebuilds with the complete syntax tree. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  ensureSyntaxTree(view.state, view.state.doc.length)
  view.dispatch({})
}

function transfer(files: File[], text = '') {
  return {
    types: [...(files.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])],
    files,
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    dropEffect: 'none',
  }
}

function paste(data: object) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: data })
  view.contentDOM.dispatchEvent(event)
  return event
}

function drop(data: object) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: data })
  view.contentDOM.dispatchEvent(event)
  return event
}

const png = (name = 'Screen Shot.png') => new File(['a'], name, { type: 'image/png' })

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:local', revokeObjectURL: () => {} }),
  )
})

afterEach(() => {
  view?.destroy()
  vi.unstubAllGlobals()
})

describe('images pasted or dropped into a note', () => {
  it('uploads a pasted image and links it where the cursor was, shown from the device', async () => {
    let finish!: (value: { src: string }) => void
    const upload = vi.fn(() => new Promise<{ src: string }>((resolve) => (finish = resolve)))
    open('Before ', { upload, onError: vi.fn() })

    const event = paste(transfer([png()]))

    expect(event.defaultPrevented).toBe(true)
    expect(isClaimed(event)).toBe(true)
    expect(upload).toHaveBeenCalledOnce()
    expect(view.contentDOM.textContent).toContain('Uploading image…')
    // Typed while it uploads: the link still lands where the image was put.
    view.dispatch({ changes: { from: 0, insert: 'Hi. ' } })

    finish({ src: SRC })
    await settle()

    expect(view.state.doc.toString()).toBe(`Hi. Before ![Screen Shot](${SRC})`)
    expect(view.contentDOM.textContent).not.toContain('Uploading')
    expect(view.contentDOM.querySelector('img.cm-md-img')).toHaveAttribute('src', 'blob:local')
  })

  it('links dropped images, one per line, where they were dropped', async () => {
    const upload = vi.fn(async (file: File) => ({ src: `attachments/${file.name}` }))
    open('Text', { upload, onError: vi.fn() })
    vi.spyOn(view, 'posAtCoords').mockReturnValue(0)

    const event = drop(transfer([png('a.png'), png('b.png')]))
    await settle()

    expect(isClaimed(event)).toBe(true)
    expect(view.state.doc.toString()).toBe('![a](attachments/a.png)\n![b](attachments/b.png)Text')
  })

  it('reports failed uploads and links the rest', async () => {
    const upload = vi.fn(async (file: File) => {
      if (file.name === 'big.png') throw new Error('The image is too large (max 20 MB).')
      return { src: SRC }
    })
    const onError = vi.fn()
    open('', { upload, onError })

    paste(transfer([png('big.png'), png('ok.png')]))
    await settle()

    expect(onError).toHaveBeenCalledWith('big.png: The image is too large (max 20 MB).')
    expect(view.state.doc.toString()).toBe(`![ok](${SRC})`)
  })

  it('leaves other files to the inbox, without reading them into the text', () => {
    const upload = vi.fn()
    open('Note', { upload, onError: vi.fn() })
    const text = new File(['secret'], 'notes.txt', { type: 'text/plain' })

    const dropped = drop(transfer([png(), text]))
    const pasted = paste(transfer([text]))

    expect(isClaimed(dropped)).toBe(false)
    expect(isClaimed(pasted)).toBe(false)
    expect(upload).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe('Note')
  })

  it('keeps text copied along with a picture of it, and nothing else', () => {
    const upload = vi.fn()
    open('', { upload, onError: vi.fn() })

    const event = paste(transfer([png()], 'a1\tb1'))

    expect(isClaimed(event)).toBe(true)
    expect(upload).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe('a1\tb1')
  })

  it('never takes SVG', () => {
    const upload = vi.fn()
    open('', { upload, onError: vi.fn() })
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    expect(isClaimed(paste(transfer([svg])))).toBe(false)
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('altText', () => {
  it('is the file name without its extension or brackets', () => {
    expect(altText(png('[draft] plan.v2.png'))).toBe('draft plan.v2')
    expect(altText(png('.png'))).toBe('image')
  })
})
