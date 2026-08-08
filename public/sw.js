// XR Search service worker — stale-while-revalidate for the app shell so it
// loads fast and works offline once cached. Bump CACHE to force an update.
const CACHE = 'xros-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && new URL(req.url).origin === location.origin) {
            cache.put(req, res.clone())
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
