// ═══════════════════════════════════════════════
//  COGESA Presenze — Service Worker PWA
//  Offline-first: cache statica + network fallback
// ═══════════════════════════════════════════════

const CACHE_NAME    = 'cogesa-v1';
const CACHE_TIMEOUT = 5000; // ms prima di usare cache

// Risorse da cachare subito all'installazione
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // CDN esterni
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// ── INSTALL: precache tutto ──────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching risorse...');
      // Cache una per una per non bloccare su CDN lente
      return Promise.allSettled(
        PRECACHE.map(url => cache.add(url).catch(err => console.warn('[SW] Skip cache:', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: pulisci cache vecchie ─────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Elimino cache vecchia:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first con fallback cache ──────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Le chiamate Supabase NON passano per cache (sempre network)
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response(
      JSON.stringify({ error: 'offline' }),
      { headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  // Tutto il resto: network-first con timeout → fallback cache
  e.respondWith(
    Promise.race([
      fetch(e.request).then(response => {
        // Aggiorna cache con risposta fresca
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CACHE_TIMEOUT))
    ]).catch(() => {
      console.log('[SW] Offline → uso cache per:', e.request.url);
      return caches.match(e.request).then(cached => {
        if (cached) return cached;
        // Fallback finale per navigazione
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ── SYNC: ricevi evento sync da background ───────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-firme') {
    console.log('[SW] Background sync firme...');
    // La sync vera avviene nell'app — qui notifichiamo solo
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_REQUEST' }))
      )
    );
  }
});
