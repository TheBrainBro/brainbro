import { FileImage, FileText, FolderOpen, Hand, X } from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'

import { DropOverlay } from '../capture/CaptureProvider'
import { useCapturePipeline } from '../capture/context'
import { useT, type MessageKey } from '../i18n/i18n'
import { Logo } from '../layout/Logo'
import { useTutorial, type TutorialStep } from './tutorial'

type Target = { rect: DOMRect; element: HTMLElement }
type SampleFile = 'pdf' | 'image' | 'text'
type SampleDrag = { kind: SampleFile; x: number; y: number; startX: number; startY: number }

const COPY: Record<TutorialStep, { title: MessageKey; line: MessageKey }> = {
  capture: { title: 'tutorial.captureTitle', line: 'tutorial.captureLine' },
  noteSaved: { title: 'tutorial.noteSavedTitle', line: 'tutorial.noteSavedLine' },
  file: { title: 'tutorial.fileTitle', line: 'tutorial.fileLine' },
  voice: { title: 'tutorial.voiceTitle', line: 'tutorial.voiceLine' },
  newNoteNav: { title: 'tutorial.newNoteNavTitle', line: 'tutorial.newNoteNavLine' },
  newNoteWrite: { title: 'tutorial.newNoteWriteTitle', line: 'tutorial.newNoteWriteLine' },
  collectionsNav: { title: 'tutorial.collectionsNavTitle', line: 'tutorial.collectionsNavLine' },
  collectionCreate: { title: 'tutorial.collectionCreateTitle', line: 'tutorial.collectionCreateLine' },
  collectionName: { title: 'tutorial.collectionNameTitle', line: 'tutorial.collectionNameLine' },
  collectionSubmit: { title: 'tutorial.collectionSubmitTitle', line: 'tutorial.collectionSubmitLine' },
  collectionOpen: { title: 'tutorial.collectionOpenTitle', line: 'tutorial.collectionOpenLine' },
  collectionAdd: { title: 'tutorial.collectionAddTitle', line: 'tutorial.collectionAddLine' },
  boardsNav: { title: 'tutorial.boardsNavTitle', line: 'tutorial.boardsNavLine' },
  boardCreate: { title: 'tutorial.boardCreateTitle', line: 'tutorial.boardCreateLine' },
  boardName: { title: 'tutorial.boardNameTitle', line: 'tutorial.boardNameLine' },
  boardSubmit: { title: 'tutorial.boardSubmitTitle', line: 'tutorial.boardSubmitLine' },
  boardAddOpen: { title: 'tutorial.boardAddOpenTitle', line: 'tutorial.boardAddOpenLine' },
  boardAddFirst: { title: 'tutorial.boardAddFirstTitle', line: 'tutorial.boardAddFirstLine' },
  boardAddSecond: { title: 'tutorial.boardAddSecondTitle', line: 'tutorial.boardAddSecondLine' },
  boardConnect: { title: 'tutorial.boardConnectTitle', line: 'tutorial.boardConnectLine' },
  graphNav: { title: 'tutorial.graphNavTitle', line: 'tutorial.graphNavLine' },
  graphIntro: { title: 'tutorial.graphIntroTitle', line: 'tutorial.graphIntroLine' },
  accountNav: { title: 'tutorial.accountNavTitle', line: 'tutorial.accountNavLine' },
  accountMenu: { title: 'tutorial.accountMenuTitle', line: 'tutorial.accountMenuLine' },
}

const SELECTORS: Record<TutorialStep, string> = {
  capture: '[data-tutorial="capture"]',
  noteSaved: '[data-tutorial="inbox-item"]',
  file: '[data-tutorial="file-drop-anywhere"]',
  voice: '[data-tutorial="voice"]',
  newNoteNav: '[data-tutorial="new-note"]',
  newNoteWrite: '[data-tutorial="note-editor"]',
  collectionsNav: '[data-tutorial="nav-collections"]',
  collectionCreate: '[data-tutorial="collection-create"]',
  collectionName: '[data-tutorial="collection-name"]',
  collectionSubmit: '[data-tutorial="collection-submit"]',
  collectionOpen: '[data-tutorial="collection-open"]',
  collectionAdd: '[data-tutorial="collection-add"]',
  boardsNav: '[data-tutorial="nav-boards"]',
  boardCreate: '[data-tutorial="board-create"]',
  boardName: '[data-tutorial="board-title"]',
  boardSubmit: '[data-tutorial="board-submit"]',
  boardAddOpen: '[data-tutorial="board-add"]',
  boardAddFirst: '[data-tutorial="board-item-add"]',
  boardAddSecond: '[data-tutorial="board-item-add"]',
  boardConnect: '[data-tutorial="board-node"]',
  graphNav: '[data-tutorial="nav-graph"]',
  graphIntro: '[data-tutorial="graph"]',
  accountNav: '[data-tutorial="account"]',
  accountMenu: '[data-tutorial="account-settings"]',
}

