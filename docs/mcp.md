# AI assistants (MCP)

AI assistants (Claude, ChatGPT, Grok, editors) can read from and write to
your BrainBro through the [Model Context Protocol](https://modelcontextprotocol.io).
They connect to `https://<your host>/api/mcp`, either by signing in to BrainBro
(OAuth) or with a personal API token.

Account menu → *Settings* → *AI assistants* has the URL, the steps for each
app, and the list of connected apps and tokens.

Claude, ChatGPT and Grok connect from their own servers, not from your
computer, so BrainBro must be reachable from the internet over HTTPS (the
Cloudflare Tunnel is). If Cloudflare Access ever sits in front of BrainBro,
bypass it for `/api/mcp`, `/api/auth/oauth/` and `/.well-known/`: the apps
sign in through BrainBro itself.

## Connecting an app

### Claude (web, desktop and mobile)

*Customize* → *Connectors* → *Add custom connector*, paste the URL, *Add*,
then *Connect*: BrainBro opens and asks to allow it. Custom connectors are
available on every plan (one on Free).

### ChatGPT

[chatgpt.com/plugins](https://chatgpt.com/plugins) → *+* → *Add custom MCP
server*: a name, the URL, accept the risk warning and create it. ChatGPT
then sends you to BrainBro to allow it. Which plans can add custom MCP servers
is up to OpenAI.

### Grok

[grok.com/connectors](https://grok.com/connectors) → *New Connector* →
*Custom*, paste the URL and sign in to BrainBro when asked. On Grok Business and
Enterprise, an admin adds the connector first.

### Grok Bot

Ask a Bot in a chat to add an MCP server by URL, giving it the URL, and sign
in to BrainBro if it asks. Bots add servers outside their catalog this way
([docs](https://docs.x.ai/grok-bot/computer-and-apps)); on a team, the Cursor
connector policy decides which ones are allowed.

### Claude Code

```sh
claude mcp add --transport http brainbro https://brainbro.example.com/api/mcp
```

Then `/mcp` in Claude Code, choose *brainbro* and sign in. Or use a personal
token instead:

```sh
claude mcp add --transport http brainbro https://brainbro.example.com/api/mcp \
  --header "Authorization: Bearer brainbro_..."
```

To share the setup in a project without the token, put it in `.mcp.json` and
keep the token in an environment variable:

```json
{
  "mcpServers": {
    "brainbro": {
      "type": "http",
      "url": "https://brainbro.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${BRAINBRO_TOKEN}" }
    }
  }
}
```

### Grok API

The xAI API can call BrainBro from a request with a [remote MCP
tool](https://docs.x.ai/developers/tools/remote-mcp): `server_url` is the URL
and `authorization` a personal token.

## Signing in (OAuth)

See `apps/accounts/oauth.py`. BrainBro is its own authorization server, as the
MCP authorization spec describes:

1. The app calls `/api/mcp` without a token and gets a 401 whose
   `WWW-Authenticate` points at `/.well-known/oauth-protected-resource/api/mcp`.
   That names BrainBro as the authorization server, and
   `/.well-known/oauth-authorization-server` lists its endpoints.
2. The app registers itself (dynamic client registration,
   `/api/auth/oauth/register/`).
3. It opens `/oauth/authorize` in the browser: a page of the app where you,
   signed in, see the app's name and where it goes back to, and allow it.
4. It swaps the one-time code (PKCE, S256) for a token at
   `/api/auth/oauth/token/`. Tokens last an hour and come with a refresh
   token; refreshing replaces both.

A connected app shows up in the list with your tokens; *Disconnect* stops it
and its refresh token right away. Connected apps can only use the MCP
endpoint, not the rest of the API.

## Personal tokens

*Create token* with a name (what it's for). The token is shown once; BrainBro
only keeps a hash of it. It never expires: *Revoke* stops it.

A personal token acts as you on the whole API, `Authorization: Bearer
<token>`, with the same access as the app (your data only). It can't create,
list or revoke tokens: that only works signed in to the app. Scripts can use
it too:

```sh
curl -H "Authorization: Bearer $BRAINBRO_TOKEN" https://brainbro.example.com/api/items/?status=inbox
```

## Tools

See `apps/mcp/tools.py`. Nothing deletes.

| Tool | What it does |
| --- | --- |
| `search_items` | Search by words and by meaning, archived items included |
| `get_item` | One item in full: a note's Markdown and its version |
| `get_items` | Several items in full in one call, saying which ids weren't found |
| `list_inbox` | What is waiting in the inbox, in the order the app shows |
| `list_collections` | Every collection, with its parent and item count |
| `list_collection_items` | A collection's items, in the order you sorted them |
| `create_collection` | A new collection (project, area or resource), optionally inside another |
| `capture` | A new note or link, with a title, in the inbox or straight into a collection |
| `edit_note` | Changes part of a note (replace, prepend, append), or rewrites it |
| `list_revisions` | A note's history: who saved each version, through what, and when |
| `get_revision` | One version of a note in full, as it was then |
| `organize` | Adds items to collections, out of the inbox |
| `archive` | Takes items out of the way, without deleting them |
| `list_boards` | Every board, with how many items are on it |
| `get_board` | A board's items, sticky notes and groups, in reading order, without the layout |
| `add_to_board` | Puts items on a board, where the app puts new cards |

A note saved without a title still comes back with one, worked out from its
body as the app shows it: its first H1, or else its first line, shortened. It
follows the note as it changes, and is never saved.

`edit_note` takes the version `get_item` returned: if you edited the note in
the app since, the assistant's edit is refused and it has to read it again,
so it never overwrites your changes. Partial edits leave the rest of the note
as it was: each `replace` must match exactly once, and if one doesn't,
nothing is saved. On a note open in the app, the edit merges into it live,
with the assistant's name and cursor on what it wrote (see
[live-editing.md](live-editing.md)).

Every item says who made it and who last edited it, `"user"` or the
assistant's name, and through what (see [origin.md](origin.md)), so
assistants can tell their notes from yours.

Every edit lands in the note's history (see [history.md](history.md)):
assistants can read it with `list_revisions` and `get_revision`, and only you
restore a version, in the app.

`add_to_board` saves the board like the app does (its revision goes up), so a
tab with the board open gets the usual conflict on its next save. Assistants
can't move cards, connect them or edit the layout.

The server's instructions (`apps/mcp/server.py`) and the tool descriptions
are what every assistant reads in every conversation: they say when to use
each tool, and failed calls say what to do next.

Search results are candidates. Semantic search deliberately favors recall and
can include loose matches; assistants are told to ignore irrelevant ones and
never mention unrelated items. This matters because a BrainBro can contain
private material that has nothing to do with the current request.

## Client validation

After changing the instructions or tool descriptions, test them through a real
client, not only with JSON-RPC tests. Use disposable notes or a local MCP probe,
and check at least these behaviors:

1. "Save this" searches first, gives a new note a title and source, and leaves
   it in the inbox.
2. New information about an existing note calls `get_item`, then `edit_note`
   with that version and a partial edit; it does not capture a duplicate.
3. A broad search does not make the assistant mention unrelated results.
4. Sorting, archiving and board placement happen only when explicitly asked.
5. A stale version or unknown id makes the assistant follow the recovery step
   in the tool error instead of claiming that the change was saved.

The v0.7.0 instructions were exercised with Claude Code 2.1.316 against the
Streamable HTTP endpoint on 2026-11-02. It followed
`search_items` → `get_item` → `edit_note`, passed the note version, used
`replace`, and left the note in the inbox. That run also exposed the need for
the unrelated-search-result rule above. ChatGPT and Cursor still require an
interactive account with custom MCP access for the same end-to-end check; the
protocol and schemas remain covered by the automated suite in the meantime.

## How it works

`apps/mcp/views.py` speaks the Streamable HTTP transport, stateless: each POST
is one JSON-RPC message and requests get a plain JSON response. There are no
sessions and no server-sent events, so `GET /api/mcp` is 405. Only tokens are
accepted there (not the browser session), and a request with an `Origin` from
another host is refused. `/api/mcp/` works too.
