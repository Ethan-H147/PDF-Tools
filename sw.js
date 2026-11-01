// SPDX-License-Identifier: AGPL-3.0-or-later
// Offline support. The app shell is cached on install; everything else the app fetches
// (PDF engine data, fonts) is cached the first time it is used. PDFs never pass through
// here: they are read from the device and never uploaded.

// Replaced by scripts/build.mjs with a hash of the app files, so each release gets a
// fresh cache and old ones are cleared.
const VERSION = '2a0d37751dff';
const CACHE = 'pdf-atelier-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.bundle.js',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/pdfjs-6.3.289/legacy/build/pdf.worker.min.mjs',
  './vendor/pdf-lib-2.9.2/dist/pdf-lib.min.js',
];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('pdf-atelier-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function remember(request, response) {
  if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

// Pages: always try the network so a deploy shows up right away; fall back offline.
async function networkFirst(request) {
  try {
    return await remember(request, await fetch(request));
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || caches.match('./index.html');
  }
}

// App files: the exact versioned URL first, then the network, then any cached copy of
// the same file (so offline still works after a version bump).
async function cacheFirst(request) {
  const exact = await caches.match(request);
  if (exact) return exact;
  try {
    return await remember(request, await fetch(request));
  } catch (err) {
    const any = await caches.match(request, { ignoreSearch: true });
    if (any) return any;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request).then(response => remember(request, response)).catch(() => cached);
  return cached || refresh;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
  } else if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
