// ============================================================
// Service Worker — CIMA Medicamentos PWA
// Estrategia: Network-first con fallback a cache
// ============================================================

const CACHE_NAME = 'cima-pwa-v3';

// Recursos del shell de la app que se cachean en la instalación
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/apple-touch-icon-152.png',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js'
];

// ── Install: cachear shell de la app ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches anteriores ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network-first para API, Cache-first para assets ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Peticiones a la API de CIMA: siempre red primero, sin cachear
  if (url.hostname === 'cima.aemps.es') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Resto de recursos: Cache-first, luego red
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Solo cachear respuestas válidas de GET
        if (
          response.ok &&
          event.request.method === 'GET' &&
          (url.protocol === 'http:' || url.protocol === 'https:')
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() =>
      // Fallback offline para navegación
      event.request.mode === 'navigate'
        ? caches.match('./index.html')
        : new Response('Offline', { status: 503 })
    )
  );
});
