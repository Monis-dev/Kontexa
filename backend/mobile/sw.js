// ContextNote PWA — Service Worker v1.5 (BUMPED VERSION to force update)
const CACHE = "cn-pwa-v1.5";

// Use absolute paths relative to the domain to avoid confusion
const STATIC = [
  "/mobile/",
  "/mobile/index.html",
  "/mobile/app.css",
  "/mobile/app.js",
  "/mobile/ai_agent.js",
  "/mobile/manifest.json",
  "/mobile/icons/icon-192.png",
  "/mobile/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // APIs → network first, fallback to cache
  if (
    url.hostname.includes("context-notes.onrender.com") ||
    url.hostname.includes("generativelanguage.googleapis.com") ||
    url.hostname.includes("api.openai.com") ||
    url.hostname.includes("accounts.google.com")
  ) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Everything else → cache first
  e.respondWith(
    // ignoreSearch: true is CRITICAL for PWA home screen launches
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // Dynamically cache new files as we fetch them
          return caches.open(CACHE).then((cache) => {
            cache.put(req, res.clone());
            return res;
          });
        })
        .catch(() => {
          // If totally offline and file isn't cached, return index.html
          // Use mode 'navigate' to only return index.html for page requests, not missing images/css
          if (req.mode === "navigate") {
            return caches.match("/mobile/index.html", { ignoreSearch: true });
          }
        });
    }),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-notes") {
    event.waitUntil(syncNotesToServer());
  }
});
