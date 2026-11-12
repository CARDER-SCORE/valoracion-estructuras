// Service worker: guarda la app para que abra sin señal.
// Suba CACHE en cada publicación para que los celulares tomen la versión nueva.
const CACHE = "valoracion-estructuras-v1";
const ARCHIVOS = ["./", "index.html", "styles.css", "config.js", "ficha-estructuras.js", "concepto.js", "app.js",
  "manifest.json", "img/logo.jpg", "img/icono-192.png", "img/icono-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Solo archivos de la propia app; las llamadas a Apps Script nunca pasan por la caché.
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Red primero (para tomar cambios); si no responde en 4 s o no hay señal, la caché.
  const red = fetch(e.request).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
    return r;
  });
  const desdeCache = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : undefined));
  e.respondWith(new Promise(ok => {
    const t = setTimeout(() => desdeCache().then(r => r ? ok(r) : red.then(ok, () => ok(Response.error()))), 4000);
    red.then(r => { clearTimeout(t); ok(r); }, () => { clearTimeout(t); desdeCache().then(r => ok(r || Response.error())); });
  }));
});

