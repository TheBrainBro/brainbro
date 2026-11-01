/**
 * What a recording looks like: how loud it gets along the way, drawn as bars
 * by the player, and how long it really is, read by decoding it.
 */

// Bars in the waveform, whatever its width.
export const BARS = 64
// Decoded this coarsely: enough for the shape, little memory for long ones.
const SAMPLE_RATE = 8000
// Bigger files play without a waveform rather than being downloaded twice.
export const MAX_WAVEFORM_SIZE = 20 * 1024 * 1024

export type Waveform = { peaks: number[]; duration: number }

const waveforms = new Map<string, Promise<Waveform | null>>()

/** How loud each of `count` stretches of `samples` gets, from 0 to 1 (the loudest). */
export function peaks(samples: Float32Array, count = BARS) {
  const size = Math.max(Math.floor(samples.length / count), 1)
  const levels = Array.from({ length: count }, (_, bar) => {
    let peak = 0
    const end = Math.min((bar + 1) * size, samples.length)
    for (let index = bar * size; index < end; index++) {
      peak = Math.max(peak, Math.abs(samples[index]))
    }
    return peak
  })
  const loudest = Math.max(...levels)
  return loudest > 0 ? levels.map((level) => level / loudest) : levels
}

/** The waveform and real length of the audio at `src`, once per page; null if it can't be read. */
export function loadWaveform(src: string) {
  let found = waveforms.get(src)
  if (!found) {
    found = decode(src).catch(() => null)
    waveforms.set(src, found)
  }
  return found
}

async function decode(src: string): Promise<Waveform> {
  const response = await fetch(src, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(response.statusText)
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  return { peaks: peaks(buffer.getChannelData(0)), duration: buffer.duration }
}

/** 75 -> "1:15". */
export function formatTime(seconds: number) {
  const whole = Math.max(Math.floor(seconds), 0)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
