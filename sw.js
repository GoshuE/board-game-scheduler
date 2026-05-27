const CACHE_NAME = 'bodomame-scheduler-v11';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/boardgame-icons.png',
  './assets/bodomame-chan-celebrate.png',
  './assets/bodomame-chan-empty.png',
  './assets/bodomame-chan-guide.png',
  './assets/bodomame-chan-icon-celebrate.png',
  './assets/bodomame-chan-icon-guide.png',
  './assets/bodomame-chan-icon-think.png',
  './assets/bodomame-chan-icon-wait.png',
  './assets/bodomame-chan-icon.png',
  './assets/bodomame-chan-main.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
