/**
 * Browsers record WebM without its length (the recorder doesn't know until
 * it stops): Chrome writes a Duration of 0, others none. Without it a player
 * can't show the length or seek. `withDuration` writes it in, in the file's
 * `Info`, the way a muxer would have: over the 0, or added when there is
 * none.
 *
 * Only for the files recorders make, with the segment's size left open.
 * Adding one also needs no index of positions (SeekHead) that growing `Info`
 * would throw off; Chrome's is empty.
 */

const EBML = 0x1a45dfa3
const SEGMENT = 0x18538067
const SEEK_HEAD = 0x114d9b74
const INFO = 0x1549a966
const TIMECODE_SCALE = 0x2ad7b1
const DURATION = 0x4489
const CLUSTER = 0x1f43b675
// Nanoseconds per tick of the file's clock, when it doesn't say.
const DEFAULT_SCALE = 1_000_000

type Element = { id: number; start: number; dataStart: number; size: number | null }

/** An EBML variable-length integer: IDs keep their length marker, sizes drop it. */
function vint(data: Uint8Array, at: number, marker: boolean) {
  const first = data[at]
  if (!first) return null
  const length = Math.clz32(first) - 23
  if (at + length > data.length) return null
  let value = marker ? first : first & (0xff >> length)
  for (let index = 1; index < length; index++) value = value * 256 + data[at + index]
  // All ones: a size left open (the element runs to the end of its parent).
  const open = !marker && value === 2 ** (7 * length) - 1
  return { value: open ? null : value, length }
}

function element(data: Uint8Array, at: number): Element | null {
  const id = vint(data, at, true)
  if (!id || id.value === null) return null
  const size = vint(data, at + id.length, false)
  if (!size) return null
  return { id: id.value, start: at, dataStart: at + id.length + size.length, size: size.value }
}

function uint(data: Uint8Array, from: number, to: number) {
  let value = 0
  for (let index = from; index < to; index++) value = value * 256 + data[index]
  return value
}

/** `data` with its length (`seconds`) written in; null if it has one or isn't a recorder's WebM. */
export function withDuration(data: Uint8Array, seconds: number): Uint8Array<ArrayBuffer> | null {
  if (!(seconds > 0)) return null
  const header = element(data, 0)
  if (header?.id !== EBML || header.size === null) return null
  const segment = element(data, header.dataStart + header.size)
  if (segment?.id !== SEGMENT || segment.size !== null) return null

  let at = segment.dataStart
  let indexed = false
  while (at < data.length) {
    const found = element(data, at)
    if (!found || found.size === null || found.id === CLUSTER) return null
    if (found.id === SEEK_HEAD && found.size > 0) indexed = true
    const end = found.dataStart + found.size
    if (found.id === INFO) return writeDuration(data, found, end, seconds, !indexed)
    at = end
  }
  return null
}

function writeDuration(
  data: Uint8Array,
  info: Element,
  end: number,
  seconds: number,
  canGrow: boolean,
) {
  let scale = DEFAULT_SCALE
  let zero: Element | null = null
  let at = info.dataStart
  while (at < end) {
    const child = element(data, at)
    if (!child || child.size === null) return null
    const childEnd = child.dataStart + child.size
    if (child.id === TIMECODE_SCALE) scale = uint(data, child.dataStart, childEnd) || DEFAULT_SCALE
    if (child.id === DURATION) {
      if (child.size !== 4 && child.size !== 8) return null
      const view = new DataView(data.buffer, data.byteOffset + child.dataStart, child.size)
      const value = child.size === 4 ? view.getFloat32(0) : view.getFloat64(0)
      if (value > 0) return null
      zero = child
    }
    at = childEnd
  }
  const ticks = (seconds * 1e9) / scale

  if (zero) {
    const fixed = data.slice()
    const view = new DataView(fixed.buffer, zero.dataStart, zero.size!)
    if (zero.size === 4) view.setFloat32(0, ticks)
    else view.setFloat64(0, ticks)
    return fixed
  }
  if (!canGrow) return null

  // Duration: a float in ticks of the file's clock.
  const duration = new Uint8Array(11)
  duration.set([0x44, 0x89, 0x88])
  new DataView(duration.buffer).setFloat64(3, ticks)
  // Info again, with its new size written in 8 bytes (1 marker and 7 of size).
  const size = end - info.dataStart + duration.length
  const idLength = vint(data, info.start, true)!.length
  const sizeBytes = new Uint8Array(8)
  sizeBytes[0] = 0x01
  for (let index = 7, rest = size; index > 0; index--, rest = Math.floor(rest / 256)) {
    sizeBytes[index] = rest % 256
  }

  const parts = [
    data.subarray(0, info.start),
    data.subarray(info.start, info.start + idLength),
    sizeBytes,
    data.subarray(info.dataStart, end),
    duration,
    data.subarray(end),
  ]
  const fixed = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    fixed.set(part, offset)
    offset += part.length
  }
  return fixed
}
