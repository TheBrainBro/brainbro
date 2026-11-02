# Who made an item, and through what

BrainBro is memory shared by several assistants, so every item says who wrote
it. See `apps/items/origin.py`.

Each item records who created it and who last edited its content (title,
body, a file's name), and through what:

- **Who**: you, or the app: a connected assistant goes by the name it
  registered with when signing in ("Claude", "ChatGPT"), a personal token by
  its own name.
- **Through what**: `web`, `telegram`, `mcp`, `api` (a personal token on the
  REST API) or `import`.

Organizing, archiving, moving and previews fetched in the background are not
edits. Items from before this was recorded are yours, from an unknown source.

## In the app

Cards, tiles and rows show a small robot mark on items an assistant made or
last edited; hovering it says which. The viewer says it in its header:
*Edited by Claude, 2 hours ago*, *Added by ChatGPT, 3 days ago*.

The inbox and the archive filter by who made them: everyone, only mine, any
assistant, or one app. The filter shows up once an app has made something.
A filtered inbox can't be sorted by hand.

## In the API

Items carry `created_by` and `edited_by` (the app's name, empty for you),
`created_via` and `edited_via`, and `edited_at` (null until edited).
`/api/items/` filters with `?origin=mine|assistants` and `?app=<name>`;
`/api/items/apps/` lists the apps that made or edited something.

MCP summaries say it too: `created_by` and `edited_by` are `"user"` or the
app's name, so assistants can tell their notes from yours.
