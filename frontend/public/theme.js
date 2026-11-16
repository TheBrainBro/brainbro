// The theme picked in settings (theme/theme.ts), before the first paint. A
// file, not inline in index.html: the Content Security Policy only runs ours.
try {
  const theme = localStorage.getItem('brainbro:theme')
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme
    const bar = theme === 'dark' ? '#141218' : '#ffffff'
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => (meta.content = bar))
  }
} catch {}
