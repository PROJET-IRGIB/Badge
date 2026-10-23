// Keep the admin PWA network-only so sensitive records are never stored offline.
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method === "GET" && new URL(request.url).origin === self.location.origin) {
    event.respondWith(fetch(request));
  }
});
