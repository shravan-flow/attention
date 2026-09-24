/* Attention service worker: offline shell, push reminders, tap-to-check-in. */
var CACHE = 'attention-v7';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'moves.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png', 'fonts/archivo.woff2', 'fonts/space-mono-400.woff2', 'fonts/space-mono-700.woff2', 'fonts/plex-400.woff2', 'fonts/plex-500.woff2', 'fonts/plex-600.woff2', 'fonts/plex-700.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== 'attention-data'; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Network first (so updates arrive), cache as fallback when offline.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
  }));
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(caches.open('attention-data').then(function (c) { return c.match('goal.json'); })
    .then(function (r) { return r ? r.json() : {}; }).catch(function () { return {}; })
    .then(function (g) {
      var now = new Date(), today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      var body = d.body || 'Where is your attention right now? Tap to check in.';
      if (!d.kind && g && g.text && g.day === today) body += '\nToday’s goal: ' + g.text;
      return self.registration.showNotification(d.title || 'Pause for a minute', {
        body: body,
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        tag: d.kind === 'goal' ? 'attention-goal' : d.kind === 'move' ? 'attention-move' : 'attention-ping',
        renotify: true,
        vibrate: [120, 80, 120],
        data: { url: d.url || './?checkin=1' }
      });
    }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './?checkin=1', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) {
        list[i].postMessage({ type: url.indexOf('goal=1') >= 0 ? 'goal' : url.indexOf('move=') >= 0 ? 'move' : 'checkin', url: url });
        return list[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
