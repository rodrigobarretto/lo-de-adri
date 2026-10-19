// =====================================================================
//  PUESTO DE DIARIOS — sw.js (service worker)
//  Regla: con internet SIEMPRE trae la versión nueva de la app.
//  Sin internet, muestra la última versión guardada.
//  Cada vez que subas cambios, aumentá VERSION.
// =====================================================================

const VERSION = 'puesto-v20';
const ARCHIVOS_APP = ['./', './index.html', './app.js', './titulos.js', './manifest.json', './icon-192.png', './icon-512.png', './logo.png', './apple-touch-icon.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ARCHIVOS_APP)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);

  // Datos y fotos de Supabase: nunca se cachean acá (siempre frescos)
  if (url.hostname.endsWith('supabase.co')) return;

  // Archivos propios de la app: primero la red, si falla la copia guardada
  if (url.origin === self.location.origin) {
    evento.respondWith(
      fetch(pedido, { cache: 'no-store' })
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(VERSION).then((cache) => cache.put(pedido, copia));
          }
          return respuesta;
        })
        .catch(() =>
          caches.match(pedido, { ignoreSearch: true })
            .then((r) => r || caches.match('./index.html'))
        )
    );
    return;
  }

  // Librerías externas (supabase-js): copia guardada y se actualiza en segundo plano
  evento.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(pedido).then((guardado) => {
        const deRed = fetch(pedido)
          .then((respuesta) => {
            if (respuesta.ok) cache.put(pedido, respuesta.clone());
            return respuesta;
          })
          .catch(() => guardado);
        return guardado || deRed;
      })
    )
  );
});
