"""
Which uploads are audio, and the type browsers play each one as.

libmagic names WebM and MP4 after their container, video or not, and that is
what browsers record voice in (MediaRecorder): those are audio when they have
an audio track and no video one, read from the file's own track list.
"""

import struct

# Detected MIME type -> (type it is served as, stored extension).
AUDIO_TYPES = {
    "audio/mpeg": ("audio/mpeg", "mp3"),
    "audio/ogg": ("audio/ogg", "ogg"),
    "audio/opus": ("audio/ogg", "opus"),
    "audio/wav": ("audio/wav", "wav"),
    "audio/x-wav": ("audio/wav", "wav"),
    "audio/vnd.wave": ("audio/wav", "wav"),
    "audio/flac": ("audio/flac", "flac"),
    "audio/x-flac": ("audio/flac", "flac"),
    "audio/mp4": ("audio/mp4", "m4a"),
    "audio/x-m4a": ("audio/mp4", "m4a"),
    "audio/aac": ("audio/aac", "aac"),
    "audio/x-hx-aac-adts": ("audio/aac", "aac"),
    "audio/webm": ("audio/webm", "webm"),
}
# Containers that hold audio, video or both.
WEBM_TYPES = {"video/webm", "video/x-matroska"}
MP4_TYPES = {"video/mp4"}

# WebM's track list comes before the first cluster of frames, near the start.
WEBM_HEAD = 64 * 1024
EBML_SEGMENT = 0x18538067
EBML_TRACKS = 0x1654AE6B
EBML_TRACK_ENTRY = 0xAE
EBML_TRACK_TYPE = 0x83
EBML_CLUSTER = 0x1F43B675
# TrackType values.
WEBM_VIDEO, WEBM_AUDIO = 1, 2
# MP4 boxes that hold the track handlers (`hdlr`); the rest are skipped.
MP4_CONTAINERS = {b"moov", b"trak", b"mdia"}
# A real file has a few dozen; a crafted one can't keep us walking.
MP4_MAX_BOXES = 10_000


def audio_type(file, mime):
    """(served type, extension) if `file`, detected as `mime`, is audio; else None."""
    if mime in AUDIO_TYPES:
        return AUDIO_TYPES[mime]
    try:
        if mime in WEBM_TYPES and _audio_only(
            _webm_tracks(file), WEBM_AUDIO, WEBM_VIDEO
        ):
            return AUDIO_TYPES["audio/webm"]
        if mime in MP4_TYPES and _audio_only(_mp4_handlers(file), b"soun", b"vide"):
            return AUDIO_TYPES["audio/mp4"]
    except (OSError, ValueError, struct.error):
        return None
    finally:
        file.seek(0)
    return None


def _audio_only(tracks, audio, video):
    return audio in tracks and video not in tracks


def _vint(data, position, marker):
    """
    An EBML variable-length integer at `position`: (value, length). IDs keep
    their length marker; sizes drop it, and all ones means unknown (None).
    """
    if position >= len(data):
        raise ValueError("Not EBML")
    length = 9 - data[position].bit_length()
    if length > 8 or position + length > len(data):
        raise ValueError("Not EBML")
    value = int.from_bytes(data[position : position + length], "big")
    if marker:
        return value, length
    value &= (1 << (7 * length)) - 1
    return (None if value == (1 << (7 * length)) - 1 else value), length


def _webm_tracks(file):
    """The TrackType of every track in a WebM file."""
    file.seek(0)
    data = file.read(WEBM_HEAD)
    tracks, position = set(), 0
    while position < len(data):
        element, id_length = _vint(data, position, marker=True)
        size, size_length = _vint(data, position + id_length, marker=False)
        position += id_length + size_length
        if element == EBML_CLUSTER:
            break
        # Step into the elements that lead to the track types, over the rest.
        if element in (EBML_SEGMENT, EBML_TRACKS, EBML_TRACK_ENTRY):
            continue
        if size is None:
            break
        if element == EBML_TRACK_TYPE:
            tracks.add(int.from_bytes(data[position : position + size], "big"))
        position += size
    return tracks


def _mp4_handlers(file):
    """The handler type (b"soun", b"vide"…) of every track in an MP4 file."""
    handlers, boxes = set(), 0

    def walk(start, end, depth=0):
        nonlocal boxes
        position = start
        while position + 8 <= end and boxes < MP4_MAX_BOXES:
            boxes += 1
            file.seek(position)
            header = file.read(16)
            size, kind = struct.unpack(">I4s", header[:8])
            header_length = 8
            if size == 1:
                size, header_length = struct.unpack(">Q", header[8:16])[0], 16
            elif size == 0:  # up to the end of the file
                size = end - position
            if size < header_length:
                return
            if kind in MP4_CONTAINERS and depth < len(MP4_CONTAINERS):
                walk(position + header_length, min(position + size, end), depth + 1)
            elif kind == b"hdlr":
                # Version and flags, then a reserved word, then the type.
                file.seek(position + header_length + 8)
                handlers.add(file.read(4))
            position += size

    walk(0, file.size)
    return handlers
