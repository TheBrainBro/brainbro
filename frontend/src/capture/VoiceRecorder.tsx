import { Mic, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { formatTime } from '../items/waveform'
import { withDuration } from '../items/webm'

// What the browser records in, best first: WebM (Chrome, Firefox), MP4 (Safari).
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const EXTENSIONS: Record<string, string> = { webm: 'webm', mp4: 'm4a', ogg: 'ogg' }

/** Browsers only give the microphone to secure pages (HTTPS or localhost). */
function canRecord() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/** What was recorded, as a file; WebM with its length written in (see `webm`). */
async function recordingFile(chunks: Blob[], type: string, seconds: number) {
  const base = type.split(';')[0] || 'audio/webm'
  const extension = EXTENSIONS[base.split('/')[1]] ?? 'webm'
  const data = new Uint8Array(await new Blob(chunks).arrayBuffer())
  const fixed = withDuration(data, seconds)
  return new File([fixed ?? data], `Voice note.${extension}`, { type: base })
}

type Recording = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number }

/** Stops recording and lets go of the microphone; `keep` gets what was recorded. */
function release(active: Recording | null, keep?: (file: File) => void) {
  if (!active) return
  const { recorder, stream, chunks } = active
  const done = () => {
    stream.getTracks().forEach((track) => track.stop())
    if (!keep || !chunks.length) return
    const seconds = (Date.now() - active.started) / 1000
    void recordingFile(chunks, recorder.mimeType, seconds).then(keep)
  }
  if (recorder.state === 'inactive') return done()
  recorder.onstop = done
  recorder.stop()
}

/**
 * Records a voice note from the microphone: a button, then the time running
 * with Stop (keep it) and Cancel. Hidden where the browser can't record.
 */
export function VoiceRecorder({
  onRecorded,
  className = 'button-outline',
  label = 'Record',
}: {
  onRecorded: (file: File) => void
  className?: string
  label?: string
}) {
  const [recording, setRecording] = useState<Recording | null>(null)
  const [starting, setStarting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<Recording | null>(null)

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setElapsed((Date.now() - recording.started) / 1000), 250)
    return () => window.clearInterval(timer)
  }, [recording])

  // Leaving the page while recording lets go of the microphone; nothing is kept.
  useEffect(() => () => release(current.current), [])

  async function start() {
    setError(null)
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const active: Recording = { recorder, stream, chunks: [], started: Date.now() }
      recorder.ondataavailable = (event) => {
        if (event.data.size) active.chunks.push(event.data)
      }
      recorder.start()
      current.current = active
      setElapsed(0)
      setRecording(active)
    } catch (failure) {
      const refused = failure instanceof DOMException && failure.name === 'NotAllowedError'
      setError(refused ? 'Microphone access was refused.' : "Couldn't start recording.")
    } finally {
      setStarting(false)
    }
  }

  function finish(keep: boolean) {
    release(recording, keep ? onRecorded : undefined)
    current.current = null
    setRecording(null)
  }

  if (!canRecord()) return null
  if (recording) {
    return (
      <div role="group" aria-label="Recording" className="flex items-center gap-2">
        <span className="size-2.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
        <span className="text-sm tabular-nums" aria-live="off">
          {formatTime(elapsed)}
        </span>
        <button
          type="button"
          className="button-primary inline-flex items-center gap-1.5"
          onClick={() => finish(true)}
        >
          <Square className="size-3.5 fill-current" aria-hidden="true" />
          Stop
        </button>
        <button
          type="button"
          className="button-secondary inline-flex items-center gap-1.5"
          onClick={() => finish(false)}
        >
          <X className="size-4" aria-hidden="true" />
          Cancel
        </button>
      </div>
    )
  }
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={starting}
        title="Record a voice note"
        onClick={start}
      >
        <Mic className="size-4" aria-hidden="true" />
        {label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </>
  )
}
