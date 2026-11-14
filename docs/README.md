# Documentation

What each page covers. Feature pages start with how the feature works for you and end with its
API and how it is built, for whoever works on the code.

## Running your server

| Page | What it covers |
|---|---|
| [Deployment](deployment.md) | Installing, the three ways to reach it (Cloudflare Tunnel, Caddy, local network), every setting, rate limits, upgrading, Umbrel |
| [Backups](backups.md) | The daily database dumps, manual backups and restoring |
| [Install on a phone](pwa.md) | Installing the app on Android and iOS, and the share sheet |
| [Telegram bot](telegram.md) | Setting up a bot that sends what you forward it to the inbox |

## Using BrainBro

**Capture and view**

| Page | What it covers |
|---|---|
| [Viewing items](viewer.md) | The full-screen viewer, for each kind of item |
| [Albums](albums.md) | Several images kept as one item |
| [Audio](audio.md) | Recordings and voice notes, and their player |
| [Images in notes](note-images.md) | How a note's images are stored and shown, pasted or from the web |

**Notes**

| Page | What it covers |
|---|---|
| [Links between notes](wikilinks.md) | `[[Title]]` links, and which note they find |
| [Live note editing](live-editing.md) | One note edited from several devices and assistants at once |
| [Version history](history.md) | What changed in a note or a board, and going back |

**Organize and find**

| Page | What it covers |
|---|---|
| [Boards](boards.md) | Infinite canvases: cards, sticky notes, drawing, groups and connections |
| [Graph](graph.md) | Everything as a graph of what ties it together |
| [Search](search.md) | Searching by words and by meaning |

**AI assistants**

| Page | What it covers |
|---|---|
| [AI assistants (MCP)](mcp.md) | Connecting Claude, ChatGPT and others, their permissions and tools |
| [Who made an item](origin.md) | How items say whether you or an assistant made or edited them |

**Publishing**

| Page | What it covers |
|---|---|
| [Public notes](public-notes.md) | Publishing a note as a page anyone can read |
| [Blogs on your own domain](blogs.md) | A collection as a blog on a domain of yours, and its DNS |

**Your data and settings**

| Page | What it covers |
|---|---|
| [Import from Obsidian](import.md) | Bringing in an Obsidian vault |
| [Export](export.md) | Everything you have, as Markdown and files |
| [Translations](translations.md) | Choosing the language, and adding a new one |

## Working on the code

- [CONTRIBUTING.md](../CONTRIBUTING.md): development setup, tests and checks, commits and pull
  requests, the CLA.
- [Maintaining](maintaining.md): the issue workflow and how a release is made.
- The format of an export: [`backend/apps/exports/README.md`](../backend/apps/exports/README.md),
  copied into every export.
- [SECURITY.md](../SECURITY.md): reporting a vulnerability.
