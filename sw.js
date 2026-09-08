const CACHE_NAME = 'kaitiaki-camera-v4';
const IMAGE_CACHE = 'kaitiaki-camera-images-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './offline-fix.js'
];

async function withOfflineFix(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  try {
    const text = await response.text();
    if (text.includes('offline-fix.js')) return new Response(text, {status: response.status, headers: response.headers});
    const patched = text.replace('</body>', '<script src="./offline-fix.js"></script>\n</body>');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(patched, {status: response.status, statusText: response.statusText, headers});
  } catch {
    return response;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME && key !== IMAGE_CACHE).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(async response => {
        const patched = await withOfflineFix(response.clone());
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, patched.clone()));
        return patched;
      })
      .catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', {status: 504, statusText: 'Offline'});
      }))
  );
});
