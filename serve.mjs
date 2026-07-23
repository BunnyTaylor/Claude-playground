#!/usr/bin/env node
/**
 * serve.mjs — minimal static dev server for the web/ app.
 *
 * The app is pure static files (the engine runs in the browser), so this is
 * only a convenience for local development — any static host works, including
 * `python3 -m http.server`, GitHub Pages, or the nginx Dockerfile.
 *
 *   node serve.mjs                 # http://127.0.0.1:8000
 *   node serve.mjs --port 9000
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string" }, host: { type: "string" } } });
const PORT = parseInt(values.port || "8000", 10);
const HOST = values.host || "127.0.0.1";
const ROOT = new URL("./web/", import.meta.url).pathname;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => console.log(`Mushroom Dress UI  →  http://${HOST}:${PORT}   (Ctrl-C to stop)`));
