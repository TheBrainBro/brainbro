import { Bot, Check, LayoutDashboard, Loader2, Network, Sparkles, X, type LucideIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useCreateSampleContent, useSession } from '../auth/session'
import { useT, type MessageKey } from '../i18n/i18n'
import { Logo } from '../layout/Logo'
import {
  useTutorial,
  type TutorialAction,
  type TutorialCollection,
  type TutorialStep,
  type TutorialTrack,
} from './tutorial'

type Target = { rect: DOMRect; element: HTMLElement }
type Copy = { title: MessageKey; line: MessageKey }

const COPY: Record<TutorialStep, Copy> = {
  capture: { title: 'tutorial.captureTitle', line: 'tutorial.captureLine' },
  organize: { title: 'tutorial.organizeTitle', line: 'tutorial.organizeLine' },
  organized: { title: 'tutorial.organizedTitle', line: 'tutorial.organizedLine' },
  done: { title: 'tutorial.doneTitle', line: 'tutorial.doneLine' },
  boardCreate: { title: 'tutorial.boardCreateTitle', line: 'tutorial.boardCreateLine' },
  boardName: { title: 'tutorial.boardNameTitle', line: 'tutorial.boardNameLine' },
  boardAdd: { title: 'tutorial.boardAddTitle', line: 'tutorial.boardAddLine' },
  boardPlace: { title: 'tutorial.boardPlaceTitle', line: 'tutorial.boardPlaceLine' },
  boardTools: { title: 'tutorial.boardToolsTitle', line: 'tutorial.boardToolsLine' },
  graph: { title: 'tutorial.graphTitle', line: 'tutorial.graphLine' },
  graphFilters: { title: 'tutorial.graphFiltersTitle', line: 'tutorial.graphFiltersLine' },
  assistant: { title: 'tutorial.assistantTitle', line: 'tutorial.assistantLine' },
  examples: { title: 'tutorial.examplesTitle', line: 'tutorial.examplesLine' },
}

// Most specific first: the Organize menu's filter once it's open, its button before.
const SELECTORS: Record<TutorialStep, string[]> = {
  capture: ['[data-tutorial="capture"]'],
  organize: ['[data-tutorial="organize-filter"]', '[data-tutorial="organize"]'],
  organized: ['[data-tutorial="inbox-item"]'],
  done: [],
  boardCreate: ['[data-tutorial="board-create"]'],
  boardName: ['[data-tutorial="board-title"]'],
  boardAdd: ['[data-tutorial="board-add"]'],
  boardPlace: ['[data-tutorial="board-item-add"]'],
  boardTools: ['[data-tutorial="board-tools"]'],
  graph: ['[data-tutorial="graph"]'],
  graphFilters: ['[data-tutorial="graph-filters"]'],
  assistant: ['[data-tutorial="assistant-setup"]'],
  // Nothing lit: the examples arriving are the point.
  examples: [],
}

// Where each step stands: [current, total] within the first loop or its track.
const PROGRESS: Partial<Record<TutorialStep, [number, number]>> = {
  capture: [1, 3],
  organize: [2, 3],
  organized: [3, 3],
  boardCreate: [1, 5],
  boardName: [2, 5],
  boardAdd: [3, 5],
  boardPlace: [4, 5],
  boardTools: [5, 5],
  graph: [1, 2],
  graphFilters: [2, 2],
}

// Steps read, not done: they move on with Continue.
const READ: Partial<Record<TutorialStep, true>> = {
  organized: true,
  boardTools: true,
  graph: true,
  graphFilters: true,
  assistant: true,
  examples: true,
}

const FIRST_LOOP: TutorialStep[] = ['capture', 'organize', 'organized']

function findTarget(step: TutorialStep) {
  for (const selector of SELECTORS[step]) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) return element
  }
  return null
}

function pathFor(step: TutorialStep, collection: TutorialCollection | null) {
  if (step === 'capture' || step === 'organize' || step === 'examples') return '/'
  if (step === 'organized' && collection) return `/collections/${collection.id}`
  if (step === 'boardCreate' || step === 'boardName') return '/boards'
  if (step === 'graph' || step === 'graphFilters') return '/graph'
  return null
}

