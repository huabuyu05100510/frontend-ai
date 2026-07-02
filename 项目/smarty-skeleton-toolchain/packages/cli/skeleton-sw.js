// skeleton service worker
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 向所有客户端发送 FETCH_START
  event.waitUntil(
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'FETCH_START', url }))
    )
  );

  const fetchPromise = fetch(event.request)
    .then(res => {
      // 向客户端发送 FETCH_END
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'FETCH_END', url }))
      );
      return res;
    })
    .catch(err => {
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'FETCH_END', url }))
      );
      throw err;
    });

  event.respondWith(fetchPromise);
});
