// Service worker : met tous les fichiers de l'appli en cache pour un fonctionnement hors ligne.
// Changer VERSION à chaque mise à jour (code ou donnees/*.json) pour que le téléphone récupère la nouvelle version.
// Le dossier sources/ n'est jamais mis en cache.
const VERSION = "suivi-nutrition-2026-11-05-8";
const FICHIERS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./calculs.js",
  "./stockage.js",
  "./manifest.webmanifest",
  "./donnees/foods.json",
  "./donnees/references.json",
  "./donnees/activite.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(FICHIERS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((k) => k.startsWith("suivi-nutrition-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/sources/")) return;
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./index.html", { cacheName: VERSION }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true, cacheName: VERSION }).then((r) => r || fetch(req)));
});
