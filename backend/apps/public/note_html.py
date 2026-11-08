"""
A published note's Markdown as HTML, for the pages a blog serves itself. The
same dialect as the app (`frontend/src/lib/markdown.ts`), read the way a
public page reads it; `tests/markdown_cases.json` runs on both sides, so they
can't drift apart.
"""

import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

import nh3
from markdown_it import MarkdownIt
from markdown_it.common.utils import escapeHtml
from markdown_it.rules_inline.state_inline import Delimiter
from markdown_it.token import Token
from mdit_py_plugins.container import container_plugin
from mdit_py_plugins.deflist import deflist_plugin
from mdit_py_plugins.footnote import footnote_plugin
from mdit_py_plugins.subscript import sub_plugin
from mdit_py_plugins.superscript import superscript_plugin

from apps.items.titles import note_title, wikilink_target

# `::: name` blocks the notes understand; anything else stays text.
CONTAINERS = ("note", "info", "tip", "warning", "danger")
# markdown-it-emoji's names and emoticons, as the app has them.
_emoji = json.loads((Path(__file__).parent / "emoji.json").read_text())
EMOJI = _emoji["defs"]
SHORTCUTS = {
    alias: name
    for name, aliases in _emoji["shortcuts"].items()
    for alias in aliases
    if name in EMOJI
}
EMOJI_RE = re.compile(
    "|".join(
        re.escape(name)
        for name in sorted([*(f":{name}:" for name in EMOJI), *SHORTCUTS], reverse=True)
    )
)
ABBR_STOPS = set(" \r\n$+<=>^`|~")
WIKILINK = re.compile(r"(?<!!)\[\[([^\]|#\n]+)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]")
TASK = re.compile(r"\[([ xX])\][ \t]")
# The first line, written as a heading or not.
FIRST_LINE = re.compile(r"\s*([^\n]*?)\s*#*\s*(?:\n|\Z)")

PROVIDERS = (
    (
        re.compile(
            r"https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)"
            r"|youtu\.be/)([\w-]{11})",
            re.ASCII,
        ),
        # The privacy-enhanced player: no cookies until it plays.
        "https://www.youtube-nocookie.com/embed/{}",
    ),
    (
        re.compile(r"https?://(?:www\.)?vimeo\.com/(?:video/)?(\d+)", re.ASCII),
        "https://player.vimeo.com/video/{}",
    ),
    (
        re.compile(r"https?://(?:www\.)?loom\.com/(?:share|embed)/([0-9a-f]{32})"),
        "https://www.loom.com/embed/{}",
    ),
)
EMBED_ORIGINS = (
    "https://www.youtube-nocookie.com/",
    "https://player.vimeo.com/",
    "https://www.loom.com/embed/",
)

ALLOWED_TAGS = {
    "a",
    "abbr",
    "blockquote",
    "br",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "iframe",
    "img",
    "input",
    "ins",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "s",
    "section",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
}
ALLOWED_ATTRIBUTES = {
    "*": {"class", "id"},
    "a": {"href", "title", "target", "rel", "data-status"},
    "abbr": {"title"},
    "iframe": {
        "src",
        "title",
        "loading",
        "allow",
        "allowfullscreen",
        "referrerpolicy",
    },
    "img": {"src", "alt", "title", "loading"},
    "input": {"type", "checked", "disabled", "aria-label", "data-task-line"},
    "ol": {"start"},
    "span": {"title", "data-status"},
    "td": {"style"},
    "th": {"style"},
}


def is_boundary(char):
    """A space, punctuation or a control character: where a word can't go on."""
    category = unicodedata.category(char)
    return category[0] in "PZ" or category == "Cc"


