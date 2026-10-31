# API tokens and MCP

AI assistants (Claude, ChatGPT, editors) can read from and write to your Brain
through the [Model Context Protocol](https://modelcontextprotocol.io). They
connect to `https://<your host>/api/mcp/` with a personal API token.

## API tokens

Account menu → *Settings* → *API tokens*: give the token a name (what it's
for) and *Create token*. The token is shown once; Brain only keeps a hash of
it. The list shows when each token was last used, and *Revoke* stops it right
away.

A token acts as you on the whole API, `Authorization: Bearer <token>`, with
the same access as the app (your data only). It can't create, list or revoke
tokens: that only works signed in to the app. Scripts can use it too:

```sh
curl -H "Authorization: Bearer $BRAIN_TOKEN" https://brain.example.com/api/items/?status=inbox
```

## Connecting an assistant

### Claude Code

The *API tokens* page shows this command, ready to copy, right after creating
a token:

```sh
claude mcp add --transport http brain https://brain.example.com/api/mcp/ \
  --header "Authorization: Bearer brain_..."
```

To share the setup in a project without the token, put it in `.mcp.json` and
keep the token in an environment variable:

```json
{
  "mcpServers": {
    "brain": {
      "type": "http",
      "url": "https://brain.example.com/api/mcp/",
      "headers": { "Authorization": "Bearer ${BRAIN_TOKEN}" }
    }
  }
}
```

### Claude Desktop and claude.ai

*Customize* → *Connectors* → *Add custom connector*: the URL above, no sign
in, and under *Request headers* add `Authorization` with `Bearer <token>`.

Claude connects from Anthropic's servers, not from your computer, so Brain
must be reachable from the internet (the Cloudflare Tunnel is). If Cloudflare
Access ever sits in front of Brain, bypass it for `/api/mcp/`: the token is
the authentication.

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
sessions and no server-sent events, so `GET /api/mcp/` is 405. Only API tokens
are accepted there (not the browser session), and a request with an `Origin`
from another host is refused.
