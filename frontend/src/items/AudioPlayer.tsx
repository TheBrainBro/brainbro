import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

import { BARS, formatTime, loadWaveform, MAX_WAVEFORM_SIZE, type Waveform } from './waveform'

const SPEEDS = [1, 1.5, 2]
const SKIP_SECONDS = 5

// One recording plays at a time: starting one pauses the last.
let playing: HTMLAudioElement | null = null

/** The waveform of `src`, loaded once the player is (nearly) on screen. */
function useWaveform(src: string | null, size: number | undefined, root: HTMLElement | null) {
  const [waveform, setWaveform] = useState<Waveform | null | undefined>(undefined)
  const tooBig = (size ?? 0) > MAX_WAVEFORM_SIZE

  useEffect(() => {
    if (!src || tooBig || !root) return
    let cancelled = false
    const load = () => loadWaveform(src).then((found) => !cancelled && setWaveform(found))
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => {
        cancelled = true
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          load()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(root)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [src, tooBig, root])

  return src && !tooBig ? waveform : null
}

/**
 * A recording: play and pause, its waveform filling up as it plays (click
 * or drag on it to go there; arrows skip 5 seconds), the time and the speed.
 *
 * Recordings made in a browser (WebM) don't say how long they are, and a
 * player can't seek in them until it knows: the waveform's decoding says,
 * and the audio is sent to the end once, unseen, to find out for itself.
 */
export function AudioPlayer({
  src,
  size,
  autoPlay = false,
  className = '',
}: {
  src: string | null
  /** Its size in bytes: big files play without a waveform. */
  size?: number
  autoPlay?: boolean
  className?: string
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const waveform = useWaveform(src, size, root)
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [ownDuration, setOwnDuration] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)
  // Finding out the length (see above): play and seek wait for it.
  const resolving = useRef(false)
  const pending = useRef<{ play: boolean; seek: number | null }>({
    play: autoPlay,
    seek: null,
  })
  const scrubbing = useRef(false)

  const duration = waveform?.duration ?? ownDuration
  const progress = duration ? Math.min(time / duration, 1) : 0

  // `autoPlay` starts it once its metadata is in (see `settle`).
  useEffect(() => {
    const element = audio.current
    return () => {
      if (playing === element) playing = null
    }
  }, [])

  function start(element: HTMLAudioElement) {
    if (playing && playing !== element) playing.pause()
    playing = element
    element.play().catch(() => setPaused(true))
  }

  function toggle() {
    const element = audio.current
    if (!element) return
    if (!element.paused) return element.pause()
    if (resolving.current || element.readyState === 0) {
      pending.current.play = true
      if (element.readyState === 0) element.load()
      return
    }
    start(element)
  }

  function seek(seconds: number) {
    const element = audio.current
    if (!element || !duration) return
    const at = Math.min(Math.max(seconds, 0), duration)
    setTime(at)
    if (resolving.current) pending.current.seek = at
    else element.currentTime = at
  }

  function seekTo(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (!box.width || !duration) return
    seek(((event.clientX - box.left) / box.width) * duration)
  }

  /** The length is known now: back to where it should be, playing if it was asked to. */
  function settle(element: HTMLAudioElement) {
    if (resolving.current) {
      if (!Number.isFinite(element.duration)) return
      resolving.current = false
      element.currentTime = pending.current.seek ?? 0
    }
    if (Number.isFinite(element.duration)) setOwnDuration(element.duration)
    if (pending.current.play) {
      pending.current.play = false
      start(element)
    }
  }

  return (
    <div
      ref={setRoot}
      // On a board: playing and seeking don't drag the card.
      className={`nodrag flex items-center gap-3 ${className}`}
    >
      <audio
        ref={audio}
        src={src ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const element = event.currentTarget
          element.playbackRate = speed
          if (element.duration === Infinity) {
            resolving.current = true
            element.currentTime = Number.MAX_SAFE_INTEGER
          } else {
            settle(element)
          }
        }}
        onDurationChange={(event) => settle(event.currentTarget)}
        onTimeUpdate={(event) => {
          if (resolving.current) return settle(event.currentTarget)
          if (!scrubbing.current) setTime(event.currentTarget.currentTime)
        }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => setPaused(true)}
      />
      <button
        type="button"
        aria-label={paused ? 'Play' : 'Pause'}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white shadow-sm transition hover:bg-accent-500 active:scale-95 disabled:opacity-50"
        disabled={!src}
        onClick={toggle}
      >
        {paused ? (
          <Play className="ml-0.5 size-4 fill-current" aria-hidden="true" />
        ) : (
          <Pause className="size-4 fill-current" aria-hidden="true" />
        )}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration ?? 0)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${formatTime(time)} of ${duration ? formatTime(duration) : 'unknown'}`}
        className={`flex h-9 min-w-0 flex-1 touch-none items-center gap-[2px] rounded outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 ${
          duration ? 'cursor-pointer' : ''
        } ${waveform === undefined ? 'animate-pulse' : ''}`}
        onPointerDown={(event) => {
          if (!duration) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          scrubbing.current = true
          seekTo(event)
        }}
        onPointerMove={(event) => scrubbing.current && seekTo(event)}
        onPointerUp={() => {
          scrubbing.current = false
        }}
        onPointerCancel={() => {
          scrubbing.current = false
        }}
        onKeyDown={(event) => {
          const moves: Record<string, number> = {
            ArrowLeft: time - SKIP_SECONDS,
            ArrowRight: time + SKIP_SECONDS,
            Home: 0,
            End: duration ?? 0,
          }
          if (!(event.key in moves)) return
          event.preventDefault()
          // Arrows stay here: in the viewer they would go to the next item.
          event.stopPropagation()
          seek(moves[event.key])
        }}
      >
        {Array.from({ length: BARS }, (_, bar) => {
          const level = waveform?.peaks[bar] ?? 0
          const played = (bar + 0.5) / BARS <= progress
          return (
            <span
              key={bar}
              aria-hidden="true"
              className={`min-w-px flex-1 rounded-full transition-colors ${
                played ? 'bg-accent-500' : 'bg-current opacity-25'
              }`}
              style={{ height: `${Math.max(level * 100, 12)}%` }}
            />
          )
        })}
      </div>
      <span className="shrink-0 text-xs tabular-nums opacity-60">
        {formatTime(time)}
        {duration ? ` / ${formatTime(duration)}` : ''}
      </span>
      <button
        type="button"
        aria-label={`Speed ${speed}×`}
        title="Playback speed"
        className="w-9 shrink-0 rounded-md py-1 text-xs font-medium tabular-nums opacity-70 transition hover:bg-current/10 hover:opacity-100"
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
          setSpeed(next)
          if (audio.current) audio.current.playbackRate = next
        }}
      >
        {speed}×
      </button>
    </div>
  )
}
