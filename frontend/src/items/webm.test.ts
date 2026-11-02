import { describe, expect, it } from 'vitest'

import { withDuration } from './webm'

const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]
const openSegment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
// TimecodeScale 1,000,000 (milliseconds).
const info = [0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]
const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x82, 0xe7, 0x80]

/** A WebM as a browser records it: the segment's size left open, no Duration. */
function recording(parts = [info, cluster]) {
  return new Uint8Array([...ebml, ...openSegment, ...parts.flat()])
}

/** The Duration written in `data`, in ticks, and the size its Info says it has. */
function read(data: Uint8Array) {
  const at = ebml.length + openSegment.length
  const view = new DataView(data.buffer, data.byteOffset)
  const size = Number(view.getBigUint64(at + 4) & 0x00ffffffffffffffn)
  const duration = view.getFloat64(at + 12 + size - 8)
  return { size, duration }
}

describe('withDuration', () => {
  it("writes the length into a recording's Info, in its clock's ticks", () => {
    const fixed = withDuration(recording(), 7.5)!

    expect(read(fixed)).toEqual({ size: 7 + 11, duration: 7500 })
    // Everything after Info is as it was.
    expect(Array.from(fixed.slice(-cluster.length))).toEqual(cluster)
    // Its size now takes 8 bytes instead of 1, and Duration 11.
    expect(fixed.length).toBe(recording().length + 7 + 11)
  })

  it("writes over Chrome's Duration of 0, in place, past its empty SeekHead", () => {
    const emptySeekHead = [0x11, 0x4d, 0x9b, 0x74, 0x80]
    const zero = [0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]
    const chrome = [0x15, 0x49, 0xa9, 0x66, 0x80 + info.length - 5 + zero.length]
    const data = recording([emptySeekHead, [...chrome, ...info.slice(5), ...zero], cluster])

    const fixed = withDuration(data, 2)!

    expect(fixed.length).toBe(data.length)
    const at = data.length - cluster.length - 8
    expect(new DataView(fixed.buffer).getFloat64(at)).toBe(2000)
    // The original is left as it was.
    expect(new DataView(data.buffer).getFloat64(at)).toBe(0)
  })

  it('leaves alone files that have a length, or that it would break', () => {
    const duration = [0x44, 0x89, 0x84, 0x45, 0x00, 0x00, 0x00]
    const withLength = [0x15, 0x49, 0xa9, 0x66, 0x87, ...duration]
    const seekHead = [0x11, 0x4d, 0x9b, 0x74, 0x82, 0xec, 0x80]

    expect(withDuration(recording([withLength, cluster]), 3)).toBeNull()
    expect(withDuration(recording([seekHead, info, cluster]), 3)).toBeNull()
    expect(withDuration(recording([cluster, info]), 3)).toBeNull()
    expect(withDuration(new TextEncoder().encode('OggS not a webm'), 3)).toBeNull()
    expect(withDuration(recording().slice(0, 25), 3)).toBeNull()
    expect(withDuration(recording(), 0)).toBeNull()
  })
})
