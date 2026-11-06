import { Compass, Loader2, Sparkles, X, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import { useCreateSampleContent } from '../auth/session'
import { useT } from '../i18n/i18n'
import { Logo } from '../layout/Logo'
import { Particles } from './Particles'

// three.js and the model only download when this screen opens.
const MascotStage = lazy(() => import('./MascotStage'))

type Phase = 'intro' | 'choose'
type Mascot = 'loading' | 'ready' | 'failed'

// How long the mascot holds the stage before the choices come in.
const INTRO_MS = 1700
// Past this, the choices come in even if the model is still loading.
const INTRO_MAX_MS = 3500
// The exit animation (index.css, welcome-leaving), before the app takes over.
const LEAVE_MS = 550

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The first visit: the Blob arrives in a burst of light, then one choice,
 * a hands-on tour, a brain already filled with examples, or an empty one.
 */
export function WelcomeDialog({
  onClose,
  onTour,
  onExamples,
}: {
  onClose: () => void
  onTour: () => void
  onExamples: () => void
}) {
  const t = useT()
  const createSample = useCreateSampleContent()
  const [still] = useState(prefersReducedMotion)
  const [phase, setPhase] = useState<Phase>(still ? 'choose' : 'intro')
  const [mascot, setMascot] = useState<Mascot>('loading')
  const [leaving, setLeaving] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const leaveTimer = useRef<number | undefined>(undefined)

  useEffect(() => dialog.current?.focus(), [])
  useEffect(() => () => window.clearTimeout(leaveTimer.current), [])

  // Dissolves the way it came in, then hands over to the choice made.
  const leave = (then: () => void) => {
    if (leaving) return
    if (still) return then()
    setLeaving(true)
    leaveTimer.current = window.setTimeout(then, LEAVE_MS)
  }
  const close = () => leave(onClose)

  useEffect(() => {
    if (phase !== 'intro') return
    const timer = window.setTimeout(() => setPhase('choose'), mascot === 'loading' ? INTRO_MAX_MS : INTRO_MS)
    return () => window.clearTimeout(timer)
  }, [phase, mascot])

  const examples = () => {
    if (createSample.isPending) return
    createSample.mutate(`${window.location.origin}/api/mcp`, { onSuccess: () => leave(onExamples) })
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="welcome-title"
      className={`fixed inset-0 z-50 overflow-y-auto text-white outline-none ${leaving ? 'welcome-leaving' : ''}`}
      // A click or a key during the intro jumps to the choices.
      onClick={() => setPhase('choose')}
      // Keys stop here: the page's own shortcuts don't see them.
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') close()
        else if (phase === 'intro') setPhase('choose')
      }}
    >
      <div className="welcome-backdrop welcome-fade fixed inset-0 bg-[#0d0b12]/95 backdrop-blur-md" />
      <div className="welcome-glow pointer-events-none fixed top-1/2 left-1/2 size-[min(90vw,46rem)] rounded-full" />
      <Particles still={still} className="welcome-fade pointer-events-none fixed inset-0 size-full" />

      <button
        type="button"
        aria-label={t('common.close')}
        className="welcome-fade fixed top-4 right-4 z-10 flex size-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
        onClick={close}
      >
        <X className="size-5" aria-hidden="true" />
      </button>

      <div className="welcome-stage relative flex min-h-full flex-col items-center justify-center px-4 py-10 text-center">
        <div className="relative size-56 sm:size-72">
          {mascot === 'failed' ? (
            <div className="welcome-fallback flex size-full items-center justify-center">
              <Logo className="size-40 drop-shadow-[0_0_40px_rgba(155,128,224,0.6)]" />
            </div>
          ) : (
            <Suspense fallback={null}>
              <MascotStage still={still} onReady={() => setMascot('ready')} onError={() => setMascot('failed')} />
            </Suspense>
          )}
        </div>

        <h1 id="welcome-title" className="welcome-rise mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl" style={{ animationDelay: '450ms' }}>
          {t('welcome.title')}
        </h1>
        <p className="welcome-rise mt-3 text-base text-zinc-300 sm:text-lg" style={{ animationDelay: '650ms' }}>
          {t('welcome.line')}
        </p>

        {/* The choices open below and push the mascot up, from height 0. */}
        <div
          className="grid w-full max-w-2xl transition-[grid-template-rows] duration-700 ease-out"
          style={{ gridTemplateRows: phase === 'choose' ? '1fr' : '0fr' }}
        >
          <div className="min-h-0 overflow-hidden">
            {phase === 'choose' && (
              <div className="p-2 pt-8">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice
                    icon={Compass}
                    title={t('welcome.tourTitle')}
                    line={t('welcome.tourLine')}
                    delay={150}
                    disabled={createSample.isPending}
                    onClick={() => leave(onTour)}
                  />
                  <Choice
                    icon={createSample.isPending ? Loader2 : Sparkles}
                    spinning={createSample.isPending}
                    title={createSample.isPending ? t('welcome.adding') : t('welcome.examplesTitle')}
                    line={t('welcome.examplesLine')}
                    delay={250}
                    disabled={createSample.isPending}
                    onClick={examples}
                  />
                </div>
                {createSample.isError && (
                  <p role="alert" className="mt-3 text-sm text-red-300">
                    {t('welcome.sampleFailed')}
                  </p>
                )}
                <button
                  type="button"
                  className="welcome-rise mt-5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:text-white"
                  style={{ animationDelay: '400ms' }}
                  disabled={createSample.isPending}
                  onClick={close}
                >
                  {t('welcome.empty')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Choice({
  icon: Icon,
  spinning = false,
  title,
  line,
  delay,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  spinning?: boolean
  title: string
  line: string
  delay: number
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="welcome-rise group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:-translate-y-0.5 hover:border-accent-400/60 hover:bg-white/[0.08] hover:shadow-[0_0_40px_-12px_rgba(124,91,214,0.7)] disabled:pointer-events-none disabled:opacity-60"
      style={{ animationDelay: `${delay}ms` }}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-500/20 text-accent-200 ring-1 ring-accent-400/30 transition group-hover:bg-accent-500/30">
        <Icon className={`size-5 ${spinning ? 'animate-spin' : ''}`} aria-hidden="true" />
      </span>
      <span>
        <span className="block font-display text-lg font-semibold">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-zinc-400">{line}</span>
      </span>
    </button>
  )
}
