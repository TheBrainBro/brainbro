# Translations

The app speaks English and Spanish. Every string the UI shows goes through
`frontend/src/i18n`, so a new screen is translated as it is written.

## Choosing the language

Settings → Language: a language, or **Browser**, the default, which follows
the first language the browser asks for that the app speaks (English when
none). The choice is saved on the account, like the theme, so it holds on
every device; each device also remembers it, so the first paint is already
in the right language before the session arrives.

Public notes and blogs are read by people without an account: their pages
follow the visitor's browser.

## In the code

- `en.ts` holds every message, grouped by screen. It is the source: the
  other languages have the same keys, and TypeScript fails the build when
  one is missing or misspelled.
- `t('collections.created', { name })` returns a message, `{name}` filled
  in. Components get `t` from `useT()`, so they render again when the
  language changes; code outside React imports `t` itself.
- A message that depends on a count is a plural: `{ one, other }`, plus any
  other form a language needs (`few`, `many`…). `t('counts.items', { count })`
  picks the form, and numbers are written the language's way.
- `rich(key, values)` returns nodes instead of a string: `<b>…</b>` in the
  message goes through the function under `b`, and a `{name}` can take any
  element (a link, a `<kbd>`).
- Dates and relative times (`timeAgo`) use the language shown.

## Adding a language

1. Copy `es.ts` to the new language's code (`fr.ts`), translate each
   message, and keep every `{name}` and `<tag>` as they are.
2. Add it to `LANGUAGES` and `LANGUAGE_NAMES` (its own name for itself) in
   `i18n.ts`, and to `Profile.Language` in `backend/apps/accounts/models.py`,
   with its migration.
3. `i18n.test.tsx` checks that it has every key and the same values and
   markup as English.

## Not translated yet

Messages that come from the server (validation errors, the Telegram bot's
replies) and the PWA manifest (the app's name and description on install)
are still in English.
