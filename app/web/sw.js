'use strict';
/* Сервис-воркер: чтоб сайт ставился как приложение и открывался без сети.
   Своя статика — «сначала сеть, потом кэш» (обновы приезжают сразу), OpenDota и картинки не трогаем. */
const CACHE = 'dota-stats-v1';
const CORE = ['./', 'index.html', 'style.css', 'static-api.js', 'app.js', 'meta.js', 'draft.js', 'skill.js',
  'sessions.js', 'wrapped.js', 'goals.js', 'mmr.js', 'live.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
