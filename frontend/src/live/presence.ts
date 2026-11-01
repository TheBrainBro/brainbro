/**
 * Who this session is to the others in a note: a name and a cursor color.
 * For now one person has several sessions, so the name is the device and
 * browser ("Chrome on Mac"); the color is picked once per device.
 */
export type Presence = { name: string; color: string; colorLight: string }

// Cursor colors that read on light and dark backgrounds.
const COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#0d9488', '#9333ea', '#ca8a04']
const COLOR_KEY = 'brain:presence-color'

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS/, 'Firefox'],
  [/Chrome\/|CriOS/, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

function match(userAgent: string, patterns: [RegExp, string][]) {
  return patterns.find(([pattern]) => pattern.test(userAgent))?.[1]
}

/** "Chrome on Mac", from the user agent; as much of it as can be told. */
export function deviceName(userAgent = navigator.userAgent) {
  const browser = match(userAgent, BROWSERS)
  const system = match(userAgent, SYSTEMS)
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? 'Another device'
}

function deviceColor() {
  try {
    const kept = localStorage.getItem(COLOR_KEY)
    if (kept && COLORS.includes(kept)) return kept
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    localStorage.setItem(COLOR_KEY, color)
    return color
  } catch {
    // No storage: a color for this visit.
    return COLORS[0]
  }
}

export function myPresence(): Presence {
  const color = deviceColor()
  return { name: deviceName(), color, colorLight: `${color}33` }
}
