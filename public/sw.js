// Offline app shell. On install, store every built file listed in precache.json (HTML, JS, worker
// chunks, ONNX Runtime WASM, samples). Model weights are cached separately by transformers.js / WebLLM.
// Network-first while online so a redeploy shows up; cache when offline.
const CACHE = "voxt-shell-v4";
self.addEventListener("install", (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const { files } = await (await fetch("./precache.json", { cache: "no-store" })).json();
  await cache.addAll(files);
  await self.skipWaiting();
})()));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      const key = e.request.mode === "navigate" ? new URL("./", location.href).href : e.request;
      return (await cache.match(key, { ignoreSearch: e.request.mode === "navigate" })) ?? Response.error();
    }
  })());
});
