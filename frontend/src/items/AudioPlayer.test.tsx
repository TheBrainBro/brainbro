import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AudioPlayer } from './AudioPlayer'
import { formatTime, peaks } from './waveform'

let decoded: Float32Array
let decodeAudioData: ReturnType<typeof vi.fn>

beforeEach(() => {
  decoded = new Float32Array([0.1, -0.2, 0.5, -1, 0, 0.25, 0.5, -0.5])
  decodeAudioData = vi.fn(async () => ({
    getChannelData: () => decoded,
    duration: 12,
  }))
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData = decodeAudioData
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('audio')),
  )
})

afterEach(() => vi.unstubAllGlobals())

let count = 0

/** A player on its own URL, so the waveform cache doesn't carry over between tests. */
async function renderPlayer({
  autoPlay = false,
  size,
}: { autoPlay?: boolean; size?: number } = {}) {
  const src = `/file/${++count}`
  const view = render(<AudioPlayer src={src} size={size} autoPlay={autoPlay} />)
  const audio = view.container.querySelector('audio')!
  const play = vi.fn(async () => {
    Object.defineProperty(audio, 'paused', {
      value: false,
      configurable: true,
    })
    fireEvent.play(audio)
  })
  audio.play = play
  audio.pause = vi.fn(() => {
    Object.defineProperty(audio, 'paused', { value: true, configurable: true })
    fireEvent.pause(audio)
  })
  // jsdom's media elements never load: these say what a browser would.
  const set = (name: string, value: number) =>
    Object.defineProperty(audio, name, { value, configurable: true })
  await act(async () => {})
  return { ...view, audio, play, set }
}

describe('peaks', () => {
  it('measures how loud each stretch is, against the loudest', () => {
    expect(peaks(decoded, 4).map((level) => Number(level.toFixed(2)))).toEqual([0.2, 1, 0.25, 0.5])
    expect(peaks(new Float32Array(4), 2)).toEqual([0, 0])
  })
})

describe('AudioPlayer', () => {
  it('shows how long it is and its shape, from decoding it', async () => {
    await renderPlayer()
    expect(screen.getByText('0:00 / 0:12')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Position' })).toHaveAttribute('aria-valuemax', '12')
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/file\//), {
      credentials: 'same-origin',
    })
  })

  it("doesn't download big files to draw them", async () => {
    await renderPlayer({ size: 50 * 1024 * 1024 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('plays and pauses, one recording at a time', async () => {
    const first = await renderPlayer()
    first.set('readyState', 1)
    first.set('duration', 12)
    fireEvent.click(first.getByRole('button', { name: 'Play' }))
    expect(first.play).toHaveBeenCalledOnce()
    fireEvent.click(first.getByRole('button', { name: 'Pause' }))
    expect(first.audio.pause).toHaveBeenCalledOnce()

    fireEvent.click(first.getByRole('button', { name: 'Play' }))
    const second = await renderPlayer()
    second.set('readyState', 1)
    fireEvent.click(second.getAllByRole('button', { name: 'Play' }).at(-1)!)
    expect(first.audio.pause).toHaveBeenCalledTimes(2)
  })

  it('goes where the waveform is clicked, and skips with the arrows', async () => {
    const { audio } = await renderPlayer()
    const slider = screen.getByRole('slider', { name: 'Position' })
    slider.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect

    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 })
    expect(audio.currentTime).toBe(3)
    expect(screen.getByText('0:03 / 0:12')).toBeInTheDocument()
    fireEvent.pointerUp(slider)

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(audio.currentTime).toBe(8)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(audio.currentTime).toBe(12)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(audio.currentTime).toBe(0)
  })

  it("finds out a browser recording's length before playing or seeking", async () => {
    decodeAudioData.mockRejectedValue(new Error('Unsupported'))
    const { audio, play, set } = await renderPlayer({ autoPlay: true })
    expect(screen.getByText('0:00')).toBeInTheDocument()

    set('duration', Infinity)
    fireEvent.loadedMetadata(audio)
    expect(audio.currentTime).toBe(Number.MAX_SAFE_INTEGER)
    // Not known yet: it keeps waiting.
    fireEvent.durationChange(audio)
    expect(play).not.toHaveBeenCalled()

    set('duration', 7)
    fireEvent.durationChange(audio)
    expect(audio.currentTime).toBe(0)
    expect(play).toHaveBeenCalledOnce()
    expect(screen.getByText('0:00 / 0:07')).toBeInTheDocument()
  })

  it('changes the speed', async () => {
    const { audio } = await renderPlayer()
    fireEvent.click(screen.getByRole('button', { name: 'Speed 1×' }))
    expect(audio.playbackRate).toBe(1.5)
    fireEvent.click(screen.getByRole('button', { name: 'Speed 1.5×' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speed 2×' }))
    expect(audio.playbackRate).toBe(1)
  })

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(75.6)).toBe('1:15')
  })
})
