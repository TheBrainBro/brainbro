"""Extract local text with PDF page numbers and estimated speech timestamps."""

import json
import os
import subprocess
import wave
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

import pypdfium2 as pdfium
from PIL import Image, ImageOps

from .audio import AUDIO_TYPES
from .uploads import IMAGE_TYPES, MAX_IMAGE_PIXELS, PDF_TYPE, _pdfium_lock

# Match the text viewer's formats and size limit.
TEXT_TYPES = {
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/javascript",
    "application/x-sh",
}
SUPPORTED_MIMES = frozenset({PDF_TYPE, *IMAGE_TYPES, *AUDIO_TYPES, *TEXT_TYPES})
TEXT_LIMIT = 512 * 1024
MAX_PAGES = 200
MAX_PAGE_CHARS = 64_000
MAX_TEXT_CHARS = 2_000_000
MAX_PASSAGES = 5000
MAX_AUDIO_SECONDS = 3600
AUDIO_CHUNK_SECONDS = 60
SAMPLE_RATE = 16_000
OCR_SIDE = 3200
WALL_SECONDS = 15 * 60


@dataclass
class Passage:
    text: str
    page: int | None = None
    start_seconds: float | None = None
    end_seconds: float | None = None
    words: list[dict] = field(default_factory=list)


@dataclass
class Batch:
    next_cursor: int
    passages: list[Passage]


class UnreadableFile(Exception):
    """The stored bytes cannot be processed, including password-protected PDFs."""


def supports(mime: str) -> bool:
    return mime in SUPPORTED_MIMES or mime.startswith("text/")


def _ocr(image, deadline):
    data = BytesIO()
    image.save(data, format="PNG")
    result = subprocess.run(
        [
            "tesseract",
            "stdin",
            "stdout",
            "-l",
            os.environ.get("OCR_LANGUAGES", "eng+spa"),
        ],
        input=data.getvalue(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=min(45, _remaining(deadline)),
    )
    return result.stdout.decode("utf-8").strip()


def _remaining(deadline):
    remaining = deadline - monotonic()
    if remaining <= 0:
        raise TimeoutError("Content extraction took too long")
    return remaining


def _photo(path, mime, deadline):
    with Image.open(path, formats=[IMAGE_TYPES[mime][0]]) as photo:
        if photo.width * photo.height > MAX_IMAGE_PIXELS:
            raise UnreadableFile("Photo exceeds the image size limit")
        photo.thumbnail((OCR_SIDE, OCR_SIDE))
        return _ocr(ImageOps.exif_transpose(photo).convert("RGB"), deadline)


def _has_scan(page, sparse_text):
    """Look for a scan among native text, including small insets on sparse pages."""
    x0, y0, x1, y1 = page.get_bbox()
    if x1 <= x0 or y1 <= y0:
        return False
    # Estimate the union on a small grid so tiled scans count, and overlapping
    # images (including repeated logos) don't inflate the footprint.
    size = 100
    coverage = Image.new("L", (size, size))
    for image in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE]):
        transform = image.get_matrix()
        container = image.container
        while container:
            transform = transform.multiply(container.get_matrix())
            container = container.container
        left, bottom, right, top = transform.on_rect(0, 0, 1, 1)
        box = (
            round((max(x0, left) - x0) * size / (x1 - x0)),
            round((max(y0, bottom) - y0) * size / (y1 - y0)),
            round((min(x1, right) - x0) * size / (x1 - x0)),
            round((min(y1, top) - y0) * size / (y1 - y0)),
        )
        if box[0] < box[2] and box[1] < box[3]:
            if sparse_text:
                return True
            coverage.paste(1, box)
    return coverage.histogram()[1] >= size * size / 10


def _page_text(page):
    textpage = page.get_textpage()
    if textpage.count_chars() > MAX_PAGE_CHARS:
        text = textpage.get_text_range(count=MAX_PAGE_CHARS)
    else:
        text = textpage.get_text_bounded()
    text = text.strip()
    width, height = page.get_size()
    image = None
    if (
        width > 0
        and height > 0
        and (not text or _has_scan(page, sparse_text=len(text) < 40))
    ):
        scale = min(3, OCR_SIDE / max(width, height))
        image = page.render(scale=scale).to_pil().copy()
    return text, image


def _pdf(path, cursor, deadline):
    # Thumbnails use the same lock. Even different PDFium documents must never
    # be accessed concurrently in the threaded development worker.
    with _pdfium_lock:
        document = pdfium.PdfDocument(path)
        count = min(len(document), MAX_PAGES)
    try:
        for index in range(cursor, count):
            _remaining(deadline)
            with _pdfium_lock:
                page = document[index]
                try:
                    text, image = _page_text(page)
                finally:
                    page.close()
            if image is not None:
                recognized = _ocr(image, deadline)
                if text and text not in recognized:
                    recognized = f"{text}\n{recognized}"
                text = recognized
            yield Batch(index + 1, [Passage(text[:MAX_PAGE_CHARS], page=index + 1)])
    finally:
        with _pdfium_lock:
            document.close()


