/* ============================================================
   SERVICE WORKER — Quiz Platform Champ
   Stale-while-revalidate for the app shell.
   Never caches Supabase API calls.
   ============================================================ */

const CACHE_VERSION = 'quiz-champ-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/quiz.css',
  './assets/quiz.js',
  './assets/config.js',
  './assets/supabase.js',
  './assets/logo-icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

/* ---------- install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // add each file, ignore failures (e.g. missing icon PNGs)
      return Promise.all(
        SHELL.map(url =>
          cache.add(url).catch(() => { /* skip missing */ })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ---------- activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only GET
  if (req.method !== 'GET') return;

  // Skip Supabase, Edge Functions, CDNs — always go live
  if (url.hostname.includes('supabase.co')) return;
  if (url.pathname.includes('/functions/')) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});