"""
A small HTTP server around one embedding model, for the api and the worker.

    POST /embed  {"texts": ["...", ...]}  ->  {"vectors": [[...], ...]}
    GET  /health                          ->  {"model": "...", "dimensions": 384}

`python server.py download` fetches the model (at build time), `check` is the
healthcheck. Only the stack's own containers reach it: no port is published.
"""

import json
import os
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from fastembed import TextEmbedding

MODEL = os.environ["EMBEDDING_MODEL"]
MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
PORT = int(os.environ.get("PORT", "8000"))
# Enough for a batch of chunks; a request is refused above these.
MAX_TEXTS = 256
MAX_BODY = 2 * 1024 * 1024


def load(**kwargs):
    threads = os.environ.get("EMBEDDER_THREADS")
    return TextEmbedding(
        MODEL, cache_dir=MODEL_DIR, threads=int(threads) if threads else None, **kwargs
    )


class Handler(BaseHTTPRequestHandler):
    model = None
    # The tokenizer can't be used from two threads at once.
    lock = threading.Lock()

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, {"error": "Not found."})
        dimensions = self.model.embedding_size
        self.reply(200, {"model": MODEL, "dimensions": dimensions})

    def do_POST(self):
        if self.path != "/embed":
            return self.reply(404, {"error": "Not found."})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self.reply(413, {"error": "Too large."})
        try:
            texts = json.loads(self.rfile.read(length))["texts"]
            if not isinstance(texts, list) or not all(
                isinstance(text, str) for text in texts
            ):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.reply(400, {"error": "Send {\"texts\": [strings]}."})
        if len(texts) > MAX_TEXTS:
            return self.reply(413, {"error": f"At most {MAX_TEXTS} texts."})
        with self.lock:
            vectors = [vector.tolist() for vector in self.model.embed(texts)]
        self.reply(200, {"vectors": vectors})

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Healthchecks every few seconds would drown everything else.
        if "/health" not in self.requestline:
            super().log_message(format, *args)


def check():
    # nosemgrep: dynamic-urllib-use-detected -- a fixed local health check URL
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2):
        pass


def serve():
    Handler.model = load(local_files_only=True)
    print(f"Embedding with {MODEL} on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "serve"
    {"download": load, "check": check, "serve": serve}[command]()
