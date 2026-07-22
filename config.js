// ==== GANTI DENGAN URL WEB APP APPS SCRIPT KAMU (lihat apps-script/SETUP.md) ====
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbywCmiYQvS4FAVERFpdYZoEzcNHHcRdb6nYjbY_tMxPPJoStJq-CcxPyduHIXFRSLWCaA/exec';

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