def split_emoji(text):
    """`text` as text and emoji tokens; None without any emoji in it."""
    nodes, last = [], 0
    for match in EMOJI_RE.finditer(text):
        start, end = match.span()
        name = SHORTCUTS.get(match[0])
        if name:
            # No letters around an emoticon (as in the ":/" of http://).
            if start > 0 and not is_boundary(text[start - 1]):
                continue
            if end < len(text) and not is_boundary(text[end]):
                continue
        else:
            name = match[0][1:-1]
        if start > last:
            nodes.append(Token("text", "", 0, content=text[last:start]))
        nodes.append(Token("emoji", "", 0, content=EMOJI[name], markup=name))
        last = end
    if not nodes:
        return None
    if last < len(text):
        nodes.append(Token("text", "", 0, content=text[last:]))
    return nodes


def replace_emoji(state):
    for block in state.tokens:
        if block.type != "inline":
            continue
        children = block.children
        autolinks = 0
        # From the end, so positions hold as tokens are added.
        for i in range(len(children) - 1, -1, -1):
            token = children[i]
            if token.type in ("link_open", "link_close") and token.info == "auto":
                autolinks -= token.nesting
            if token.type == "text" and autolinks == 0:
                nodes = split_emoji(token.content)
                if nodes:
                    children[i : i + 1] = nodes


def tokenize_pair(state, silent, char):
    """Each doubled marker as a text token, in the delimiter list."""
    if silent or state.src[state.pos] != char:
        return False
    scanned = state.scanDelims(state.pos, True)
    length = scanned.length
    if length < 2:
        return False
    if length % 2:
        state.push("text", "", 0).content = char
        length -= 1
    for _ in range(0, length, 2):
        state.push("text", "", 0).content = char * 2
        if scanned.can_open or scanned.can_close:
            state.delimiters.append(
                Delimiter(
                    marker=ord(char),
                    length=0,
                    token=len(state.tokens) - 1,
                    end=-1,
                    open=scanned.can_open,
                    close=scanned.can_close,
                )
            )
    state.pos += scanned.length
    return True


def set_pair_token(token, name, tag, char, nesting):
    token.type = f"{name}_{'open' if nesting == 1 else 'close'}"
    token.tag = tag
    token.nesting = nesting
    token.markup = char * 2
    token.content = ""


def move_lone_marker(tokens, i, closing_type):
    """An odd run leaves one marker first: it goes after the closing tags."""
    j = i + 1
    while j < len(tokens) and tokens[j].type == closing_type:
        j += 1
    j -= 1
    if i != j:
        tokens[i], tokens[j] = tokens[j], tokens[i]


def close_pairs(state, delimiters, name, tag, char):
    """The text tokens of each matched pair of markers, as tags."""
    lone = []
    for delimiter in delimiters:
        if delimiter.marker != ord(char) or delimiter.end == -1:
            continue
        closing = delimiters[delimiter.end]
        set_pair_token(state.tokens[delimiter.token], name, tag, char, 1)
        set_pair_token(state.tokens[closing.token], name, tag, char, -1)
        before = state.tokens[closing.token - 1]
        if before.type == "text" and before.content == char:
            lone.append(closing.token - 1)
    for i in reversed(lone):
        move_lone_marker(state.tokens, i, f"{name}_close")


def pair_plugin(md, name, char, tag):
    """`==mark==` and `++ins++`: a doubled marker around inline text."""

    def close_all(state):
        close_pairs(state, state.delimiters, name, tag, char)
        for meta in state.tokens_meta:
            if meta and "delimiters" in meta:
                close_pairs(state, meta["delimiters"], name, tag, char)

    md.inline.ruler.before(
        "emphasis", name, lambda state, silent: tokenize_pair(state, silent, char)
    )
    md.inline.ruler2.before("emphasis", name, close_all)


