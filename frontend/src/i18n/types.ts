/** A message that changes with a count, by the language's plural categories. */
export type Plural = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>

/** The shape of a translation: every key English has, any plural forms the language needs. */
export type Translation<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends { other: string }
      ? Plural
      : Translation<T[K]>
}
