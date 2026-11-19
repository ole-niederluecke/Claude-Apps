// Offline-Cache für die App-Hülle. Daten (Supabase) werden nie zwischengespeichert.
// Immer zuerst frisch aus dem Netz, offline aus dem Cache. So gibt es nach einem Update nie alte Dateien.
const CACHE = "la-team-20261119-17";
const CORE = ["./", "index.html", "app.js", "xlsx-plan.js", "plan-format.js", "config.js", "vendor/supabase-2.118.0.js", "manifest.webmanifest",
  "logo.png", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(fetch(req, { cache: "no-cache" })
    .then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(key, c)); } return r; })
    .catch(() => caches.match(key)));
});
