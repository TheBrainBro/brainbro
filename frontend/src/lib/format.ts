const units = ['B', 'KB', 'MB', 'GB']

/** 1536 -> "1.5 KB", binary multiples like the server limit. */
export function formatBytes(bytes: number) {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  // 1023.8 MB rounds to 1024 MB: that reads as 1 GB.
  if (rounded >= 1024 && unit < units.length - 1) return `1 ${units[unit + 1]}`
  return `${rounded} ${units[unit]}`
}
