import { ALT, combo, MOD } from '../lib/keys'

export type Shortcut = { keys: string[]; label: string }
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] }

const LIST: ShortcutGroup = {
  title: 'Lists',
  shortcuts: [
    { keys: ['J', 'K'], label: 'Next or previous item (also ↓ ↑)' },
    { keys: ['Enter'], label: 'Open' },
    { keys: ['X'], label: 'Select' },
    { keys: ['O'], label: 'Organize' },
    { keys: ['E'], label: 'Archive' },
    { keys: ['#'], label: 'Delete' },
    { keys: ['Esc'], label: 'Clear selection' },
    { keys: [ALT, '↑', '↓'], label: 'Move the item up or down (or drag it)' },
  ],
}

const VIEWER: ShortcutGroup = {
  title: 'Viewer',
  shortcuts: [
    { keys: ['←', '→'], label: 'Previous or next' },
    { keys: ['Esc'], label: 'Close' },
  ],
}

/** The shortcuts for the screen at `pathname`, most specific first. */
export function shortcutsFor(pathname: string): ShortcutGroup[] {
  const everywhere: ShortcutGroup = {
    title: 'Everywhere',
    shortcuts: [
      { keys: [combo('K')], label: 'Search' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
  }
  if (pathname === '/') {
    return [
      {
        title: 'Inbox',
        shortcuts: [
          { keys: ['/'], label: 'Write in the capture box' },
          { keys: ['N'], label: 'New note' },
          { keys: [MOD, 'V'], label: 'Paste anywhere to capture' },
        ],
      },
      LIST,
      VIEWER,
      everywhere,
    ]
  }
  if (pathname.startsWith('/collections/')) return [LIST, VIEWER, everywhere]
  if (pathname.startsWith('/notes/')) {
    return [
      {
        title: 'Note',
        shortcuts: [
          { keys: [combo('S')], label: 'Save now (it also saves on its own)' },
          { keys: [`${MOD}-click`], label: 'Open a link' },
        ],
      },
      everywhere,
    ]
  }
  if (pathname.startsWith('/boards/')) {
    return [
      {
        title: 'Tools',
        shortcuts: [
          { keys: ['V'], label: 'Select' },
          { keys: ['H'], label: 'Pan' },
          { keys: ['S'], label: 'Sticky note' },
          { keys: ['P'], label: 'Pen' },
          { keys: ['F'], label: 'Group' },
          { keys: ['Esc'], label: 'Back to select' },
        ],
      },
      {
        title: 'Board',
        shortcuts: [
          { keys: ['N'], label: 'Note' },
          { keys: ['L'], label: 'Link' },
          { keys: [MOD, 'V'], label: 'Paste onto the board' },
          { keys: [combo('G')], label: 'Group the selection' },
          { keys: [combo('G', { shift: true })], label: 'Ungroup' },
          { keys: ['Delete'], label: 'Take off the board (the item stays)' },
          { keys: [combo('Z')], label: 'Undo' },
          { keys: [combo('Z', { shift: true })], label: 'Redo' },
        ],
      },
      VIEWER,
      everywhere,
    ]
  }
  return [everywhere]
}
