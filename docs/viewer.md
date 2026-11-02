# Viewing items

Items open full screen inside the app instead of in a new tab: from the inbox and collections
(click an image, a file's name or preview, or a link's picture; Enter on the focused card), and
from a board (double-click a card, or *Open*). The arrows, or ← and →, step through the list or
board it was opened from; Esc, the ✕ or a click outside closes it. While it is open the page's
own shortcuts are off.

| Item | Shown as |
| --- | --- |
| Image, SVG | The original at full size, fitted to the screen. A click (or the zoom buttons) goes to 100% and up to 400%, scrolling to pan. |
| Album | Its images one at a time over a strip of all of them. ← and → go through them before moving on to the next item. See [Albums](albums.md). |
| PDF | The browser's own PDF viewer. |
| Text, JSON, XML, YAML up to 512 KB | The text as it is. |
| Audio, video | A player. Recordings can be renamed and captioned, like images. See [Audio](audio.md). |
| Link | Its preview: picture, title, description and site, with *Open original*. |
| Note | Its Markdown, with *Edit* to open the editor. |
| Anything else | A download. |

Uploaded files are always served as downloads (`Content-Disposition: attachment`, with a
sandboxing CSP), so nothing uploaded can run as a page on BrainBro's origin. The viewer fetches a
PDF or a text file itself and shows it from memory (a `blob:` URL, or plain text), which leaves
that rule as it is. Images, audio and video load straight from the file URL, as media; players
ask for it in parts (HTTP `Range`), which Safari needs to play anything and every browser
needs to seek.
