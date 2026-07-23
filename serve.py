#!/usr/bin/env python3
"""serve.py -- tiny standard-library web server for the mushroom-dress UI.

No third-party dependencies. Serves the front-end in ``web/`` and exposes a
single JSON endpoint that runs the Python engine + visualizer:

    POST /api/pattern   body: {"input": <PatternInput>, "palette": {cap,spot,body}}
    ->                  {"pieces", "warnings", "meta", "svg"}

Run it, then open the printed URL:

    python3 serve.py           # http://127.0.0.1:8000
    python3 serve.py --port 9000 --open

Projects are saved in the browser (localStorage), so patterns persist across
refreshes without any server-side storage.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from crochet_core import compute_pattern, estimate_yarn, convert_terms
from crochet_viz import render_dress_svg

WEB_DIR = Path(__file__).resolve().parent / "web"


class Handler(BaseHTTPRequestHandler):
    server_version = "MushroomDress/0.1"

    # --- helpers ---
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    # --- routing ---
    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = "/index.html"
        target = (WEB_DIR / path.lstrip("/")).resolve()
        # confine to WEB_DIR
        if WEB_DIR not in target.parents and target != WEB_DIR:
            return self._json(403, {"error": "forbidden"})
        if not target.is_file():
            return self._json(404, {"error": "not found"})
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype)

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/api/pattern":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": f"bad request: {exc}"})

        inp = payload.get("input") or {}
        palette = payload.get("palette")
        schematic = bool(payload.get("schematic"))
        try:
            result = compute_pattern(inp)
            result = convert_terms(result, (inp.get("terms") or "US"))
            svg = render_dress_svg(result, inp, palette, schematic=schematic)
        except ValueError as exc:
            return self._json(422, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - report cleanly to the client
            return self._json(500, {"error": f"internal error: {exc}"})

        result["svg"] = svg
        try:
            result["yarn"] = estimate_yarn(result)
        except Exception:  # noqa: BLE001 - yarn estimate is best-effort
            result["yarn"] = None
        self._json(200, result)

    def log_message(self, fmt, *args) -> None:  # quieter console
        return


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Serve the mushroom-dress web UI.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--open", action="store_true", help="open a browser window")
    args = ap.parse_args(argv)

    if not (WEB_DIR / "index.html").is_file():
        print(f"error: {WEB_DIR}/index.html not found", flush=True)
        return 1

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}"
    print(f"Mushroom Dress UI  →  {url}   (Ctrl-C to stop)", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
