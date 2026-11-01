import { currentLanguage, t } from '../i18n/i18n'

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

export function timeAgo(iso: string, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeTime().format(Math.round(seconds / size), unit)
  }
  return t('common.justNow')
}

const relativeTimes = new Map<string, Intl.RelativeTimeFormat>()

function relativeTime() {
  const language = currentLanguage()
  let format = relativeTimes.get(language)
  if (!format) {
    format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
    relativeTimes.set(language, format)
  }
  return format
}
