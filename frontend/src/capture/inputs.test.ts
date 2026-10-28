import { describe, expect, it } from 'vitest'

import { isCapturableDrag, toCaptureInputs, type TransferLike } from './inputs'

function transfer({
  files = [],
  folders = [],
  data = {},
}: {
  files?: File[]
  folders?: string[]
  data?: Record<string, string>
}): TransferLike {
  const items = [
    ...files.map((file) => ({
      kind: 'file' as const,
      getAsFile: () => file,
      webkitGetAsEntry: () => ({ isDirectory: false }),
    })),
    ...folders.map((name) => ({
      kind: 'file' as const,
      getAsFile: () => new File([], name),
      webkitGetAsEntry: () => ({ isDirectory: true }),
    })),
  ]
  const types = [...(items.length ? ['Files'] : []), ...Object.keys(data)]
  return { types, items, files, getData: (type: string) => data[type] ?? '' }
}

const png = new File(['png'], 'shot.png', { type: 'image/png' })
const pdf = new File(['pdf'], 'doc.pdf', { type: 'application/pdf' })

describe('toCaptureInputs', () => {
  it('makes one input per file and wins over any text', () => {
    const found = toCaptureInputs(
      transfer({
        files: [png, pdf],
        data: { 'text/plain': 'shot.png', 'text/uri-list': 'https://a.io' },
      }),
    )
    expect(found).toEqual({
      inputs: [
        { kind: 'file', file: png },
        { kind: 'file', file: pdf },
      ],
      skipped: [],
    })
  })

  it('skips folders with a reason and keeps the rest', () => {
    const found = toCaptureInputs(transfer({ files: [pdf], folders: ['Photos'] }))
    expect(found.inputs).toEqual([{ kind: 'file', file: pdf }])
    expect(found.skipped).toEqual([
      { name: 'Photos', reason: "Folders aren't supported, drop the files inside" },
    ])
  })

  it('falls back to the file list when items are missing', () => {
    const found = toCaptureInputs({ types: ['Files'], files: [png], getData: () => '' })
    expect(found.inputs).toEqual([{ kind: 'file', file: png }])
  })

  it('prefers the uri-list over plain text and ignores its comments', () => {
    const found = toCaptureInputs(
      transfer({
        data: {
          'text/uri-list': '# dragged link\r\nhttps://example.com/post',
          'text/plain': 'Example post',
        },
      }),
    )
    expect(found.inputs).toEqual([{ kind: 'url', url: 'https://example.com/post' }])
  })

  it('keeps several links as one text input', () => {
    const found = toCaptureInputs(
      transfer({ data: { 'text/uri-list': 'https://a.io\nhttps://b.io' } }),
    )
    expect(found.inputs).toEqual([{ kind: 'text', text: 'https://a.io\nhttps://b.io' }])
  })

  it('uses trimmed plain text and never reads HTML', () => {
    const found = toCaptureInputs(
      transfer({ data: { 'text/html': '<img src=x onerror=alert(1)>', 'text/plain': '  hi  ' } }),
    )
    expect(found.inputs).toEqual([{ kind: 'text', text: 'hi' }])
    expect(toCaptureInputs(transfer({ data: { 'text/html': '<b>only html</b>' } }))).toEqual({
      inputs: [],
      skipped: [],
    })
  })
})

describe('isCapturableDrag', () => {
  it('accepts files and links, not plain text', () => {
    expect(isCapturableDrag(['Files'])).toBe(true)
    expect(isCapturableDrag(['text/uri-list', 'text/plain'])).toBe(true)
    expect(isCapturableDrag(['text/plain'])).toBe(false)
  })
})
