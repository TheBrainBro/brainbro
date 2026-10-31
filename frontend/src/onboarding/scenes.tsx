import {
  Check,
  FileText,
  Image,
  Link2,
  List,
  MousePointer2,
  Network,
  StickyNote,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { MOD } from '../lib/keys'

/**
 * A looping animation as a counter: each scene draws itself for the phase it's
 * in and lets CSS transitions move it. With reduced motion it holds `still`.
 */
function usePhase(length: number, interval: number, still = length - 1) {
  const [reduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  const [phase, setPhase] = useState(reduced ? still : 0)
  useEffect(() => {
    if (reduced) return
    const timer = window.setInterval(() => setPhase((value) => (value + 1) % length), interval)
    return () => window.clearInterval(timer)
  }, [reduced, length, interval])
  return phase
}

type Kind = 'note' | 'link' | 'photo' | 'pdf'

const KINDS: Record<Kind, { icon: LucideIcon; tone: string }> = {
  note: {
    icon: StickyNote,
    tone: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  },
  link: { icon: Link2, tone: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  photo: {
    icon: Image,
    tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  pdf: { icon: FileText, tone: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
}

function KindIcon({ kind }: { kind: Kind }) {
  const { icon: Icon, tone } = KINDS[kind]
  return (
    <span className={`flex size-5 shrink-0 items-center justify-center rounded ${tone}`}>
      <Icon className="size-3" aria-hidden="true" />
    </span>
  )
}

/** A captured thing, drawn small. */
function Chip({
  kind,
  label,
  className = '',
  style,
  children,
}: {
  kind: Kind
  label: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <div
      className={`absolute flex items-center gap-2 overflow-hidden rounded-lg border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${className}`}
      style={style}
    >
      <KindIcon kind={kind} />
      {label && <span className="truncate">{label}</span>}
      {children}
    </div>
  )
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="relative h-52 overflow-hidden rounded-xl bg-zinc-50 ring-1 ring-zinc-200 select-none dark:bg-zinc-950 dark:ring-zinc-800"
    >
      {children}
    </div>
  )
}

const TYPED = 'Trip ideas'
const PASTED = 'youtube.com/watch?v=dQw4'

/** When each capture lands, in ticks; the image and the PDF are dropped together. */
const CAPTURED: { kind: Kind; label: string; at: number }[] = [
  { kind: 'note', label: TYPED, at: 18 },
  { kind: 'link', label: 'youtube.com', at: 30 },
  { kind: 'photo', label: 'beach.jpg', at: 46 },
  { kind: 'pdf', label: 'flights.pdf', at: 46 },
]

const BOX_TOP = 14
const LIST_TOP = 56
const ROW = 34

/**
 * The capture box takes a typed note, a pasted link and two dropped files, and
 * each one drops from it into the inbox below, the newest on top.
 */
export function CaptureScene() {
  // Ticks of 100ms: type 5-14, Enter 15-18, paste 22-30, drag 34-46, rest, fade 66-75.
  const tick = usePhase(76, 100, 60)
  const gone = tick >= 66
  const typed = tick >= 5 && tick < 18 ? TYPED.slice(0, tick - 4) : ''
  const pasted = tick >= 24 && tick < 30
  const dragging = tick >= 34 && tick < 46
  const over = tick >= 40 && tick < 46
  const landed = CAPTURED.map((item) => tick >= item.at)
  // Newest on top; captured together, in the order they were dropped.
  const row = (index: number) =>
    CAPTURED.filter((other, position) => {
      if (!landed[position]) return false
      const { at } = CAPTURED[index]
      return other.at > at || (other.at === at && position < index)
    }).length

  return (
    <Stage>
      <div className="absolute inset-y-0 left-1/2 w-64 max-w-[86%] -translate-x-1/2">
        <div
          className={`absolute inset-x-0 flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs shadow-sm transition duration-200 ${
            over
              ? 'border-dashed border-accent-400 bg-accent-50 text-accent-600 dark:border-accent-500 dark:bg-accent-500/10 dark:text-accent-300'
              : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
          }`}
          style={{ top: BOX_TOP }}
        >
          {over ? (
            <span className="font-medium">Drop to capture</span>
          ) : typed || pasted ? (
            <span className="truncate text-zinc-800 dark:text-zinc-100">
              {pasted ? PASTED : typed}
              {typed && <span className="ml-px inline-block h-3.5 w-px animate-pulse bg-zinc-500 align-middle" />}
            </span>
          ) : (
            <span className="text-zinc-400">Write or paste anything</span>
          )}
          <span
            className={`ml-auto flex gap-0.5 transition duration-200 ${
              tick >= 15 && tick < 18 ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
            }`}
          >
            <kbd className="kbd">Enter</kbd>
          </span>
          <span
            className={`absolute right-3 flex gap-0.5 transition duration-200 ${
              tick >= 21 && tick < 26 ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
            }`}
          >
            <kbd className="kbd">{MOD}</kbd>
            <kbd className="kbd">V</kbd>
          </span>
        </div>

        {CAPTURED.map((item, index) => (
          <Chip
            key={item.label}
            kind={item.kind}
            label={item.label}
            className={`inset-x-0 h-7 transition-all duration-500 ease-out ${
              landed[index] && !gone ? 'opacity-100' : 'scale-95 opacity-0'
            }`}
            style={{ top: landed[index] ? LIST_TOP + row(index) * ROW : BOX_TOP + 4 }}
          />
        ))}

        {/* The two files, carried in by the pointer. */}
        <div
          className={`absolute right-2 w-36 ease-out ${
            dragging
              ? 'translate-0 opacity-100 transition duration-700'
              : tick < 34
                ? 'translate-x-16 translate-y-64 opacity-100 transition-none'
                : 'opacity-0 transition duration-200'
          }`}
          style={{ top: BOX_TOP + 6 }}
        >
          <Chip kind="pdf" label="flights.pdf" className="top-4 left-5 h-7 w-32 rotate-6" />
          <Chip kind="photo" label="beach.jpg" className="top-0 left-0 h-7 w-32 -rotate-3" />
          <MousePointer2 className="absolute top-5 left-28 size-4 fill-zinc-900 text-white dark:fill-white dark:text-zinc-900" />
        </div>
      </div>
    </Stage>
  )
}

const TRIP = { emoji: '🏖️', name: 'Trip', top: 44 }
const WATCH = { emoji: '🎬', name: 'Watch later', top: 108 }

const SORTED: { kind: Kind; label: string; to: typeof TRIP }[] = [
  { kind: 'note', label: 'Trip ideas', to: TRIP },
  { kind: 'link', label: 'youtube.com', to: WATCH },
  { kind: 'photo', label: 'beach.jpg', to: TRIP },
]

/** The inbox empties, one item at a time, into collections. */
export function SortScene() {
  // 0 hidden, 1 shown, then for each item: picked, filed. 8-9 inbox zero.
  const phase = usePhase(10, 700)
  const filed = (index: number) => phase >= 3 + index * 2
  const count = (folder: typeof TRIP) =>
    SORTED.filter((item, index) => item.to === folder && filed(index)).length
  const arriving = SORTED.find((_, index) => phase === 3 + index * 2)?.to

  return (
    <Stage>
      <div className="absolute top-3 left-[6%] text-[11px] font-semibold text-zinc-500">Inbox</div>
      <div className="absolute top-3 right-[6%] w-[38%] text-[11px] font-semibold text-zinc-500">
        Collections
      </div>
      <div
        className={`absolute top-24 left-[6%] flex w-[44%] items-center justify-center gap-1.5 text-xs font-medium text-emerald-600 transition-opacity duration-500 dark:text-emerald-400 ${
          phase >= 8 ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Check className="size-4" />
        Inbox zero
      </div>

      {[TRIP, WATCH].map((folder) => (
        <div
          key={folder.name}
          className={`absolute right-[6%] flex h-12 w-[38%] items-center gap-2 rounded-lg border bg-white px-2.5 text-xs font-medium shadow-sm transition duration-300 dark:bg-zinc-900 ${
            arriving === folder
              ? 'scale-105 border-accent-400 dark:border-accent-500'
              : 'border-zinc-200 dark:border-zinc-700'
          }`}
          style={{ top: folder.top }}
        >
          <span className="text-base">{folder.emoji}</span>
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto text-zinc-400 tabular-nums">{count(folder)}</span>
        </div>
      ))}

      {SORTED.map((item, index) => {
        const picked = phase === 2 + index * 2
        return (
          <Chip
            key={item.label}
            kind={item.kind}
            label={item.label}
            className={`h-9 duration-500 ease-in-out ${
              phase === 0 ? 'opacity-0 transition-none' : 'transition-all'
            } ${picked ? 'scale-105 ring-2 ring-accent-400' : ''} ${
              filed(index) ? 'left-[58%] w-[34%] scale-75 opacity-0' : 'left-[6%] w-[44%]'
            }`}
            style={{ top: filed(index) ? item.to.top + 6 : 36 + index * 44 }}
          />
        )
      })}
    </Stage>
  )
}

type Layout = 'list' | 'board' | 'graph'

const LENSES: { layout: Layout; icon: LucideIcon }[] = [
  { layout: 'list', icon: List },
  { layout: 'board', icon: Waypoints },
  { layout: 'graph', icon: Network },
]

/** Where each item sits, by its center in percent of the stage, per layout. */
const VIEWED: { kind: Kind; label: string; at: Record<Layout, [number, number]> }[] = [
  { kind: 'note', label: 'Trip ideas', at: { list: [50, 30], board: [24, 34], graph: [26, 38] } },
  { kind: 'link', label: 'youtube.com', at: { list: [50, 45], board: [74, 30], graph: [72, 30] } },
  { kind: 'photo', label: 'beach.jpg', at: { list: [50, 60], board: [26, 78], graph: [32, 80] } },
  { kind: 'note', label: 'Packing list', at: { list: [50, 75], board: [72, 76], graph: [70, 74] } },
  { kind: 'link', label: 'maps.app', at: { list: [50, 90], board: [50, 55], graph: [50, 55] } },
]

const LINES: Record<Exclude<Layout, 'list'>, [number, number][]> = {
  board: [
    [0, 4],
    [4, 1],
    [4, 3],
  ],
  graph: [
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [0, 2],
    [1, 3],
  ],
}

const SHAPES: Record<Layout, string> = {
  list: 'h-7 w-[64%]',
  board: 'h-9 w-[30%]',
  graph: 'h-8 w-8 justify-center rounded-full px-0',
}

/** The same items as a list, laid out on a board, then as a graph. */
export function ViewsScene() {
  const phase = usePhase(3, 2000)
  const layout = LENSES[phase].layout

  return (
    <Stage>
      <div className="absolute top-2.5 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800/70">
        {LENSES.map(({ layout: lens, icon: Icon }) => (
          <span
            key={lens}
            className={`flex h-6 w-8 items-center justify-center rounded-md transition duration-300 ${
              lens === layout
                ? 'bg-white text-accent-600 shadow-sm dark:bg-zinc-900 dark:text-accent-300'
                : 'text-zinc-400'
            }`}
          >
            <Icon className="size-3.5" />
          </span>
        ))}
      </div>

      {(['board', 'graph'] as const).map((lines) => (
        <svg
          key={lines}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className={`absolute inset-0 size-full transition-opacity duration-500 ${
            layout === lines ? 'opacity-100 delay-300' : 'opacity-0'
          }`}
        >
          {LINES[lines].map(([from, to]) => {
            const [x1, y1] = VIEWED[from].at[lines]
            const [x2, y2] = VIEWED[to].at[lines]
            return (
              <line
                key={`${from}-${to}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className="stroke-accent-300 dark:stroke-accent-700"
              />
            )
          })}
        </svg>
      ))}

      {VIEWED.map((item) => {
        const [x, y] = item.at[layout]
        return (
          <Chip
            key={item.label}
            kind={item.kind}
            label={layout === 'graph' ? '' : item.label}
            className={`-translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-in-out ${SHAPES[layout]}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        )
      })}
    </Stage>
  )
}