def abbr_definition(state, start_line, end_line, silent):
    """`*[HTML]: Hyper Text Markup Language`."""
    pos = state.bMarks[start_line] + state.tShift[start_line]
    end = state.eMarks[start_line]
    if pos + 2 >= end or state.src[pos : pos + 2] != "*[":
        return False
    pos += 2
    label_start, label_end = pos, None
    while pos < end:
        char = state.src[pos]
        if char == "[":
            return False
        if char == "]":
            label_end = pos
            break
        if char == "\\":
            pos += 1
        pos += 1
    if label_end is None or state.src[label_end + 1 : label_end + 2] != ":":
        return False
    if silent:
        return True
    label = re.sub(r"\\(.)", r"\1", state.src[label_start:label_end])
    title = state.src[label_end + 2 : end].strip()
    if not label or not title:
        return False
    state.env.setdefault("abbreviations", {}).setdefault(label, title)
    state.line = start_line + 1
    return True


def is_abbr_edge(char):
    return unicodedata.category(char)[0] in "PZ" or char in ABBR_STOPS


def abbr_at(text, pos, labels):
    """The abbreviation that starts at `pos`, as a whole word, if any."""
    if pos > 0 and not is_abbr_edge(text[pos - 1]):
        return None
    for label in labels:
        end = pos + len(label)
        if text.startswith(label, pos) and (
            end == len(text) or is_abbr_edge(text[end])
        ):
            return label
    return None


def split_abbreviations(text, titles, labels):
    nodes, last, pos = [], 0, 0
    while pos < len(text):
        label = abbr_at(text, pos, labels)
        if label is None:
            pos += 1
            continue
        if pos > last:
            nodes.append(Token("text", "", 0, content=text[last:pos]))
        nodes.append(Token("abbr_open", "abbr", 1, attrs={"title": titles[label]}))
        nodes.append(Token("text", "", 0, content=label))
        nodes.append(Token("abbr_close", "abbr", -1))
        last = pos + len(label)
        # What ends a word can't also start the next one's match here.
        pos = last + 1
    if nodes and last < len(text):
        nodes.append(Token("text", "", 0, content=text[last:]))
    return nodes


def replace_abbreviations(state):
    titles = state.env.get("abbreviations")
    if not titles:
        return
    labels = sorted(titles, key=len, reverse=True)
    for block in state.tokens:
        if block.type != "inline":
            continue
        children = block.children
        for i in range(len(children) - 1, -1, -1):
            if children[i].type == "text":
                nodes = split_abbreviations(children[i].content, titles, labels)
                if nodes:
                    children[i : i + 1] = nodes


def wikilink_rule(state, silent):
    """`[[Title]]`, `[[Title|text]]`, `[[Title#heading]]`; `![[…]]` isn't a link."""
    pos = state.pos
    if state.src[pos : pos + 2] != "[[" or (pos > 0 and state.src[pos - 1] == "!"):
        return False
    match = WIKILINK.match(state.src, pos)
    if not match:
        return False
    if not silent:
        state.push("wikilink", "", 0).meta = {
            "target": match[1],
            "heading": match[2],
            "text": match[3],
        }
    state.pos = match.end()
    return True


def wikilink_label(link):
    """What a link reads as: its text, or else the title and heading it points to."""
    if link["text"] and link["text"].strip():
        return link["text"].strip()
    target = link["target"].strip()
    heading = (link["heading"] or "").strip()
    return f"{target} › {heading}" if heading else target


def task_lists(state):
    """`- [ ] text` gets a checkbox."""
    tokens = state.tokens
    for i in range(2, len(tokens)):
        item, inline = tokens[i - 2], tokens[i]
        if inline.type != "inline" or tokens[i - 1].type != "paragraph_open":
            continue
        if item.type != "list_item_open" or not item.map:
            continue
        match = TASK.match(inline.content)
        first = inline.children[0] if inline.children else None
        if (
            not match
            or first is None
            or first.type != "text"
            or not first.content.startswith(match[0])
        ):
            continue
        first.content = first.content[len(match[0]) :]
        inline.children.insert(
            0,
            Token(
                "task_checkbox",
                "input",
                0,
                meta={"checked": match[1] != " ", "line": item.map[0]},
            ),
        )
        item.attrJoin("class", "task-list-item")


