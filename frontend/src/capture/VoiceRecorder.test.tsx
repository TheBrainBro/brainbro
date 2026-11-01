import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDuration, VoiceRecorder } from './VoiceRecorder'

class FakeRecorder {
  static supported = ['audio/webm;codecs=opus']
  static isTypeSupported = (type: string) => FakeRecorder.supported.includes(type)
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

let track: { stop: ReturnType<typeof vi.fn> }
let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  track = { stop: vi.fn() }
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
})

describe('VoiceRecorder', () => {
  it('records a voice note and hands it over as a file', async () => {
    const onRecorded = vi.fn()
    render(<VoiceRecorder onRecorded={onRecorded} />)

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(await screen.findByRole('group', { name: 'Recording' })).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(onRecorded).toHaveBeenCalledOnce()
    const file: File = onRecorded.mock.calls[0][0]
    expect(file.name).toBe('Voice note.webm')
    expect(file.type).toBe('audio/webm')
    expect(await file.text()).toBe('voice')
    // The microphone is let go of.
    expect(track.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument()
  })

  it('names Safari recordings as M4A', async () => {
    FakeRecorder.supported = ['audio/mp4']
    const onRecorded = vi.fn()
    render(<VoiceRecorder onRecorded={onRecorded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(onRecorded.mock.calls[0][0].name).toBe('Voice note.m4a')
    FakeRecorder.supported = ['audio/webm;codecs=opus']
  })

  it('keeps nothing on Cancel, or when the page is left', async () => {
    const onRecorded = vi.fn()
    const { unmount } = render(<VoiceRecorder onRecorded={onRecorded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(track.stop).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await screen.findByRole('group', { name: 'Recording' })
    unmount()
    expect(track.stop).toHaveBeenCalledTimes(2)
    expect(onRecorded).not.toHaveBeenCalled()
  })

  it('says so when the microphone is refused', async () => {
    getUserMedia.mockRejectedValue(new DOMException('No', 'NotAllowedError'))
    render(<VoiceRecorder onRecorded={vi.fn()} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Record' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access was refused.')
  })

  it("isn't there where the browser can't record (pages without HTTPS)", () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    render(<VoiceRecorder onRecorded={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument()
  })

  it('formats how long it has been recording', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(75.6)).toBe('1:15')
  })
})
