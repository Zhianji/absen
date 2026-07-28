// Service Worker - Absensi Digital
// Cache file statis (HTML/CSS/JS) supaya kunjungan berikutnya load instan.
// API call ke Apps Script TIDAK di-cache di sini (biar data selalu fresh);
// caching data API sudah ditangani lewat localStorage di config.js.

// PENTING: setiap kali file di STATIC_FILES berubah (dashboard-guru-enhanced.html,
// config.js, dll), CACHE_NAME WAJIB diganti (mis. v1 -> v2). Tanpa ini, browser
// yang sudah pernah membuka situs akan TERUS mendapat versi lama dari cache SW
// selamanya, walaupun kode baru sudah live di Vercel -- activate() di bawah cuma
// menghapus cache dengan nama BEDA dari CACHE_NAME saat ini, jadi kalau namanya
// tidak berubah, SW menganggap tidak ada yang perlu di-refresh.
const CACHE_NAME = 'absensi-static-v2';

const STATIC_FILES = [
  'index.html',
  'style.css',
  'config.js',
  'dashboard-guru-enhanced.html',
  'absen-siswa.html',
  'admin.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll akan gagal semua kalau salah satu 404, jadi tambahkan satu-satu
      return Promise.all(
        STATIC_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] gagal cache:', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Jangan cache request ke Apps Script (data harus selalu fresh dari network)
  if (url.hostname.includes('script.google.com')) return;

  // Strategy: stale-while-revalidate untuk file statis & font
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline -> pakai cache kalau ada

      // Tampilkan versi cache dulu (instan) kalau ada, update di belakang layar
      return cached || fetchPromise;
    })
  );
});