/** The mascot follows real controls and advances only after real app actions. */
export function TutorialGuide({
  onOpenAssistants,
  onCloseSettings,
}: {
  onOpenAssistants: () => void
  onCloseSettings: () => void
}) {
  const t = useT()
  const tutorial = useTutorial()
  const navigate = useNavigate()
  const location = useLocation()
  // Here, not in the hub: the examples keep loading once the hub is gone.
  const createSample = useCreateSampleContent()
  const [target, setTarget] = useState<Target | null>(null)
  const { step, collection } = tutorial

  useEffect(() => {
    if (!step) return
    const path = pathFor(step, collection)
    if (path && location.pathname !== path) navigate(path)
  }, [step, collection, location.pathname, navigate])

  // The examples start once the Inbox is on screen, so they're seen arriving.
  const addExamples = useEffectEvent(() => {
    if (createSample.isIdle) createSample.mutate(`${window.location.origin}/api/mcp`)
  })
  useEffect(() => {
    if (step !== 'examples' || location.pathname !== '/') return
    const timer = window.setTimeout(addExamples, 600)
    return () => window.clearTimeout(timer)
  }, [step, location.pathname])

  const measure = useEffectEvent(() => {
    const element = step ? findTarget(step) : null
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
  const hub = step === 'done'
  const loadingExamples = step === 'examples' && !createSample.isSuccess
  const copy: Copy = hub && tutorial.seen.length
    ? { title: 'tutorial.hubTitle', line: 'tutorial.hubLine' }
    : loadingExamples
      ? { title: 'tutorial.examplesLoadingTitle', line: 'tutorial.examplesLoadingLine' }
      : COPY[step]
  const progress = PROGRESS[step]
  const inTrack = !hub && !FIRST_LOOP.includes(step)

  function open(track: TutorialTrack) {
    if (track === 'examples') createSample.reset()
    tutorial.open(track)
    if (track === 'assistant') onOpenAssistants()
  }

  function next() {
    if (step === 'assistant') onCloseSettings()
    tutorial.complete(step as TutorialAction)
  }

  function back() {
    if (step === 'assistant') onCloseSettings()
    tutorial.toHub()
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

      <div
        data-tutorial-guide
        className="absolute w-[min(22rem,calc(100vw-2rem))] transition-[left,top] duration-700 ease-out"
        style={placeGuide(target, step, location.pathname)}
      >
        <div className="pointer-events-auto relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="absolute -left-14 top-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent-100 shadow-lg ring-2 ring-white dark:bg-accent-950 dark:ring-zinc-900">
              <Logo className="size-8" />
            </div>
          </div>
          <div className="absolute left-[-9px] top-7 size-4 rotate-45 border-b border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900" />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                {loadingExamples && !createSample.isError && (
                  <Loader2 className="size-4 animate-spin text-accent-500" aria-hidden="true" />
                )}
                {t(copy.title)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                {t(copy.line, { name: collection?.name ?? '' })}
              </p>
            </div>
            <button type="button" className="button-icon -mr-1 -mt-1 size-8 shrink-0" aria-label={t('tutorial.skip')} onClick={tutorial.stop}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {step === 'examples' && createSample.isError && (
            <p role="alert" className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              {t('tutorial.examplesFailed')}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => createSample.mutate(`${window.location.origin}/api/mcp`)}
              >
                {t('tutorial.retry')}
              </button>
            </p>
          )}

          {hub ? (
            <NextSteps seen={tutorial.seen} onOpen={open} onFinish={tutorial.finish} />
          ) : (
            <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
              {progress &&
                (inTrack ? (
                  <span>{t('tutorial.progress', { current: progress[0], total: progress[1] })}</span>
                ) : (
                  <span>{t('tutorial.step', { current: progress[0], total: progress[1] })}</span>
                ))}
              <span className="ml-auto flex items-center gap-1">
                {inTrack ? (
                  <button type="button" className="button-ghost" onClick={back}>
                    {t('tutorial.backToList')}
                  </button>
                ) : (
                  !READ[step] && (
                    <button type="button" className="button-ghost" onClick={tutorial.stop}>
                      {t('tutorial.skip')}
                    </button>
                  )
                )}
                {READ[step] && (
                  <button type="button" className="button-primary" disabled={loadingExamples} onClick={next}>
                    {t('tutorial.continue')}
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The hub: where to go once the first loop is done, each place with its own short track. */
function NextSteps({
  seen,
  onOpen,
  onFinish,
}: {
  seen: TutorialTrack[]
  onOpen: (track: TutorialTrack) => void
  onFinish: () => void
}) {
  const t = useT()
  const { data: session } = useSession()
  const options: { track: TutorialTrack; icon: LucideIcon; title: MessageKey; line: MessageKey }[] = [
    { track: 'boards', icon: LayoutDashboard, title: 'tutorial.boardsAction', line: 'tutorial.boardsActionLine' },
    { track: 'graph', icon: Network, title: 'tutorial.graphAction', line: 'tutorial.graphActionLine' },
    { track: 'assistant', icon: Bot, title: 'tutorial.aiAction', line: 'tutorial.aiActionLine' },
    // Once there are examples, only as a tick for having seen them.
    ...(!session?.has_sample_content || seen.includes('examples')
      ? [{ track: 'examples' as const, icon: Sparkles, title: 'tutorial.examplesAction' as const, line: 'tutorial.examplesActionLine' as const }]
      : []),
  ]

  return (
    <>
      <div className="mt-3 grid gap-1">
        {options.map((option) => (
          <NextStep
            key={option.track}
            icon={option.icon}
            title={t(option.title)}
            line={t(option.line)}
            seen={seen.includes(option.track)}
            onClick={() => onOpen(option.track)}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" className="button-primary" onClick={onFinish}>
          {t('tutorial.finish')}
        </button>
      </div>
    </>
  )
}

function NextStep({
  icon: Icon,
  title,
  line,
  seen,
  onClick,
}: {
  icon: LucideIcon
  title: string
  line: string
  seen: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex items-start gap-3 rounded-xl p-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
      onClick={onClick}
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          seen
            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
            : 'bg-accent-100 text-accent-600 dark:bg-accent-500/15 dark:text-accent-300'
        }`}
      >
        {seen ? <Check className="size-4" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        <span className="block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{line}</span>
      </span>
    </button>
  )
}

function placeGuide(target: Target | null, step: TutorialStep, pathname: string): CSSProperties {
  const width = Math.min(352, window.innerWidth - 32)
  // On a board or the graph, the hub keeps out of the way of what was just made.
  const canvas = pathname.startsWith('/boards/') || pathname === '/graph'
  // Elsewhere it sits in the middle, the mascot to its left.
  if (step === 'done' && !canvas) return { left: Math.max(72, window.innerWidth / 2 - width / 2 + 28), top: '22vh' }
  // Out of the way of what fills the screen: the examples arriving, the graph.
  if (step === 'examples' || step === 'graph' || step === 'done') {
    return { left: Math.max(72, window.innerWidth - width - 24), top: step === 'graph' ? '9rem' : '7rem' }
  }
  if (!target) return { left: 'max(4.5rem, calc(50vw - 9rem))', top: '7rem' }
  const { rect, element } = target
  // Beside a dialog or menu, not over it.
  if (element.closest('[role="dialog"], [role="menu"]') && window.innerWidth >= 900) {
    const right = rect.right + 72
    const left = right + width <= window.innerWidth - 16 ? right : Math.max(72, rect.left - width - 72)
    return { left, top: Math.max(72, Math.min(window.innerHeight - 260, rect.top - 20)) }
  }
  const left = Math.max(72, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2))
  const top = rect.bottom + 220 < window.innerHeight ? rect.bottom + 22 : Math.max(72, rect.top - 245)
  return { left, top }
}
