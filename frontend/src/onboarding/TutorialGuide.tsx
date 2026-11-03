import { FileImage, FileText, Hand, PartyPopper, X } from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { useT, type MessageKey } from '../i18n/i18n'
import { Logo } from '../layout/Logo'
import { useTutorial, type TutorialStep } from './tutorial'

type Target = { rect: DOMRect; element: HTMLElement }
type SampleFile = 'pdf' | 'image' | 'text'

const COPY: Record<TutorialStep, { title: MessageKey; line: MessageKey }> = {
  capture: { title: 'tutorial.captureTitle', line: 'tutorial.captureLine' },
  file: { title: 'tutorial.fileTitle', line: 'tutorial.fileLine' },
  collection: { title: 'tutorial.collectionTitle', line: 'tutorial.collectionLine' },
  board: { title: 'tutorial.boardTitle', line: 'tutorial.boardLine' },
  complete: { title: 'tutorial.completeTitle', line: 'tutorial.completeLine' },
}

function selectorFor(step: TutorialStep) {
  if (step === 'capture' || step === 'file') return '[data-tutorial="capture"]'
  if (step === 'collection') return '[data-tutorial="collection-create"]'
  if (step === 'board') return '[data-tutorial="board-title"]'
  return null
}

function findTarget(step: TutorialStep) {
  if (step === 'collection') {
    return (
      document.querySelector<HTMLElement>('[data-tutorial="collection-name"]') ??
      document.querySelector<HTMLElement>('[data-tutorial="collection-create"]')
    )
  }
  const selector = selectorFor(step)
  return selector ? document.querySelector<HTMLElement>(selector) : null
}

function pathFor(step: TutorialStep) {
  if (step === 'capture' || step === 'file') return '/'
  if (step === 'collection') return '/collections'
  if (step === 'board') return '/boards'
  return null
}

function sampleFile(kind: SampleFile) {
  if (kind === 'image') {
    return new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#8b5cf6"/><circle cx="240" cy="55" r="24" fill="#fde68a"/><path d="M0 180 110 70l70 65 45-40 95 85" fill="#d8b4fe"/></svg>'],
      'weekend-view.svg',
      { type: 'image/svg+xml' },
    )
  }
  if (kind === 'pdf') {
    return new File(['%PDF-1.4\n% BrainBro tutorial\n1 0 obj<</Type/Catalog>>endobj\n%%EOF'], 'trip-guide.pdf', {
      type: 'application/pdf',
    })
  }
  return new File(['Places to visit\n- Old town\n- Local market\n- Sunset viewpoint\n'], 'trip-ideas.txt', {
    type: 'text/plain',
  })
}

