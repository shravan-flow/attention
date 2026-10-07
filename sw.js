/* Attention service worker: opens instantly from the phone (cache first, refreshed in the background), push reminders, tap-to-check-in. */
var CACHE = 'attention-v35';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'moves.json', 'foods.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png', 'fonts/space-grotesk.woff2', 'fonts/space-mono-400.woff2', 'fonts/space-mono-700.woff2'];

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
  // a picture shared to the app from another app (Share image → Attention)
  if (e.request.method === 'POST' && /\/share-target\/?$/.test(new URL(e.request.url).pathname)) {
    e.respondWith(e.request.formData().then(function (f) {
      var file = f.get('image');
      return caches.open('attention-data').then(function (c) {
        return file && file.size ? c.put('shared-image', new Response(file, { headers: { 'Content-Type': file.type || 'image/jpeg' } })) : null;
      });
    }).catch(function () {}).then(function () { return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303); }));
    return;
  }
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  var url = new URL(e.request.url);
  var fresh = function () {
    return fetch(e.request, { cache: 'no-cache' }).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
      return res;
    });
  };
  // data that changes (anything with ?query): network first
  if (url.search && url.search !== '?') {
    e.respondWith(fresh().catch(function () { return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); }); }));
    return;
  }
  // the app itself: open instantly from the phone, refresh the copy in the background for next time
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request).then(function (hit) {
      var net = fresh();
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net.catch(function () { return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); }); });
    });
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
      var goalOn = !d.kind && g && g.text && g.day === today, many = g && g.n > 1;
      if (goalOn) body += '\n' + (many ? 'Open targets: ' : 'Today’s target: ') + g.text;
      return self.registration.showNotification(d.title || 'Pause for a minute', {
        actions: goalOn ? [{ action: 'goal', title: many ? 'Update targets' : 'Update target' }].concat(many ? [] : [{ action: 'win', title: 'Target hit ✓' }]) : [],
        body: body,
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        tag: d.kind === 'goal' ? 'attention-goal' : d.kind === 'move' ? 'attention-move' : d.kind === 'night' ? 'attention-night' : d.kind === 'breath' ? 'attention-breath' : 'attention-ping',
        renotify: true,
        vibrate: [120, 80, 120],
        data: { url: d.url || './?checkin=1' }
      });
    }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var rel = e.action === 'win' ? './?goal=1&win=1' : e.action === 'goal' ? './?goal=1' : ((e.notification.data && e.notification.data.url) || './?checkin=1');
  var url = new URL(rel, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) {
        list[i].postMessage({ type: url.indexOf('goal=1') >= 0 ? 'goal' : url.indexOf('move=') >= 0 ? 'move' : url.indexOf('tonight=1') >= 0 ? 'tonight' : url.indexOf('breathe=1') >= 0 ? 'breathe' : 'checkin', url: url });
        return list[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
