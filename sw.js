const CACHE_NAME = "irgib-student-shell-v6";
const APP_SHELL = [
  "/etudiant/",
  "/assets/styles.css?v=20261024b",
  "/assets/catalog.js?v=20261024b",
  "/assets/pwa-install.js?v=20261024b",
  "/etudiant/student.js?v=backend8",
  "/assets/pwa-192-v2.png",
  "/assets/pwa-512-v2.png",
  "/assets/push-config.js?v=20261024c",
  "/assets/bootstrap.js?v=backend2",
  "/manifest.webmanifest",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled(APP_SHELL.map(url => cache.add(url)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("irgib-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/etudiant/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    return existing ? existing.navigate(target).then(() => existing.focus()) : self.clients.openWindow(target);
  }));
});

self.addEventListener("push", event => {
  let message = {};
  try { message = event.data?.json() || {}; }
  catch { message = { body: event.data?.text() || "Une information est disponible dans votre espace étudiant." }; }
  event.waitUntil(self.registration.showNotification(message.title || "ESPACE ETUDIANT IRGIB", {
    body: message.body || "Une information est disponible dans votre espace étudiant.",
    icon: "/assets/pwa-192-v2.png",
    badge: "/assets/pwa-192-v2.png",
    tag: message.tag || "irgib-notification",
    data: { url: message.url || "/etudiant/" },
  }));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/rest/") || url.pathname.startsWith("/storage/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("/etudiant/")) || Response.error()));
    return;
  }

  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});