/** The mascot follows real controls and advances only after real app actions. */
export function TutorialGuide() {
  const t = useT()
  const tutorial = useTutorial()
  const capture = useCapturePipeline()
  const navigate = useNavigate()
  const location = useLocation()
  const [target, setTarget] = useState<Target | null>(null)
  const [drag, setDrag] = useState<{ kind: SampleFile; x: number; y: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [failed, setFailed] = useState(false)
  const step = tutorial.step

  useEffect(() => {
    if (!step) return
    const path = pathFor(step)
    if (path && location.pathname !== path) navigate(path)
  }, [step, location.pathname, navigate])

  const measure = useEffectEvent(() => {
    if (!step) return setTarget(null)
    const element = findTarget(step)
    setTarget(element ? { element, rect: element.getBoundingClientRect() } : null)
  })

  useEffect(() => {
    if (!step) return
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { childList: true, subtree: true })
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(document.documentElement)
    const element = findTarget(step)
    if (element) resizeObserver.observe(element)
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step, location.pathname])

  if (!step) return null
  const copy = COPY[step]
  const placement = placeGuide(target)

  async function uploadSample(kind: SampleFile) {
    if (uploading) return
    setUploading(true)
    setFailed(false)
    const [result] = await capture.capture({ inputs: [{ kind: 'file', file: sampleFile(kind) }], skipped: [] })
    setUploading(false)
    if (result && 'item' in result) tutorial.complete('file')
    else setFailed(true)
  }

  function dropSample(event: ReactPointerEvent, kind: SampleFile) {
    if (!target?.rect || uploading) return
    setDrag(null)
    const inside =
      event.clientX >= target.rect.left &&
      event.clientX <= target.rect.right &&
      event.clientY >= target.rect.top &&
      event.clientY <= target.rect.bottom
    if (inside) void uploadSample(kind)
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-live="polite">
      {target && (
        <div
          className="absolute rounded-xl ring-3 ring-accent-400 ring-offset-4 ring-offset-white/70 transition-all duration-500 dark:ring-offset-zinc-950/70"
          style={{
            left: target.rect.left - 4,
            top: target.rect.top - 4,
            width: target.rect.width + 8,
            height: target.rect.height + 8,
          }}
        />
      )}

      <div className="absolute w-[min(21rem,calc(100vw-2rem))] transition-[left,top] duration-500 ease-out" style={placement}>
        <div className="pointer-events-auto relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="absolute -left-14 top-2 tutorial-mascot-bob">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent-100 shadow-lg ring-2 ring-white dark:bg-accent-950 dark:ring-zinc-900">
              <Logo className="size-8" />
            </div>
          </div>
          <div className="absolute left-[-9px] top-7 size-4 rotate-45 border-b border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900" />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">{t(copy.title)}</p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{t(copy.line)}</p>
            </div>
            <button type="button" className="button-icon -mr-1 -mt-1 size-8 shrink-0" aria-label={t('tutorial.skip')} onClick={tutorial.stop}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {step === 'file' && (
            <SampleFolder
              drag={drag}
              uploading={uploading}
              onDrag={(kind, event) => setDrag({ kind, x: event.clientX, y: event.clientY })}
              onDrop={dropSample}
              onKeyboardDrop={(kind) => void uploadSample(kind)}
            />
          )}

          {failed && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{t('tutorial.fileFailed')}</p>}

          {step === 'complete' ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <PartyPopper className="size-6 text-amber-500 tutorial-celebrate" aria-hidden="true" />
              <button type="button" className="button-primary" onClick={tutorial.stop}>{t('tutorial.finish')}</button>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
              <span>{t('tutorial.step', { current: ['capture', 'file', 'collection', 'board'].indexOf(step) + 1, total: 4 })}</span>
              <button type="button" className="ml-auto button-ghost" onClick={tutorial.stop}>{t('tutorial.skip')}</button>
            </div>
          )}
        </div>
      </div>

      {drag && (
        <div className="absolute flex items-center gap-2 rounded-lg border border-accent-300 bg-white px-3 py-2 text-sm shadow-xl dark:border-accent-700 dark:bg-zinc-800" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          <SampleIcon kind={drag.kind} />
          {t(`tutorial.${drag.kind}File` as MessageKey)}
        </div>
      )}
    </div>
  )
}

function placeGuide(target: Target | null): CSSProperties {
  if (!target) return { left: 'max(4.5rem, calc(50vw - 9rem))', top: '7rem' }
  const { rect, element } = target
  const width = Math.min(336, window.innerWidth - 32)
  if (element.closest('[role="dialog"]') && window.innerWidth >= 900) {
    const right = rect.right + 72
    const left = right + width <= window.innerWidth - 16 ? right : Math.max(72, rect.left - width - 72)
    return { left, top: Math.max(72, rect.top - 20) }
  }
  const left = Math.max(72, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2))
  const top = rect.bottom + 200 < window.innerHeight ? rect.bottom + 22 : Math.max(16, rect.top - 230)
  return { left, top }
}

function SampleFolder({
  drag,
  uploading,
  onDrag,
  onDrop,
  onKeyboardDrop,
}: {
  drag: { kind: SampleFile; x: number; y: number } | null
  uploading: boolean
  onDrag: (kind: SampleFile, event: ReactPointerEvent) => void
  onDrop: (event: ReactPointerEvent, kind: SampleFile) => void
  onKeyboardDrop: (kind: SampleFile) => void
}) {
  const t = useT()
  return (
    <div className="relative mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
      <p className="px-1 pb-1.5 text-xs font-semibold text-zinc-500">{t('tutorial.folder')}</p>
      <div className="space-y-1">
        {(['pdf', 'image', 'text'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={uploading}
            className="flex w-full touch-none items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-left text-sm shadow-sm transition hover:bg-accent-50 active:cursor-grabbing dark:bg-zinc-800 dark:hover:bg-accent-950"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              onDrag(kind, event)
            }}
            onPointerMove={(event) => drag?.kind === kind && onDrag(kind, event)}
            onPointerUp={(event) => drag?.kind === kind && onDrop(event, kind)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onKeyboardDrop(kind)
            }}
          >
            <SampleIcon kind={kind} />
            {t(`tutorial.${kind}File` as MessageKey)}
          </button>
        ))}
      </div>
      {!drag && !uploading && (
        <div className="pointer-events-none absolute right-5 bottom-3 tutorial-drag-hand text-accent-600">
          <Hand className="size-6 fill-white dark:fill-zinc-900" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

function SampleIcon({ kind }: { kind: SampleFile }) {
  if (kind === 'image') return <FileImage className="size-4 shrink-0 text-sky-500" aria-hidden="true" />
  return <FileText className={`size-4 shrink-0 ${kind === 'pdf' ? 'text-red-500' : 'text-zinc-500'}`} aria-hidden="true" />
}
