"""
JSON-RPC methods of the MCP server: the handshake, `ping` and the tools.

Tool failures the assistant can fix (a wrong id, a missing argument) come
back as a tool result with `isError`, so the model reads them and retries;
only protocol mistakes (an unknown method or tool) are JSON-RPC errors.
"""

import json
import logging

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder

from .tools import TOOLS, ToolError

logger = logging.getLogger(__name__)

# Newest first: a client asking for one we don't know gets the newest.
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# What every client gets in every conversation: how to use BrainBro well.
INSTRUCTIONS = """\
BrainBro is the user's second brain: their notes (Markdown), links, images,
recordings and files, and a memory they share across assistants. What you
save here, other assistants and the user will read later, out of this
conversation: write it so it stands on its own.

How it is organized: everything new lands in the inbox, and sorting it is a
later step the user owns. Collections nest, and follow PARA: project (a goal
with an end), area (an ongoing responsibility), resource (a topic). Boards
are canvases where items are laid out in space.

- Search before capturing. If a note on the same thing exists, update it
  with edit_note instead of saving a duplicate.
- Search results are candidates, not proof that an item is relevant. Ignore
  loose matches, and do not mention or reveal unrelated items to the user.
- Give every note a short, specific title.
- Say where things came from: the URL, or that it came from a conversation
  with you, and when it matters, the date.
- Prefer partial edits (replace, append, prepend) over rewriting a whole
  note, and pass the version from get_item so you never overwrite the user.
- Items say who made and last edited them (created_by, edited_by): "user",
  or an assistant's name. Take extra care changing what the user wrote.
- Every edit to a note is kept in its history (list_revisions), and the
  user can bring back what was there before.
- Leave what you capture in the inbox. Organize, archive, add to boards or
  create collections only when the user asks for it.
- Read in batches: get_items for several items, list_inbox and
  list_collection_items with limit and offset.
- Publishing makes a note readable by anyone on the internet. Publish,
  change a public page or set up a blog only when the user asks for it or
  agrees, never on your own. Items say whether they are public
  (published_at, public_url).
- Nothing here deletes: archive keeps an item but takes it out of the way.
- A failed call says what went wrong and what to do; nothing was saved."""


def handle(user, message):
    """The JSON-RPC response to a request (`message` has an id and a method)."""
    params = message.get("params") or {}
    method = METHODS.get(message["method"])
    if method is None:
        return error(message["id"], METHOD_NOT_FOUND, "Method not found.")
    if not isinstance(params, dict):
        return error(message["id"], INVALID_PARAMS, "Params must be an object.")
    try:
        result = method(user, params)
    except UnknownTool as unknown:
        return error(message["id"], INVALID_PARAMS, f"Unknown tool: {unknown}")
    except Exception:
        logger.exception("MCP %s failed", message["method"])
        return error(message["id"], INTERNAL_ERROR, "Internal error.")
    return {"jsonrpc": "2.0", "id": message["id"], "result": result}


def error(request_id, code, text):
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": text},
    }


class UnknownTool(LookupError):
    pass


def initialize(user, params):
    requested = params.get("protocolVersion")
    version = requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
    return {
        "protocolVersion": version,
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": {"name": "brainbro", "title": settings.APP_NAME, "version": "1"},
        "instructions": INSTRUCTIONS,
    }


def ping(user, params):
    return {}


def list_tools(user, params):
    return {"tools": [tool.definition() for tool in TOOLS.values()]}


def call_tool(user, params):
    tool = TOOLS.get(params.get("name"))
    if tool is None:
        raise UnknownTool(params.get("name"))
    arguments = params.get("arguments") or {}
    try:
        if not isinstance(arguments, dict):
            raise ToolError("Arguments must be an object.")
        result = tool.run(user, arguments)
    except ToolError as failure:
        return {"content": [{"type": "text", "text": str(failure)}], "isError": True}
    # Ids and ISO dates as strings, the same in both copies.
    text = json.dumps(result, cls=DjangoJSONEncoder)
    return {
        # Older clients only read the text; newer ones the structured copy.
        "content": [{"type": "text", "text": text}],
        "structuredContent": json.loads(text),
        "isError": False,
    }


METHODS = {
    "initialize": initialize,
    "ping": ping,
    "tools/list": list_tools,
    "tools/call": call_tool,
}
