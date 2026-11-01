"""
Stored files sent in parts (HTTP Range), as players ask for them: Safari
won't play audio or video from a server that can't send one byte range, and
seeking anywhere else asks for the part from there on.
"""

import re

from django.http import FileResponse, HttpResponse, StreamingHttpResponse
from django.utils.http import content_disposition_header

CHUNK = 64 * 1024
# One range only (`bytes=0-1`, `bytes=500-`, `bytes=-500`); several at once
# would need a multipart body no player asks for.
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def requested_range(header, size):
    """
    (first, last) byte of `header` within `size`; None to send it all (no
    header, or one we don't serve). Raises ValueError if it starts past the end.
    """
    match = RANGE.match((header or "").strip())
    if not match or match.groups() == ("", ""):
        return None
    start, end = match.groups()
    if not start:  # the last `end` bytes
        length = int(end)
        if length == 0:
            raise ValueError("Empty range")
        return max(size - length, 0), size - 1
    first = int(start)
    last = min(int(end), size - 1) if end else size - 1
    if first >= size or last < first:
        raise ValueError("Range not satisfiable")
    return first, last


def file_response(request, field, content_type, filename, as_attachment):
    """`field` (a stored file), whole or the range the request asks for."""
    size = field.size
    try:
        part = requested_range(request.headers.get("Range"), size)
    except ValueError:
        response = HttpResponse(status=416)
        response["Content-Range"] = f"bytes */{size}"
        return response
    if part is None:
        response = FileResponse(
            field.open("rb"),
            content_type=content_type,
            as_attachment=as_attachment,
            filename=filename,
        )
    else:
        first, last = part
        response = StreamingHttpResponse(
            _read(field, first, last - first + 1),
            status=206,
            content_type=content_type,
        )
        response["Content-Length"] = str(last - first + 1)
        response["Content-Range"] = f"bytes {first}-{last}/{size}"
        response["Content-Disposition"] = content_disposition_header(
            as_attachment, filename
        )
    response["Accept-Ranges"] = "bytes"
    return response


def _read(field, start, length):
    # Closed when the response is, even if the player stops listening.
    with field.open("rb") as file:
        file.seek(start)
        while length > 0:
            chunk = file.read(min(CHUNK, length))
            if not chunk:
                return
            length -= len(chunk)
            yield chunk
