# AI assistants (MCP)

AI assistants (Claude, ChatGPT, Grok, editors) can read from and write to
your Brain through the [Model Context Protocol](https://modelcontextprotocol.io).
They connect to `https://<your host>/api/mcp`, either by signing in to Brain
(OAuth) or with a personal API token.

Account menu → *Settings* → *AI assistants* has the URL, the steps for each
app, and the list of connected apps and tokens.

Claude, ChatGPT and Grok connect from their own servers, not from your
computer, so Brain must be reachable from the internet over HTTPS (the
Cloudflare Tunnel is). If Cloudflare Access ever sits in front of Brain,
bypass it for `/api/mcp`, `/api/auth/oauth/` and `/.well-known/`: the apps
sign in through Brain itself.

## Connecting an app

### Claude (web, desktop and mobile)

*Customize* → *Connectors* → *Add custom connector*, paste the URL, *Add*,
then *Connect*: Brain opens and asks to allow it. Custom connectors are
available on every plan (one on Free).

### ChatGPT

[chatgpt.com/plugins](https://chatgpt.com/plugins) → *+* → *Add custom MCP
server*: a name, the URL, accept the risk warning and create it. ChatGPT
then sends you to Brain to allow it. Which plans can add custom MCP servers
is up to OpenAI.

### Grok

[grok.com/connectors](https://grok.com/connectors) → *New Connector* →
*Custom*, paste the URL and sign in to Brain when asked. On Grok Business and
Enterprise, an admin adds the connector first.

### Claude Code

```sh
claude mcp add --transport http brain https://brain.example.com/api/mcp
```

Then `/mcp` in Claude Code, choose *brain* and sign in. Or use a personal
token instead:

```sh
claude mcp add --transport http brain https://brain.example.com/api/mcp \
  --header "Authorization: Bearer brain_..."
```

To share the setup in a project without the token, put it in `.mcp.json` and
keep the token in an environment variable:

```json
{
  "mcpServers": {
    "brain": {
      "type": "http",
      "url": "https://brain.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${BRAIN_TOKEN}" }
    }
  }
}
```

### Grok API

The xAI API can call Brain from a request with a [remote MCP
tool](https://docs.x.ai/developers/tools/remote-mcp): `server_url` is the URL
and `authorization` a personal token.

## Signing in (OAuth)

See `apps/accounts/oauth.py`. Brain is its own authorization server, as the
MCP authorization spec describes:

1. The app calls `/api/mcp` without a token and gets a 401 whose
   `WWW-Authenticate` points at `/.well-known/oauth-protected-resource/api/mcp`.
   That names Brain as the authorization server, and
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

*Create token* with a name (what it's for). The token is shown once; Brain
only keeps a hash of it. It never expires: *Revoke* stops it.

A personal token acts as you on the whole API, `Authorization: Bearer
<token>`, with the same access as the app (your data only). It can't create,
list or revoke tokens: that only works signed in to the app. Scripts can use
it too:

```sh
curl -H "Authorization: Bearer $BRAIN_TOKEN" https://brain.example.com/api/items/?status=inbox
```

## Tools

See `apps/mcp/tools.py`. Nothing deletes.

| Tool | What it does |
| --- | --- |
| `search_items` | Full-text search, archived items included |
| `get_item` | One item in full: a note's Markdown and its version |
| `list_collections` | Every collection, with its parent and item count |
| `list_collection_items` | A collection's items, in the order you sorted them |
| `capture` | A new note or link, in the inbox or straight into a collection |
| `edit_note` | Replaces a note's title or body |
| `organize` | Adds items to collections, out of the inbox |
| `archive` | Takes items out of the way, without deleting them |

`edit_note` takes the version `get_item` returned: if you edited the note in
the app since, the assistant's edit is refused and it has to read it again,
so it never overwrites your changes.

## How it works

`apps/mcp/views.py` speaks the Streamable HTTP transport, stateless: each POST
is one JSON-RPC message and requests get a plain JSON response. There are no
sessions and no server-sent events, so `GET /api/mcp` is 405. Only tokens are
accepted there (not the browser session), and a request with an `Origin` from
another host is refused. `/api/mcp/` works too.
