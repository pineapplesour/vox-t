import { defineConfig } from "vite";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const isolate = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" };

// Writes dist/precache.json (every built file) so the service worker can store the whole app shell,
// including worker chunks and the ONNX Runtime WASM, on first visit — the app then opens with no network.
function precacheManifest() {
  return {
    name: "precache-manifest",
    apply: "build",
    closeBundle() {
      const dist = path.resolve("dist");
      const files = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (!/sw\.js$|precache\.json$|_clean\.wav$/.test(name)) files.push("./" + path.relative(dist, full).split(path.sep).join("/"));
        }
      };
      walk(dist);
      writeFileSync(path.join(dist, "precache.json"), JSON.stringify({ version: Date.now(), files: ["./", ...files.filter((f) => f !== "./index.html")] }));
    }
  };
}

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  server: { headers: isolate },
  preview: { headers: isolate },
  plugins: [precacheManifest()],
  build: { target: "es2022", chunkSizeWarningLimit: 6000 }
});
