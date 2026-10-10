// Zero-dependency static server for dist/ with the cross-origin-isolation headers the multithreaded
// WASM runtime wants. Usage: node serve.mjs [port]   (default 8098). Works fully offline.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.argv[2] || process.env.PORT || 8098);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".wav": "audio/wav", ".png": "image/png" };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(400).end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "application/octet-stream",
      "cache-control": /\/assets\/|\/ort\//.test(url.pathname) ? "public, max-age=31536000, immutable" : "no-cache",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(port, "0.0.0.0", () => console.log(`VOX-T on http://localhost:${port}/`));
