// v3: navigations are no longer cached (see the fetch handler). The rename is
// what evicts the signed-in pages v2 already wrote to disk — 'activate' deletes
// every cache that isn't the current name.
const CACHE_NAME = 'finance-tracker-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API routes — finance data must always be fresh
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: network-first, falling back to the app shell when
  // offline.
  //
  // The response itself is deliberately NOT cached. These are the signed-in
  // pages — a transaction list, a balance, an account name — and Cache Storage
  // is on disk, unencrypted, outside the session: it survives sign-out, and
  // the next person to open the browser on a shared machine can read what was
  // cached there. The shell cached at install ('/') is what offline needs, and
  // it carries nobody's data.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  // Static assets: cache-first with network fallback.
  // _next/static URLs are content-hashed, so cache-first is safe across deploys.
  // We deliberately do NOT match a bare `.js` suffix — that would catch /sw.js
  // and any non-hashed scripts and pin them to a stale chunk graph.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.css')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
      )
    );
    return;
  }
});

// ─── Push notifications ──────────────────────────────────────────────────────
// The server sends { title, body, url, tag } (see src/lib/notifications). A
// payload that can't be read still shows something: browsers penalise a push
// that doesn't end in a visible notification.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'FinTrack';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-maskable-192x192.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      data: { url: typeof data.url === 'string' ? data.url : '/' },
    })
  );
});

// Open the page the notification is about: reuse a FinTrack window if one is
// open, otherwise start the app there. Only same-origin paths are followed.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(raw, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        return open.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : undefined));
      }
      return self.clients.openWindow(url);
    })
  );
});

// The push service rotated this browser's subscription: register the new one
// (same server key) and drop the old, so notifications keep arriving.
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  const key = old && old.options ? old.options.applicationServerKey : null;
  if (!key) return;
  event.waitUntil(
    (event.newSubscription
      ? Promise.resolve(event.newSubscription)
      : self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    ).then((sub) =>
      fetch('/api/notifications/devices', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      }).then(() =>
        fetch('/api/notifications/devices', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: old.endpoint }),
        })
      )
    ).catch(() => {})
  );
});