def link_previews(state):
    """A paragraph that is only a `[text](url "card")` or `"embed"` link."""
    tokens = state.tokens
    for i in range(1, len(tokens) - 1):
        inline = tokens[i]
        if inline.type != "inline" or tokens[i - 1].type != "paragraph_open":
            continue
        children = inline.children or []
        if not children:
            continue
        opening, closing = children[0], children[-1]
        if opening.type != "link_open" or closing.type != "link_close":
            continue
        label = children[1:-1]
        if any(child.type != "text" for child in label):
            continue
        view = opening.attrGet("title")
        href = str(opening.attrGet("href") or "")
        if view not in ("card", "embed") or not re.match(
            r"https?://", href, re.IGNORECASE
        ):
            continue
        inline.children = [
            Token(
                "link_preview",
                "",
                0,
                meta={
                    "href": href,
                    "view": view,
                    "label": "".join(child.content for child in label),
                },
            )
        ]
        tokens[i - 1].hidden = tokens[i + 1].hidden = True


def embed_src(url):
    """Where `url` can play inside the note, or None."""
    for pattern, src in PROVIDERS:
        if match := pattern.match(url):
            return src.format(match[1])
    return None


def hostname(url):
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return url
    return host.removeprefix("www.") if host else url


def link_card(url, label, preview, messages):
    """A card: title, description and site, with the stored image."""
    preview = preview or {}
    status = preview.get("status") or "pending"
    title = preview.get("title") or (label if label and label != url else url)
    pending = messages["markdown"]["fetchingPreview"] if status == "pending" else ""
    description = preview.get("description") or pending
    site = preview.get("site_name") or hostname(url)
    image = preview.get("image_url")
    return (
        f'<a class="link-card" data-status="{escapeHtml(status)}" '
        f'href="{escapeHtml(url)}" target="_blank" rel="noopener noreferrer">'
        '<span class="link-card-text">'
        f'<span class="link-card-title">{escapeHtml(title)}</span>'
        + (
            f'<span class="link-card-description">{escapeHtml(description)}</span>'
            if description
            else ""
        )
        + f'<span class="link-card-site">{escapeHtml(site)}</span>'
        "</span>"
        + (
            '<img class="link-card-image" '
            f'src="{escapeHtml(image)}" alt="" loading="lazy">'
            if image
            else ""
        )
        + "</a>"
    )


def link_embed(url, label, preview, messages):
    """The site's own player, for links that have one; a card for the rest."""
    src = embed_src(url)
    if not src:
        return link_card(url, label, preview, messages)
    title = (preview or {}).get("title") or label or url
    return (
        f'<span class="link-embed"><iframe src="{escapeHtml(src)}" '
        f'title="{escapeHtml(title)}" loading="lazy" '
        'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" '
        "allowfullscreen "
        'referrerpolicy="strict-origin-when-cross-origin"></iframe></span>'
    )


def render_link_open(self, tokens, idx, options, env):
    # Links leave the blog.
    tokens[idx].attrSet("target", "_blank")
    tokens[idx].attrSet("rel", "noopener noreferrer")
    return self.renderToken(tokens, idx, options, env)


def render_emoji(self, tokens, idx, options, env):
    return tokens[idx].content


def render_wikilink(self, tokens, idx, options, env):
    # Only other public notes are links; the rest is just words.
    link = tokens[idx].meta
    label = escapeHtml(wikilink_label(link))
    url = env["notes"].get(wikilink_target(link["target"]).lower())
    return f'<a class="wikilink" href="{escapeHtml(url)}">{label}</a>' if url else label


