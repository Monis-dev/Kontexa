// ContextNote PWA — Service Worker v1.4
const CACHE = 'cn-pwa-v1.4';
const STATIC = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./ai_agent.js",
  "./manifest.json",

  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
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
    e.respondWith(
      fetch(req)
        .then((res) => {
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Everything else → cache first
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          return caches.open(CACHE).then((cache) => {
            cache.put(req, res.clone());
            return res;
          });
        })
        .catch(() => {
          return caches.match("./index.html");
        });
    }),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-notes") {
    event.waitUntil(syncNotesToServer());
  }
});