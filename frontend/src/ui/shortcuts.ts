import { t } from '../i18n/i18n'
import { ALT, combo, MOD } from '../lib/keys'

export type Shortcut = { keys: string[]; label: string }
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] }

function list(): ShortcutGroup {
  return {
    title: t('shortcuts.lists'),
    shortcuts: [
      { keys: ['J', 'K'], label: t('shortcuts.nextPrevious') },
      { keys: ['Enter'], label: t('shortcuts.open') },
      { keys: ['X'], label: t('shortcuts.select') },
      { keys: ['O'], label: t('shortcuts.organize') },
      { keys: ['E'], label: t('shortcuts.archive') },
      { keys: ['#'], label: t('shortcuts.delete') },
      { keys: ['Esc'], label: t('shortcuts.clearSelection') },
      { keys: [ALT, '↑', '↓'], label: t('shortcuts.moveItem') },
    ],
  }
}

/** Hand-sorted collections or boards. */
function sorting(what: 'collection' | 'board'): ShortcutGroup {
  return {
    title: t('shortcuts.sorting'),
    shortcuts: [
      {
        keys: [ALT, '↑', '↓'],
        label: what === 'board' ? t('shortcuts.moveBoard') : t('shortcuts.moveCollection'),
      },
    ],
  }
}

function viewer(): ShortcutGroup {
  return {
    title: t('shortcuts.viewer'),
    shortcuts: [
      { keys: ['←', '→'], label: t('shortcuts.previousNext') },
      { keys: ['Esc'], label: t('shortcuts.close') },
    ],
  }
}

/** The shortcuts for the screen at `pathname`, most specific first. */
export function shortcutsFor(pathname: string): ShortcutGroup[] {
  const everywhere: ShortcutGroup = {
    title: t('shortcuts.everywhere'),
    shortcuts: [
      { keys: [combo('K')], label: t('shortcuts.search') },
      { keys: ['?'], label: t('shortcuts.showShortcuts') },
    ],
  }
  if (pathname === '/') {
    return [
      {
        title: t('shortcuts.inbox'),
        shortcuts: [
          { keys: ['/'], label: t('shortcuts.writeCapture') },
          { keys: ['N'], label: t('shortcuts.newNote') },
          { keys: [MOD, 'V'], label: t('shortcuts.pasteCapture') },
        ],
      },
      list(),
      viewer(),
      everywhere,
    ]
  }
  if (pathname === '/collections') return [sorting('collection'), everywhere]
  if (pathname === '/boards') return [sorting('board'), everywhere]
  if (pathname.startsWith('/collections/')) {
    return [list(), sorting('collection'), viewer(), everywhere]
  }
  if (pathname === '/archive') return [list(), viewer(), everywhere]
  if (pathname.startsWith('/notes/')) {
    return [
      {
        title: t('shortcuts.note'),
        shortcuts: [
          { keys: [combo('S')], label: t('shortcuts.saveNow') },
          { keys: [`${MOD}-click`], label: t('shortcuts.openLink') },
        ],
      },
      everywhere,
    ]
  }
  if (pathname.startsWith('/boards/')) {
    return [
      {
        title: t('shortcuts.tools'),
        shortcuts: [
          { keys: ['V'], label: t('shortcuts.select') },
          { keys: ['H'], label: t('shortcuts.pan') },
          { keys: ['S'], label: t('shortcuts.sticky') },
          { keys: ['P'], label: t('shortcuts.pen') },
          { keys: ['F'], label: t('shortcuts.group') },
          { keys: ['Esc'], label: t('shortcuts.backToSelect') },
        ],
      },
      {
        title: t('shortcuts.board'),
        shortcuts: [
          { keys: ['N'], label: t('shortcuts.note') },
          { keys: ['L'], label: t('shortcuts.link') },
          { keys: [MOD, 'V'], label: t('shortcuts.pasteBoard') },
          { keys: [combo('G')], label: t('shortcuts.groupSelection') },
          { keys: [combo('G', { shift: true })], label: t('shortcuts.ungroup') },
          { keys: ['Delete'], label: t('shortcuts.takeOff') },
          { keys: [combo('Z')], label: t('shortcuts.undo') },
          { keys: [combo('Z', { shift: true })], label: t('shortcuts.redo') },
        ],
      },
      viewer(),
      everywhere,
    ]
  }
  return [everywhere]
}
