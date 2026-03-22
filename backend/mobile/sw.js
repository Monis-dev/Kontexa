// ContextNote PWA — Service Worker v1.4
const CACHE = 'cn-pwa-v1.4';
const STATIC = ['./index.html',
  './app.css',
  './app.js',
  './ai_agent.js',
  './manifest.json'];

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

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first: API, AI providers, Google OAuth
  if (
    url.hostname.includes('context-notes.onrender.com') ||
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.hostname.includes('api.openai.com') ||
    url.hostname.includes('accounts.google.com')
  ) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Google Fonts — cache after first fetch
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => { cache.put(e.request, res.clone()); return res; });
        })
      )
    );
    return;
  }

  // App shell — cache first
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