def _transcript(words):
    return Passage(
        text=" ".join(word["text"] for word in words),
        start_seconds=words[0]["start"],
        end_seconds=words[-1]["end"],
        words=words,
    )


def _recognize(path, offset, deadline):
    prefix = path.with_suffix("")
    subprocess.run(
        [
            "whisper-cli",
            "-m",
            os.environ.get("WHISPER_MODEL", "/usr/local/share/whisper/ggml-tiny.bin"),
            "-f",
            str(path),
            "-l",
            "auto",
            "-ml",
            "1",
            "-sow",
            "-oj",
            "-of",
            str(prefix),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=_remaining(deadline),
    )
    # With word splitting and a one-character limit, JSON segments have
    # word-level (estimated) timestamps in milliseconds.
    words = []
    for segment in json.loads(prefix.with_suffix(".json").read_text())["transcription"]:
        text = segment["text"].strip()
        if not text:
            continue
        times = segment["offsets"]
        start = offset + times["from"] / 1000
        end = offset + times["to"] / 1000
        if words and (
            start - words[-1]["end"] > 2
            or words[-1]["text"].endswith((".", "?", "!", "。", "？", "！"))
        ):
            yield _transcript(words)
            words = []
        words.append({"text": text, "start": start, "end": end})
    if words:
        yield _transcript(words)


def _decode(path, offset, duration, chunk, deadline):
    # Input-side accurate seek lets the demuxer seek to a packet near the
    # checkpoint. ffmpeg then discards any preroll before the requested sample.
    command = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-y",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        "wav,mp3,ogg,flac,mov,aac,matroska,webm",
        "-ss",
        str(offset),
        "-i",
        str(path.resolve()),
        "-map",
        "0:a:0",
        "-t",
        str(duration),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        str(chunk),
    ]
    try:
        subprocess.run(
            command,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=min(90, _remaining(deadline)),
        )
    except subprocess.CalledProcessError as exc:
        # Missing codecs, executables, disk space or permissions can be fixed
        # on the host. Reject only known input/stream errors permanently.
        if any(
            reason in exc.stderr
            for reason in (
                b"Invalid data found when processing input",
                b"matches no streams",
                b"moov atom not found",
            )
        ):
            raise UnreadableFile("Invalid audio stream") from exc
        raise


def _audio(path, cursor, deadline):
    while cursor < MAX_AUDIO_SECONDS:
        duration = min(AUDIO_CHUNK_SECONDS, MAX_AUDIO_SECONDS - cursor)
        with TemporaryDirectory() as tmp:
            chunk = Path(tmp) / "chunk.wav"
            _decode(path, cursor, duration, chunk, deadline)
            with wave.open(str(chunk), "rb") as wav:
                frames = wav.getnframes()
            if not frames:
                return
            passages = list(_recognize(chunk, cursor, deadline))
        cursor = (
            MAX_AUDIO_SECONDS if frames < duration * SAMPLE_RATE else cursor + duration
        )
        yield Batch(cursor, passages)


def _batches(path, mime, cursor, deadline):
    if mime == PDF_TYPE:
        try:
            yield from _pdf(path, cursor, deadline)
        except pdfium.PdfiumError as exc:
            raise UnreadableFile("Cannot read PDF") from exc
    elif mime in AUDIO_TYPES:
        yield from _audio(path, cursor, deadline)
    elif cursor == 0 and mime in IMAGE_TYPES:
        try:
            text = _photo(path, mime, deadline)
        except OSError as exc:
            if exc.errno is not None:  # Filesystem failures can be temporary.
                raise
            raise UnreadableFile("Cannot decode photo") from exc
        except (Image.DecompressionBombError, SyntaxError, ValueError) as exc:
            raise UnreadableFile("Cannot decode photo") from exc
        yield Batch(1, [Passage(text)])
    elif cursor == 0 and supports(mime) and path.stat().st_size <= TEXT_LIMIT:
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError as exc:
            raise UnreadableFile("Text file is not UTF-8") from exc
        yield Batch(1, [Passage(text)])


def extract_batches(path: Path, mime: str, cursor: int = 0):
    """Resume after a completed batch. EOF is normal generator exhaustion."""
    if cursor < 0:
        raise ValueError("Invalid extraction cursor")
    for batch in _batches(path, mime, cursor, monotonic() + WALL_SECONDS):
        for part in batch.passages:
            part.text = part.text.replace("\x00", "").strip()
        batch.passages = [part for part in batch.passages if part.text]
        yield batch


def extract(path: Path, mime: str):
    """Extract from the beginning, without persisting intermediate progress."""
    remaining, slots = MAX_TEXT_CHARS, MAX_PASSAGES
    for batch in extract_batches(path, mime):
        for passage in batch.passages:
            passage.text = passage.text[:remaining]
            yield passage
            remaining -= len(passage.text)
            slots -= 1
            if not remaining or not slots:
                return
