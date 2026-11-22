import json
import wave
from pathlib import Path
from time import monotonic

import pypdfium2 as pdfium
import pytest
from PIL import Image

from apps.items import extractors
from apps.items.extractors import (
    Batch,
    Passage,
    UnreadableFile,
    extract,
    extract_batches,
)

from .test_uploads import pdf_bytes


def test_searchable_utf8_text_is_bounded_and_clean(tmp_path):
    path = tmp_path / "document"
    path.write_bytes(b"\xef\xbb\xbfpurchase\x00 order\r\nreference: 123")
    assert list(extract(path, "application/json")) == [
        Passage("purchase order\nreference: 123")
    ]
    assert list(extract(path, "application/zip")) == []
    path.write_bytes(b"x" * (extractors.TEXT_LIMIT + 1))
    assert list(extract(path, "text/plain")) == []


def test_scanned_pdf_retains_physical_pages_when_a_page_is_blank(tmp_path, monkeypatch):
    path = tmp_path / "scan.pdf"
    path.write_bytes(pdf_bytes(pages=3))
    recognized = iter(["first", "", "third"])
    monkeypatch.setattr(extractors, "_ocr", lambda image, deadline: next(recognized))
    assert list(extract(path, "application/pdf")) == [
        Passage("first", page=1),
        Passage("third", page=3),
    ]


def test_photo_ocr_extracts_from_pixels_with_bounded_dimensions(tmp_path, monkeypatch):
    path = tmp_path / "photo"
    Image.new("RGB", (4000, 2000), "navy").save(path, format="PNG")

    def ocr(image, deadline):
        assert max(image.size) == extractors.OCR_SIDE
        assert image.getpixel((4, 4)) == (0, 0, 128)
        return "street sign"

    monkeypatch.setattr(extractors, "_ocr", ocr)
    assert list(extract(path, "image/png")) == [Passage("street sign")]


def test_recognized_words_keep_offsets_in_the_original_recording(tmp_path, monkeypatch):
    def whisper(command, **kwargs):
        assert command[0] == "whisper-cli"
        prefix = Path(command[command.index("-of") + 1])
        prefix.with_suffix(".json").write_text(
            json.dumps(
                {
                    "transcription": [
                        {"text": "", "offsets": {"from": 0, "to": 500}},
                        {"text": " The", "offsets": {"from": 500, "to": 1000}},
                        {"text": " budget.", "offsets": {"from": 1000, "to": 1750}},
                        {"text": " Next.", "offsets": {"from": 5600, "to": 6500}},
                    ]
                }
            )
        )

    monkeypatch.setattr(extractors.subprocess, "run", whisper)
    first, second = extractors._recognize(tmp_path / "001.wav", 300, monotonic() + 60)
    assert first.text == "The budget."
    assert (first.start_seconds, first.end_seconds) == (300.5, 301.75)
    assert first.words[1] == {"text": "budget.", "start": 301, "end": 301.75}
    assert second.start_seconds == pytest.approx(305.6)


def test_mixed_pdf_indexes_raster_content_and_ignores_a_small_logo(
    tmp_path, monkeypatch
):
    path = tmp_path / "hybrid.pdf"
    header = "Quarterly inspection report for the public library archive"
    document = pdfium.PdfDocument.new()
    for text, width, height in [
        (header, 400, 100),
        (header, 35, 12),
        ("Inset", 35, 12),
    ]:
        page = document.new_page(500, 650)
        title = pdfium.raw.FPDFPageObj_NewTextObj(document, b"Helvetica", 11)
        chars = (pdfium.raw.FPDF_WCHAR * (len(text) + 1))(*map(ord, text), 0)
        assert pdfium.raw.FPDFText_SetText(title, chars)
        label = pdfium.PdfObject(title)
        label.set_matrix(pdfium.PdfMatrix().translate(10, 500))
        page.insert_obj(label)
        image = pdfium.PdfImage.new(document)
        image.set_bitmap(pdfium.PdfBitmap.from_pil(Image.new("RGB", (10, 10))))
        image.set_matrix(pdfium.PdfMatrix(a=width, d=height, e=10, f=200))
        page.insert_obj(image)
        page.gen_content()
        page.close()
    document.save(path)
    document.close()

    monkeypatch.setattr(extractors, "_ocr", lambda image, deadline: "PROJECT ORCHARD")
    assert list(extract(path, "application/pdf")) == [
        Passage(f"{header}\nPROJECT ORCHARD", page=1),
        Passage(header, page=2),
        Passage("Inset\nPROJECT ORCHARD", page=3),
    ]


def test_resumed_pdf_starts_after_checkpoint_and_advances_past_blank_pages(
    tmp_path, monkeypatch
):
    path = tmp_path / "scan.pdf"
    path.write_bytes(pdf_bytes(pages=3))
    recognized = iter(["", "  third\x00  "])
    monkeypatch.setattr(extractors, "_ocr", lambda image, deadline: next(recognized))
    assert list(extract_batches(path, "application/pdf", cursor=1)) == [
        Batch(2, []),
        Batch(3, [Passage("third", page=3)]),
    ]


def test_audio_resume_decodes_one_interval_and_keeps_the_source_offset(
    tmp_path, monkeypatch
):
    calls = []

    def decode(command, **kwargs):
        assert command.index("-ss") < command.index("-i")
        calls.append(int(command[command.index("-ss") + 1]))
        duration = int(command[command.index("-t") + 1])
        assert duration == extractors.AUDIO_CHUNK_SECONDS
        with wave.open(command[-1], "wb") as wav:
            wav.setparams((1, 2, extractors.SAMPLE_RATE, 0, "NONE", "not compressed"))
            wav.writeframes(bytes(2 * extractors.SAMPLE_RATE))

    def recognize(chunk, offset, deadline):
        yield Passage("story", start_seconds=offset + 0.1, end_seconds=offset + 0.7)

    monkeypatch.setattr(extractors.subprocess, "run", decode)
    monkeypatch.setattr(extractors, "_recognize", recognize)
    batches = list(extract_batches(tmp_path / "voice", "audio/webm", cursor=120))
    assert calls == [120]
    assert batches == [
        Batch(
            extractors.MAX_AUDIO_SECONDS,
            [Passage("story", start_seconds=120.1, end_seconds=120.7)],
        )
    ]
    assert (
        list(extract_batches(tmp_path / "voice", "audio/webm", batches[0].next_cursor))
        == []
    )
    assert calls == [120]


@pytest.mark.parametrize("mime", ["application/pdf", "text/plain", "image/png"])
def test_permanently_unreadable_files_are_identified(tmp_path, mime):
    path = tmp_path / "broken"
    path.write_bytes(b"not a valid PDF, image, or UTF-8 document\xff")
    with pytest.raises(UnreadableFile):
        list(extract_batches(path, mime))
