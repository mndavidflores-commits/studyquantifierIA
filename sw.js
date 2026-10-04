// ===================== CONFIG =====================
// Bump this version string whenever you push updates — this forces all
// clients to fetch the new assets and drop the old cache.
const CACHE_VERSION = 'studyquantifier-v4';
const CACHE_NAME = CACHE_VERSION;

// Local assets — cache-first, always offline-available.
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/componentes.css',
  './css/layout.css',
  './css/metrics.css',
  './css/responsive.css',
  './js/main.js',
  './js/app.js',
  './js/config.js',
  './js/utils.js',
  './js/sync.js',
  './js/ui.js',
  './js/pomodoro.js',
  './js/timer.js',
  './js/reviews.js',
  './js/charts.js',
  './js/metrics.js',
  './js/auth.js',
  './js/panels.js',
  './js/history.js',
  './js/sleepNotes.js',
  './js/checklistGoals.js',
  './js/conjectures.js',
  './js/selectors.js',
  './js/events.js',
  './js/comparison.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

// Third-party origins that we want to cache at runtime (cache-first, then network).
const RUNTIME_CACHE_HOSTS = [
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Supabase API — never cache.
const NEVER_CACHE_HOST = 'wrtmlucrxzewynnnikzh.supabase.co';

// ===================== INSTALL =====================
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache each asset independently so one missing file (e.g. a maskable
    // icon that hasn't been generated yet) doesn't blow up the whole install.
    await Promise.all(
      STATIC_ASSETS.map(url =>
        cache.add(url).catch(err => {
          console.warn('[SW] Failed to cache asset:', url, err);
        })
      )
    );
  })());
});

// ===================== ACTIVATE =====================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ===================== HELPERS =====================
function isNeverCache(url) {
  return url.hostname === NEVER_CACHE_HOST;
}

function isRuntimeCache(url) {
  return RUNTIME_CACHE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
}

function isSupportedProtocol(url) {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

// ===================== FETCH =====================
self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (!isSupportedProtocol(url)) return;

  if (isNeverCache(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isRuntimeCache(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

// ===================== STRATEGIES =====================
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    return new Response(
      '<!DOCTYPE html><html><body><h1>Offline</h1><p>Studyquantifier is offline and not yet cached. Please reconnect once.</p></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      if (response.type === 'basic' || response.type === 'cors') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (err) {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// ===================== MESSAGE =====================
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});