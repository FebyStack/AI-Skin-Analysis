// Service worker for AI Skin Analysis PWA.
// Strategies:
//   /api/*        → network-only (auth-gated, never cached).
//   /models/*     → cache-first (immutable ML task/weight files).
//   assets/*      → cache-first (Vite emits hashed filenames).
//   navigations   → network-first, falling back to cached shell.
// Bump CACHE_V whenever the shell/assets change → old caches purged on activate.

const CACHE_V = "skin-v1";
const SHELL_CACHE = `${CACHE_V}-shell`;
const MODEL_CACHE = `${CACHE_V}-models`;
const ASSET_CACHE = `${CACHE_V}-assets`;
const PRECACHE = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => !n.startsWith(CACHE_V)).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    const cache = await caches.open(cacheName);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cache = await caches.open(cacheName);
    const hit = (await cache.match(request)) ?? (await cache.match("/"));
    if (hit) return hit;
    throw new Error("offline and no cached shell");
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't proxy cross-origin

  if (url.pathname.startsWith("/api/")) return; // network-only, auth-gated
  if (url.pathname.startsWith("/models/")) {
    event.respondWith(cacheFirst(req, MODEL_CACHE));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }
});
