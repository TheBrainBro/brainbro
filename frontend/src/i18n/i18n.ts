import { Fragment, createElement, useSyncExternalStore, type ReactNode } from 'react'

import { en } from './en'
import { es } from './es'
import type { Messages } from './en'
import type { Plural } from './types'

/** The languages the app is written in. English is the source; the others follow its keys. */
export const LANGUAGES = { en, es } satisfies Record<string, Messages>

export type Language = keyof typeof LANGUAGES

/** A language, or whatever the browser is set to. */
export type LanguageChoice = Language | 'system'

/** Each language by its own name: someone lost in a language they don't read still finds theirs. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español' }

const KEY = 'brainbro:language'

const listeners = new Set<() => void>()

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in LANGUAGES
}

/** The browser's first language the app speaks, English otherwise. */
export function browserLanguage(): Language {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'en'
}

function storedChoice(): LanguageChoice {
  try {
    const value = localStorage.getItem(KEY)
    if (isLanguage(value)) return value
  } catch {
    // Blocked storage: the browser's language until the session arrives.
  }
  return 'system'
}

let choice: LanguageChoice = storedChoice()
let language: Language = choice === 'system' ? browserLanguage() : choice
document.documentElement.lang = language

/** The language chosen, `system` while following the browser. */
export function currentChoice(): LanguageChoice {
  return choice
}

/** The language shown now. */
export function currentLanguage(): Language {
  return language
}

/** Shows `next` and remembers it on this device until the session says otherwise. */
export function applyLanguage(next: LanguageChoice) {
  choice = next
  language = next === 'system' ? browserLanguage() : next
  document.documentElement.lang = language
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Blocked storage: the next load follows the browser until the session arrives.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/** Every key of the messages: dotted paths to a string, or to a plural (`one`, `other`…). */
type Keys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | Plural
    ? `${Prefix}${K}`
    : Keys<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type MessageKey = Keys<Messages>

type Values = Record<string, string | number>

function lookup(messages: Messages, key: string): string | Plural | undefined {
  let node: unknown = messages
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part]
  }
  return node as string | Plural | undefined
}

function pick(message: string | Plural, count: number | undefined) {
  if (typeof message === 'string') return message
  const category = new Intl.PluralRules(language).select(count ?? 0)
  return message[category] ?? message.other
}

function fill(text: string, values: Values | undefined) {
  if (!values) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    if (value === undefined) return match
    return typeof value === 'number' ? value.toLocaleString(language) : value
  })
}

/**
 * The message under `key` in the language shown, `{name}` filled from
 * `values`; a plural picks its form by `values.count`. A key missing in a
 * translation falls back to English.
 */
export function t(key: MessageKey, values?: Values): string {
  const message = lookup(LANGUAGES[language], key) ?? lookup(en, key) ?? key
  return fill(pick(message, values?.count as number | undefined), values)
}

type RichValues = Record<string, ReactNode | ((chunk: string) => ReactNode)>

/**
 * A message with markup in it: `<b>text</b>` goes through the function under
 * `b`, `{name}` takes any node. Plain values are filled as in `t`.
 */
export function rich(key: MessageKey, values: RichValues): ReactNode {
  const plain: Values = {}
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number') plain[name] = value
  }
  const message = lookup(LANGUAGES[language], key) ?? lookup(en, key) ?? key
  const text = fill(pick(message, plain.count as number | undefined), plain)
  // Split around `<tag>…</tag>` and the `{name}` left: odd parts are tokens, then the tag name.
  const parts = text.split(/(<(\w+)>.*?<\/\2>|\{\w+\})/s)
  const nodes: ReactNode[] = []
  for (let index = 0; index < parts.length; index += 3) {
    if (parts[index]) nodes.push(parts[index])
    const token = parts[index + 1]
    if (token === undefined) continue
    const tag = parts[index + 2]
    const value = values[tag ?? token.slice(1, -1)]
    if (tag) {
      const inner = token.slice(tag.length + 2, -(tag.length + 3))
      nodes.push(typeof value === 'function' ? value(inner) : inner)
    } else {
      nodes.push(typeof value === 'function' ? token : value)
    }
  }
  return createElement(Fragment, null, ...nodes)
}

/** The language shown, kept up to date. */
export function useLanguage() {
  return useSyncExternalStore(subscribe, currentLanguage)
}

/** `t` for a component: it renders again when the language changes. */
export function useT() {
  useLanguage()
  return t
}

/** The language chosen (`system` while following the browser), kept up to date. */
export function useLanguageChoice() {
  return useSyncExternalStore(subscribe, currentChoice)
}
