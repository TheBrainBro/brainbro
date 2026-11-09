"""
Which logo a connected assistant gets. Never from the name it registers with,
which any app can make up: from the address it goes back to when signing in,
because the sign-in code only ever goes there, so an impostor can't get in
under someone else's address. Empty means the generic icon.
"""

import re

BY_HOST = {
    "claude.ai": "claude",
    "claude.com": "claude",
    "chatgpt.com": "chatgpt",
    "grok.com": "grok",
    "www.cursor.com": "cursor",
}

GROK_BOT = "grokbot"
GROK_BOT_NAME = "Grok Bot"


def host_logo(host):
    return BY_HOST.get(host, "")


def token_logo(token):
    """
    The logo of a connection (an `ApiToken`). Grok Bot connects through
    Cursor's address, so only there is its own word about what it is believed.
    """
    logo = host_logo(token.redirect_host)
    words = re.sub(r"[^a-z]", "", token.client_app.lower())
    return GROK_BOT if logo == "cursor" and GROK_BOT in words else logo