function findTarget(step: TutorialStep) {
  return document.querySelector<HTMLElement>(SELECTORS[step])
}

function pathFor(step: TutorialStep) {
  if (['capture', 'noteSaved', 'file', 'voice', 'newNoteNav'].includes(step)) return '/'
  if (['collectionCreate', 'collectionName', 'collectionSubmit', 'collectionOpen'].includes(step)) return '/collections'
  if (['boardCreate', 'boardName', 'boardSubmit'].includes(step)) return '/boards'
  if (step === 'graphIntro') return '/graph'
  return null
}

function phaseFor(step: TutorialStep) {
  if (step.startsWith('collection') || step === 'collectionsNav') return 2
  if (step.startsWith('board') || step === 'boardsNav') return 3
  if (step.startsWith('graph')) return 4
  if (step.startsWith('account')) return 5
  return 1
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
  const [drag, setDrag] = useState<SampleDrag | null>(null)
  const [uploading, setUploading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [demoOrigin, setDemoOrigin] = useState<DOMRect | null>(null)
  const demoTile = useRef<HTMLButtonElement>(null)
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
    setDemoOrigin(step === 'file' && demoTile.current ? demoTile.current.getBoundingClientRect() : null)
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
    // React Flow pans and zooms with CSS transforms, which do not trigger a
    // resize or scroll event. Keep the spotlight attached while it moves.
    const tracking = window.setInterval(measure, 200)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      cancelAnimationFrame(frame)
      window.clearInterval(tracking)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step, location.pathname])

  if (!step) return null
  const copy = COPY[step]
  const placement = placeGuide(target, step)

  async function uploadSample(kind: SampleFile) {
    if (uploading) return
    setUploading(true)
    setFailed(false)
    const [result] = await capture.capture({ inputs: [{ kind: 'file', file: sampleFile(kind) }], skipped: [] })
    setUploading(false)
    if (result && 'item' in result) tutorial.complete('file')
    else setFailed(true)
  }

  function dropSample(_event: ReactPointerEvent, kind: SampleFile) {
    if (uploading) return
    const moved = drag && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 8
    setDrag(null)
    if (moved) void uploadSample(kind)
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-live="polite">
      {drag && createPortal(<DropOverlay into={null} />, document.body)}
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

      <div data-tutorial-guide className="absolute w-[min(22rem,calc(100vw-2rem))] transition-[left,top] duration-700 ease-out" style={placement}>
        <div className="pointer-events-auto relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="absolute -left-14 top-2">
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
              demoRef={demoTile}
              drag={drag}
              uploading={uploading}
              onStart={(kind, event) => setDrag({
                kind,
                x: event.clientX,
                y: event.clientY,
                startX: event.clientX,
                startY: event.clientY,
              })}
              onDrag={(kind, event) =>
                setDrag((current) =>
                  current?.kind === kind
                    ? { ...current, x: event.clientX, y: event.clientY }
                    : current,
                )
              }
              onDrop={dropSample}
              onKeyboardDrop={(kind) => void uploadSample(kind)}
            />
          )}

          {failed && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{t('tutorial.fileFailed')}</p>}

          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <span>{t('tutorial.step', { current: phaseFor(step), total: 5 })}</span>
            {step === 'noteSaved' && (
              <button type="button" className="ml-auto button-primary" onClick={() => tutorial.complete('noteSaved')}>
                {t('tutorial.continue')}
              </button>
            )}
            {step === 'voice' && (
              <button type="button" className="ml-auto button-ghost" onClick={() => tutorial.complete('voice')}>
                {t('tutorial.notNow')}
              </button>
            )}
            {step === 'graphIntro' && (
              <button type="button" className="ml-auto button-primary" onClick={() => tutorial.complete('graphIntro')}>
                {t('tutorial.continue')}
              </button>
            )}
            {step === 'accountMenu' ? (
              <button
                type="button"
                className="ml-auto inline-flex whitespace-nowrap button-primary"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  tutorial.stop()
                }}
                onClick={tutorial.stop}
              >
                🎉 {t('tutorial.finish')}
              </button>
            ) : step !== 'noteSaved' && step !== 'voice' && step !== 'graphIntro' ? (
              <button type="button" className="ml-auto button-ghost" onClick={tutorial.stop}>{t('tutorial.skip')}</button>
            ) : null}
          </div>
        </div>
      </div>

      {step === 'file' && demoOrigin && !drag && !uploading && <FileDragDemo origin={demoOrigin} />}

      {drag && (
        <div className="absolute flex items-center gap-2 rounded-lg border border-accent-300 bg-white px-3 py-2 text-sm shadow-xl dark:border-accent-700 dark:bg-zinc-800" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          <SampleIcon kind={drag.kind} />
          {t(`tutorial.${drag.kind}File` as MessageKey)}
        </div>
      )}
    </div>
  )
}

