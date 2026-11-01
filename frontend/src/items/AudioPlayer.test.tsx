import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AudioPlayer } from './AudioPlayer'

function renderPlayer(duration: number, autoPlay = false) {
  const { container } = render(<AudioPlayer src="/file/v" autoPlay={autoPlay} />)
  const audio = container.querySelector('audio')!
  Object.defineProperty(audio, 'duration', { value: duration, configurable: true })
  const play = vi.fn(async () => {})
  audio.play = play
  return { audio, play }
}

describe('AudioPlayer', () => {
  it('finds out how long a browser recording is, then starts over', () => {
    const { audio, play } = renderPlayer(Infinity, true)

    fireEvent.loadedMetadata(audio)
    expect(audio.currentTime).toBe(Number.MAX_SAFE_INTEGER)
    expect(play).not.toHaveBeenCalled()

    Object.defineProperty(audio, 'duration', { value: 12.5 })
    fireEvent.durationChange(audio)
    expect(audio.currentTime).toBe(0)
    expect(play).toHaveBeenCalledOnce()
  })

  it('plays files that know their length right away, only when asked to', () => {
    const { audio, play } = renderPlayer(30, true)
    fireEvent.loadedMetadata(audio)
    expect(audio.currentTime).toBe(0)
    expect(play).toHaveBeenCalledOnce()

    const card = renderPlayer(30)
    fireEvent.loadedMetadata(card.audio)
    expect(card.play).not.toHaveBeenCalled()
  })
})
