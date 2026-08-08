// XR Search service worker.
// - HTML/navigations: network-first, so new deploys land immediately (no stale
//   app). Falls back to cache when offline.
// - Other GETs (hashed assets): stale-while-revalidate for speed + offline.
// Bump CACHE to evict old entries.
const CACHE = 'xros-v2'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
)

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const isDoc = req.mode === 'navigate' || req.destination === 'document'

  if (isDoc) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(req, res.clone()))
          return res
        })
        .catch(() => caches.match(req))
    )
    return
  }

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
