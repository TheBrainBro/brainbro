# AI assistants (MCP)

AI assistants (Claude, ChatGPT, Grok, editors) can read from and write to
your BrainBro through the [Model Context Protocol](https://modelcontextprotocol.io).
They connect to `https://<your host>/api/mcp`, either by signing in to BrainBro
(OAuth) or with a personal API token.

Account menu → *Settings* → *AI assistants* has the URL, the steps for each
app, and the list of connected apps and tokens. For a short description for
AI agents, see [`llms.txt`](https://brainbro.app/llms.txt).

Claude, ChatGPT and Grok connect from their own servers, not from your
computer, so BrainBro must be reachable from the internet over HTTPS (the
Cloudflare Tunnel is). If Cloudflare Access ever sits in front of BrainBro,
bypass it for `/api/mcp`, `/api/auth/oauth/` and `/.well-known/`: the apps
sign in through BrainBro itself.

## Connecting an app

### Claude (web, desktop and mobile)

*Customize* → *Connectors* → *Add custom connector*, paste the URL, *Add*,
then *Connect*: BrainBro opens and asks to allow it. Claude Desktop uses the
same connectors configured in Claude web; add a remote server there rather
than in `claude_desktop_config.json`. Mobile can use a connector already added
on web but cannot add one itself. Custom remote MCP connectors are available
on Pro, Max, Team and Enterprise plans; on Team and Enterprise, an owner must
enable an organization connector first. See [Anthropic's setup
guide](https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp).

### ChatGPT (web)

[chatgpt.com/plugins](https://chatgpt.com/plugins) → *+* → *Add custom MCP
server*: enter a name and the URL, choose OAuth when asked, accept the risk
warning, and create it. ChatGPT then sends you to BrainBro to allow it. Custom
MCP access depends on plan and workspace permissions: full tool support is
available on Business and Enterprise/Edu; Pro can connect with read/fetch
permissions. Connections are made on the web. See [OpenAI's current
guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

### Cursor

In Cursor, open *Settings* → *Tools & MCP* and add a server, or create
`.cursor/mcp.json` in the project. For a remote server, configure BrainBro's
Streamable HTTP URL:

```json
{
  "mcpServers": {
    "brainbro": {
      "url": "https://brainbro.example.com/api/mcp"
    }
  }
}
```

Cursor supports OAuth for remote Streamable HTTP servers. Open the MCP panel
and sign in to BrainBro if prompted. In a team, an admin may control which
connectors are allowed. See [Cursor's MCP guide](https://docs.cursor.com/context/model-context-protocol).

### Gemini CLI

Gemini CLI supports remote MCP servers over Streamable HTTP. Add BrainBro to
`~/.gemini/settings.json` (or the project's `.gemini/settings.json`):

```json
{
  "mcpServers": {
    "brainbro": {
      "httpUrl": "https://brainbro.example.com/api/mcp"
    }
  }
}
```

Start the CLI and use `/mcp` to inspect the connection. If it asks you to
authenticate, use `/mcp auth brainbro` and finish sign-in in the browser.
Gemini CLI documents remote HTTP and OAuth discovery; this setup has not yet
been verified against a live BrainBro server. See [Gemini CLI's MCP
guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

The Gemini consumer app and Gemini Enterprise are not covered here: their
support for connecting to this server's OAuth flow is not confirmed.

### Grok (web)

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

Claude Code supports OAuth for remote HTTP MCP servers. If automatic sign-in
does not start, run `/mcp`, choose *brainbro*, then select *Authenticate*.

### Grok API

The xAI API can call BrainBro from a request with a [remote MCP
tool](https://docs.x.ai/developers/tools/remote-mcp): `server_url` is the URL
and `authorization` a personal token.

### Other MCP clients

Any client that supports remote Streamable HTTP and BrainBro's OAuth discovery
can connect to `https://<your host>/api/mcp`. If it only accepts bearer
headers, create a personal token in *Settings* → *AI assistants* and configure
`Authorization: Bearer <token>` in that client. Keep personal tokens secret:
unlike an OAuth connection, a personal token can access the full REST API as
you. Revoke it from the same settings page when it is no longer needed.

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
   signed in, see the app's name and where it goes back to, choose what it
   can do, and allow it. The logo comes from where it goes back to, never
   from the name, which any app can make up.
4. It swaps the one-time code (PKCE, S256) for a token at
   `/api/auth/oauth/token/`. Tokens last an hour and come with a refresh
   token; refreshing replaces both.

A connected app shows up in the list with your tokens; *Disconnect* stops it
and its refresh token right away. Connected apps can only use the MCP
endpoint, not the rest of the API.

### Permissions

| Permission | Tools |
|---|---|
| Read | Search, get and list items, collections, boards, revisions, public pages, blogs and redirects |
| Capture | `capture`, `import_image` |
| Edit and organize | `edit_note`, `organize`, `archive`, `create_collection`, `add_to_board` |
| Publish | `publish_note`, `unpublish_note`, `update_page`, `create_blog`, `update_blog`, `verify_blog`, `set_redirects` |

Read, Capture and Edit start on and Publish starts off. Editing and publishing
need Read. Change them later from *Settings* → *AI assistants*, without
reconnecting. An app only sees the tools it is allowed, and any other call
fails with a message saying which permission is missing.

They are BrainBro's own: the OAuth scope stays `brainbro` for every app.
Personal tokens have them all, since they can use the whole API.

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
| `publish_note` | Makes a note public, optionally at a slug and with its original date, and returns its address |
| `unpublish_note` | Makes a public note private again |
| `get_page` | A published note's page settings: slug, address, title, description, image |
| `update_page` | Changes some of them, as *Page settings* in the app, and the date it shows |
| `list_blogs` | Every blog: domain, collection, status, categories and the DNS records to add |
| `create_blog` | A new blog on the user's domain, unverified until its records are added |
| `update_blog` | Changes a blog's domain, collection, title, description, author, whether the author shows, links or *Powered by* |
| `verify_blog` | Looks up a blog's TXT record and says how it went |
| `list_blog_posts` | A blog's notes, published (newest first) and drafts, with slug, date and addresses |
| `set_redirects` | Sends old addresses on a blog's domain to new ones (301) |
| `list_redirects` | A blog's redirects |
| `import_image` | Downloads an image from a URL, as if pasted, and returns its `src` for a note |

A note saved without a title still comes back with one, worked out from its
body as the app shows it: its first line, shortened. It
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

Notes say whether they are public: `published_at` (null while private) and,
once published, `public_url`, the whole address, on the server
(`https://<host>/@<handle>/<slug>`) or on the note's blog (see
[public-notes.md](public-notes.md) and [blogs.md](blogs.md)). `listed` is false
while unlisted: readable at its address, but on no list or feed. `publish_note`
and `update_page` take `listed` to change it.

Publishing makes a note readable by anyone. The instructions and the tool
descriptions tell assistants to publish, change a page or set up a blog only
when the user asks for it or agrees, never on their own. The tools go through
the app's own code and checks: only the user's notes, collections and blogs,
the same slug and domain rules, the same link checks. A blog's categories are
the collections inside its own, so `create_collection` with `parent_id` adds
one. `verify_blog` runs the lookup in the worker like the app does: a blog
still `checking` says how it went in `list_blogs` a moment later. A blog
already serving stays `verified` during the lookup, and stops serving only if
DNS answers that its record is gone. A verified blog given a new domain in `update_blog` keeps serving at its current one with
the new one in `pending_domain`, until `verify_blog` finds its records and
moves it; sending its current domain calls that off. No tool deletes or turns
off a blog: that is done in the app.

Moving posts in from another blog: `import_image` downloads each image into
BrainBro as if it had been pasted (`attachments/<id>.<ext>`), and the
assistant writes that `src` in the note in place of the old URL, so nothing
depends on the old site. It downloads during the call, through the same
guarded fetching as link previews, so the assistant knows at once whether it
worked; an image no note links within a week is deleted, like a pasted one.
`publish_note` and `update_page` take `published_at`, the date the post
shows and its blog sorts by, so it keeps its original date; it can't be in
the future. `list_blog_posts` lists what is on a blog, drafts included (notes
filed there but private), to check the move and avoid duplicates. Posts that
keep their old slug on the same domain need nothing else; for those whose
address changed, `set_redirects` answers the old path with a 301 to the new
one once the blog serves the domain. Redirects can't take a published post's
address or the blog's own pages (`/`, `/c/…`, `/rss`, `/api/…`); no tool
removes one, `set_redirects` can point it elsewhere.

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