def render_image(self, tokens, idx, options, env):
    # Never loaded from where the Markdown points: the stored copy, or its alt text.
    token = tokens[idx]
    alt = escapeHtml("".join(child.content for child in token.children or []))
    stored = env["images"].get(token.attrGet("src") or "")
    if stored and stored.get("url"):
        url = escapeHtml(stored["url"])
        return f'<img class="markdown-img" src="{url}" alt="{alt}" loading="lazy">'
    status = f' data-status="{escapeHtml(stored["status"])}"' if stored else ""
    failed = stored and stored["status"] == "failed"
    title = f' title="{env["messages"]["markdown"]["imageFailed"]}"' if failed else ""
    return f'<span class="markdown-image"{status}{title}>{alt or "image"}</span>'


def render_task_checkbox(self, tokens, idx, options, env):
    meta = tokens[idx].meta
    key = "taskDone" if meta["checked"] else "taskToDo"
    label = env["messages"]["markdown"][key]
    checked = " checked" if meta["checked"] else ""
    return (
        f'<input type="checkbox" data-task-line="{meta["line"]}" '
        f'aria-label="{label}"{checked} disabled>'
    )


def render_link_preview(self, tokens, idx, options, env):
    meta = tokens[idx].meta
    show = link_embed if meta["view"] == "embed" else link_card
    return show(
        meta["href"], meta["label"], env["links"].get(meta["href"]), env["messages"]
    )


def build_markdown():
    md = (
        MarkdownIt("js-default", {"html": False, "linkify": True, "typographer": True})
        .use(sub_plugin)
        .use(superscript_plugin)
        .use(footnote_plugin)
        .use(deflist_plugin)
    )
    # Bare domains (`README.md`, `example.com`) stay words, as in the app.
    md.linkify.set({"fuzzy_link": False})
    pair_plugin(md, "ins", "+", "ins")
    pair_plugin(md, "mark", "=", "mark")
    md.core.ruler.after("linkify", "emoji", replace_emoji)
    md.block.ruler.before(
        "reference",
        "abbr_def",
        abbr_definition,
        {"alt": ["paragraph", "reference"]},
    )
    md.core.ruler.after("linkify", "abbr_replace", replace_abbreviations)
    for name in CONTAINERS:
        md.use(container_plugin, name)
    md.inline.ruler.before("link", "wikilink", wikilink_rule)
    md.core.ruler.after("inline", "task_lists", task_lists)
    md.core.ruler.push("link_previews", link_previews)
    for name, rule in (
        ("link_open", render_link_open),
        ("emoji", render_emoji),
        ("wikilink", render_wikilink),
        ("image", render_image),
        ("task_checkbox", render_task_checkbox),
        ("link_preview", render_link_preview),
    ):
        md.add_render_rule(name, rule)
    return md


markdown = build_markdown()


def keep_attribute(tag, attribute, value):
    # Players only from known sites, whatever the HTML says.
    if tag == "iframe" and attribute == "src" and not value.startswith(EMBED_ORIGINS):
        return None
    return value


def sanitize(html):
    """markdown-it escapes what it doesn't produce; this is in case a rule fails."""
    return nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        attribute_filter=keep_attribute,
        link_rel=None,
        filter_style_properties={"text-align"},
    )


def without_title(body, title):
    """The Markdown without its first line, when that is the title shown on top."""
    match = FIRST_LINE.match(body)
    if not match or note_title(match[1], "").lower() != title.strip().lower():
        return body
    return body[match.end() :]


def note_index(notes):
    """Addresses by lowercase title; the first note with a title wins."""
    index = {}
    for note in notes:
        index.setdefault(note["title"].lower(), note["url"])
    return index


def render_note(body, *, images, links, notes, messages):
    """
    `body` as a public page shows it. `images` and `links` are what the
    public API gives for them, `notes` the published notes `[[links]]` find.
    """
    return sanitize(
        markdown.render(
            body,
            {
                "images": images,
                "links": links,
                "notes": note_index(notes),
                "messages": messages,
            },
        )
    )
