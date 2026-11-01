# Landing page

The public page that explains Brain: `site/`. Plain HTML, CSS and JavaScript,
with no build step and no dependencies, so any static host can serve the
folder as is. Open `site/index.html` in a browser to see it (classic scripts,
not modules, so it works from `file://` too).

- `index.html`: the content, top to bottom: the hero, three animated scenes,
  the feature tiles, use cases, connecting an assistant (a tab per app),
  installing, and the footer. Icons (Lucide shapes) and logos are inline
  SVG symbols at the top.
- `styles.css`: the app's colors (zinc and the logo's violet), light and dark
  from the system setting, one column on phones.
- `js/stage.js`: what the scenes share (below).
- `js/hero.js`: the liquid marble behind the hero and the footer (a WebGL
  shader, with a CSS gradient when WebGL is missing) and the brain of linked
  dots in front (canvas 2D), which leans toward the pointer.
- `js/scenes.js`: the three scenes, the animated tiles, the use cases, and
  the glow on the Connect and Install titles when they come into view.
- `js/connect.js`: the tabs, the visitor's Brain address (filled into the
  prompt, the MCP URL and the Claude Code command, and remembered in the
  browser), and the copy buttons.

## Scenes

- **Drop anything**: phone, browser, AI assistant and Telegram send items
  into the inbox along dashed lines. It plays on its own; tapping a source
  sends one from it.
- **Shared memory for every assistant**: Claude saves a note, Grok edits it,
  ChatGPT finds it, each along its line to Brain, with the chat beside it.
- **Who wrote what**: you and ChatGPT type into a note, the history fills
  up, and a pointer clicks your version and *Restore* (each click leaves a
  ring and presses what it hit).

The tiles animate the same way: cards dropped on a board with an arrow and a
pen stroke, a graph growing link by link, Markdown typed and rendered line by
line, a vault crossing into Brain and back out. The search tile shows ⌘K on
Apple devices and Ctrl+K elsewhere.

**Use cases** (trip, research, renovation, writing) light up their four
steps one by one and move to the next case on their own, until the visitor
picks one.

`Stage.loop(el, { reset, script })` plays a scene while it is on screen:
`reset()` puts it back to its start and `script(run)` awaits the steps
(`run.wait`, `run.type`, `run.send` for a dot along a line, `run.point` and
`run.click` for the pointer). Leaving the screen stops the script at its next
await. Before playing, the script also runs once instantly to measure the
stage at every step; the stage keeps the tallest height, so the page doesn't
move while it plays (measured again when the width changes).
`Stage.links(stage)` draws the dashed lines between `[data-node]`
elements, from the `path[data-from][data-to]` in the stage's `svg.links`, and
redraws them when the stage changes size.

With reduced motion nothing moves: the hero draws one frame, each scene shows
its last frame and the inbox starts with one item per source.

## Content

The scenes and tiles follow one trip to Lisbon. Connecting steps come from
[mcp.md](mcp.md); keep them in step when an app changes its menus. The logos
come from LobeHub icons (Claude, OpenAI, Grok; MIT) and Simple Icons
(Obsidian, Telegram, Docker, Umbrel; CC0).

The prompt and the install links point to the docs on GitHub (`main`):
[mcp.md](mcp.md) for connecting assistants and
[deployment.md](deployment.md) for installing.