function placeGuide(target: Target | null, step: TutorialStep): CSSProperties {
  const width = Math.min(352, window.innerWidth - 32)
  if (step === 'file') {
    return {
      left: Math.max(72, window.innerWidth - width - 32),
      top: Math.max(88, window.innerHeight - 410),
    }
  }
  if (!target) return { left: 'max(4.5rem, calc(50vw - 9rem))', top: '7rem' }
  const { rect, element } = target
  if (element.closest('[role="dialog"]') && window.innerWidth >= 900) {
    const right = rect.right + 72
    const left = right + width <= window.innerWidth - 16 ? right : Math.max(72, rect.left - width - 72)
    return { left, top: Math.max(72, Math.min(window.innerHeight - 260, rect.top - 20)) }
  }
  const left = Math.max(72, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2))
  const top = rect.bottom + 220 < window.innerHeight ? rect.bottom + 22 : Math.max(72, rect.top - 245)
  return { left, top }
}

function SampleFolder({
  demoRef,
  drag,
  uploading,
  onStart,
  onDrag,
  onDrop,
  onKeyboardDrop,
}: {
  demoRef: RefObject<HTMLButtonElement | null>
  drag: SampleDrag | null
  uploading: boolean
  onStart: (kind: SampleFile, event: ReactPointerEvent) => void
  onDrag: (kind: SampleFile, event: ReactPointerEvent) => void
  onDrop: (event: ReactPointerEvent, kind: SampleFile) => void
  onKeyboardDrop: (kind: SampleFile) => void
}) {
  const t = useT()
  return (
    <div className="tutorial-folder-arrive relative mt-5 pt-3">
      <div className="absolute top-0 left-0 h-7 w-32 rounded-t-xl border border-b-0 border-amber-300 bg-amber-200 dark:border-amber-700 dark:bg-amber-800" />
      <div className="relative rounded-xl rounded-tl-none border border-amber-300 bg-amber-100 p-3 shadow-inner dark:border-amber-700 dark:bg-amber-950">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
          <FolderOpen className="size-5" aria-hidden="true" />
          {t('tutorial.folder')}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['pdf', 'image', 'text'] as const).map((kind) => (
            <button
              key={kind}
              ref={kind === 'image' ? demoRef : undefined}
              type="button"
              disabled={uploading}
              className={`flex min-w-0 touch-none cursor-grab flex-col items-center gap-1.5 rounded-lg border border-white/80 bg-white p-2 text-center text-[11px] leading-tight shadow-sm transition hover:-translate-y-0.5 hover:border-accent-300 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-800 ${drag?.kind === kind ? 'cursor-grabbing' : ''}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                onStart(kind, event)
              }}
              onPointerMove={(event) => drag?.kind === kind && onDrag(kind, event)}
              onPointerUp={(event) => drag?.kind === kind && onDrop(event, kind)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onKeyboardDrop(kind)
              }}
            >
              <SampleIcon kind={kind} large />
              <span className="w-full truncate">{t(`tutorial.${kind}File` as MessageKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function FileDragDemo({ origin }: { origin: DOMRect }) {
  const style = {
    '--tutorial-start-x': `${origin.left + origin.width / 2}px`,
    '--tutorial-start-y': `${origin.top + origin.height / 2}px`,
    '--tutorial-end-x': `${window.innerWidth / 2}px`,
    '--tutorial-end-y': `${window.innerHeight / 2}px`,
  } as CSSProperties
  return (
    <div style={style} aria-hidden="true">
      <div className="tutorial-demo-file fixed left-0 top-0 flex items-center gap-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-sm shadow-xl dark:border-sky-700 dark:bg-zinc-800">
        <FileImage className="size-5 text-sky-500" />
        weekend-view.svg
      </div>
      <Hand className="tutorial-demo-hand fixed left-0 top-0 size-8 fill-white text-accent-600 drop-shadow-lg dark:fill-zinc-900" />
    </div>
  )
}

function SampleIcon({ kind, large = false }: { kind: SampleFile; large?: boolean }) {
  const size = large ? 'size-8' : 'size-4'
  if (kind === 'image') return <FileImage className={`${size} shrink-0 text-sky-500`} aria-hidden="true" />
  return <FileText className={`${size} shrink-0 ${kind === 'pdf' ? 'text-red-500' : 'text-zinc-500'}`} aria-hidden="true" />
}
