// ==== GANTI DENGAN URL WEB APP APPS SCRIPT KAMU (lihat apps-script/SETUP.md) ====
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyADHTvQfarDt-9L7IMSfsG8PN4IbycX-1ZIA2CnMZ3RrKpw4kqHa8ei6TmGlijp-ng2w/exec';

const TOKEN_KEY = 'absensi_token';
const ROLE_KEY = 'absensi_role';
const NAMA_KEY = 'absensi_nama';

/**
 * GET request ke Apps Script (dipakai untuk operasi baca yang TIDAK butuh
 * token, mis. 'ping'). Semua action yang butuh token kini lewat apiPost --
 * jangan taruh { token } di params di sini, karena akan ikut ke query string
 * URL (lihat SETUP.md/README untuk alasannya).
 */
async function apiGet(action, params = {}) {
  const query = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${APPS_SCRIPT_URL}?${query}`, { method: 'GET' });
  return res.json();
}

/**
 * POST request ke Apps Script (dipakai untuk operasi tulis/aksi).
 * PENTING: Content-Type harus 'text/plain' agar browser tidak mengirim
 * preflight OPTIONS request, karena Apps Script tidak menangani OPTIONS.
 */
async function apiPost(action, data = {}) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...data }),
  });
  return res.json();
}

// ===== CACHING (BARU: mempercepat loading berulang) =====
// Data hasil apiPost disimpan di localStorage selama `duration` ms, jadi
// saat halaman dibuka lagi, data tampil instan sambil update di background.
const CACHE_DURATIONS = {
  cache_overview_v2: 5 * 60 * 1000,        // 5 menit
  cache_siswa_list: 30 * 60 * 1000,     // 30 menit
  cache_kelas_list: 60 * 60 * 1000,     // 1 jam
  cache_rekap_bulanan: 10 * 60 * 1000,  // 10 menit
  cache_riwayat_siswa: 5 * 60 * 1000,   // 5 menit
};

function getCached(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    const duration = CACHE_DURATIONS[key] || 5 * 60 * 1000;
    if (Date.now() - timestamp > duration) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (err) {
    return null;
  }
}

function setCached(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (err) {
    // localStorage penuh/disabled -- abaikan, tidak fatal
  }
}

function clearAllCache() {
  Object.keys(CACHE_DURATIONS).forEach(k => localStorage.removeItem(k));
}

/**
 * apiPost dengan cache: kalau ada data cache yang masih valid, dikembalikan
 * langsung (instan), lalu tetap fetch data terbaru di background dan
 * panggil onFresh(res) begitu selesai supaya UI bisa update diam-diam.
 */
async function apiPostCached(action, data, cacheKey, onFresh) {
  const cached = cacheKey ? getCached(cacheKey) : null;

  const freshPromise = apiPost(action, data).then(res => {
    if (res.ok && cacheKey) setCached(cacheKey, res);
    if (onFresh) onFresh(res);
    return res;
  });

  if (cached) return cached;
  return freshPromise;
}

function saveSession(token, role, nama) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
  localStorage.setItem(NAMA_KEY, nama);
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getRole() {
  return localStorage.getItem(ROLE_KEY);
}

function getNama() {
  return localStorage.getItem(NAMA_KEY);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(NAMA_KEY);
  clearAllCache();
}

/**
 * Jaga halaman: redirect ke login jika belum ada session atau role tidak cocok.
 * PERUBAHAN: dulu memanggil apiGet('checkSession', {token}) sehingga token
 * ikut nampang di query string setiap kali halaman dimuat. Sekarang lewat
 * apiPost supaya token ada di body request, bukan di URL.
 */
async function guardPage(requiredRole) {
  const token = getToken();
  if (!token) {
    window.location.href = 'index.html';
    return null;
  }
  const check = await apiPost('checkSession', { token });
  if (!check.ok || check.role !== requiredRole) {
    clearSession();
    window.location.href = 'index.html';
    return null;
  }
  return check;
}
