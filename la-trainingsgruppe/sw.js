// Offline-Cache für die App-Hülle. Daten (Supabase) werden nie zwischengespeichert.
const CACHE = "la-team-20261117-2";
const CORE = ["./", "index.html", "config.js", "vendor/supabase-2.118.0.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Seite und Konfiguration: immer zuerst frisch aus dem Netz, offline aus dem Cache
  if (req.mode === "navigate" || req.url.endsWith("/config.js")) {
    const key = req.mode === "navigate" ? "index.html" : "config.js";
    e.respondWith(fetch(req, { cache: "no-store" })
      .then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(key, c)); return r; })
      .catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return r;
  })));
});
