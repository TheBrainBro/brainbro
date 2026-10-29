// The markdown-it plugins ship without type declarations.

declare module 'markdown-it-abbr' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}

declare module 'markdown-it-container' {
  import type { PluginWithParams } from 'markdown-it'
  const plugin: PluginWithParams
  export default plugin
}

declare module 'markdown-it-deflist' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}

declare module 'markdown-it-emoji' {
  import type { PluginWithOptions } from 'markdown-it'
  export const full: PluginWithOptions
}

declare module 'markdown-it-emoji/lib/data/full.mjs' {
  /** Emoji by name: `{ wink: '😉' }`. */
  const emoji: Record<string, string>
  export default emoji
}

declare module 'markdown-it-emoji/lib/data/shortcuts.mjs' {
  /** Emoticons by emoji name: `{ smiley: [':)', ':-)'] }`. */
  const shortcuts: Record<string, string[]>
  export default shortcuts
}

declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}

declare module 'markdown-it-ins' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}

declare module 'markdown-it-mark' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}

declare module 'markdown-it-sub' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}

declare module 'markdown-it-sup' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}
