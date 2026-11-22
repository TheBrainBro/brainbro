import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

import { useT } from '../i18n/i18n'
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
 * Recordings made in a browser (WebM) without their length written in can't
 * seek: once the waveform is in, they play from a copy that has it (see
 * `webm`), unless they started playing before.
 */
export function AudioPlayer({
  src,
  size,
  mime,
  autoPlay = false,
  startSeconds,
  className = '',
}: {
  src: string | null
  /** Its size in bytes: big files play without a waveform. */
  size?: number
  mime?: string
  autoPlay?: boolean
  /** Start at a transcript match when its playable source has loaded. */
  startSeconds?: number
  className?: string
}) {
  const t = useT()
  const audio = useRef<HTMLAudioElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const waveform = useWaveform(src, size, root)
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [positioned, setPositioned] = useState(startSeconds === undefined)
  const [needsRepair, setNeedsRepair] = useState(false)
  const [ownDuration, setOwnDuration] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)
  // Play came before the waveform: it goes on with what it was given.
  const [early, setEarly] = useState(false)
  const scrubbing = useRef(false)
  const autoStarted = useRef(false)

  const duration = waveform?.duration ?? ownDuration
  const progress = duration ? Math.min(time / duration, 1) : 0

  // Transcript hits start on the original. Native metadata decides whether
  // a browser recording actually needs the repaired copy before seeking.
  const useOriginal = early || (startSeconds !== undefined && !needsRepair)
  const chosen = useOriginal ? src : waveform === undefined ? null : (waveform?.src ?? src)

  function start(element: HTMLAudioElement) {
    if (playing && playing !== element) playing.pause()
    playing = element
    // Older browsers (and jsdom) return nothing.
    element.play()?.catch(() => setPaused(true))
  }

  // Started once what plays is chosen, so it doesn't start on one and switch.
  useEffect(() => {
    const element = audio.current
    if (!chosen || !element) return
    const prepare = () => {
      if (startSeconds !== undefined) {
        const hasDuration = Number.isFinite(element.duration) && element.duration > 0
        if (!hasDuration && !needsRepair && (!mime || mime === 'audio/webm')) {
          setNeedsRepair(true)
          return
        }
        // If waveform repair failed or was skipped, give the browser a
        // chance to seek the original and leave the playback controls usable.
        try {
          element.currentTime = hasDuration ? Math.min(startSeconds, element.duration) : startSeconds
        } catch {
          // Some browsers reject a seek when the file has no usable timeline.
        }
        setTime(element.currentTime)
        setPositioned(true)
      }
      if (autoPlay && !autoStarted.current) {
        autoStarted.current = true
        start(element)
      }
    }
    // After a source switch, readyState may still describe the original.
    const metadataReady = element.readyState >= HTMLMediaElement.HAVE_METADATA &&
      (chosen === src || element.currentSrc === chosen)
    if (startSeconds === undefined || metadataReady) {
      prepare()
    } else {
      element.addEventListener('loadedmetadata', prepare, { once: true })
      return () => element.removeEventListener('loadedmetadata', prepare)
    }
  }, [autoPlay, chosen, mime, needsRepair, src, startSeconds])

  useEffect(() => {
    const element = audio.current
    return () => {
      if (playing === element) playing = null
    }
  }, [])

  function toggle() {
    const element = audio.current
    if (!element) return
    if (!element.paused) return element.pause()
    if (chosen === null) setEarly(true)
    start(element)
  }

  function seek(seconds: number) {
    const element = audio.current
    if (!element || !duration) return
    const at = Math.min(Math.max(seconds, 0), duration)
    setTime(at)
    element.currentTime = at
  }

  function seekTo(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (!box.width || !duration) return
    seek(((event.clientX - box.left) / box.width) * duration)
  }

  function measure(element: HTMLAudioElement) {
    if (Number.isFinite(element.duration)) setOwnDuration(element.duration)
  }

  return (
    <div
      ref={setRoot}
      // On a board: playing and seeking don't drag the card.
      className={`nodrag flex items-center gap-3 ${className}`}
    >
      <audio
        ref={audio}
        src={(chosen ?? src) || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          event.currentTarget.playbackRate = speed
          measure(event.currentTarget)
        }}
        onDurationChange={(event) => measure(event.currentTarget)}
        onTimeUpdate={(event) => {
          if (!scrubbing.current) setTime(event.currentTarget.currentTime)
        }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => setPaused(true)}
      />
      <button
        type="button"
        aria-label={paused ? t('audio.play') : t('audio.pause')}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white shadow-sm transition hover:bg-accent-500 active:scale-95 disabled:opacity-50"
        disabled={!src || !positioned}
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
        aria-label={t('audio.position')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration ?? 0)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={t('audio.positionValue', {
          time: formatTime(time),
          duration: duration ? formatTime(duration) : t('audio.unknown'),
        })}
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
        aria-label={t('audio.speed', { speed })}
        title={t('audio.playbackSpeed')}
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
