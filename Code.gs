/**
 * ABSENSI WEB SERVICE - Backend (Google Apps Script)
 * ---------------------------------------------------
 * Deploy: Extensions > Apps Script (di Spreadsheet) > Deploy > New deployment
 *         Type: Web app | Execute as: Me | Who has access: Anyone
 *
 * Struktur Sheet (dibuat otomatis oleh setupSheets()):
 *   Guru     : id | username | password_hash | nama
 *   Siswa    : id | nis | password_hash | nama | kelas
 *   Absensi  : id | siswa_id | nama_siswa | kelas | mapel | tanggal | waktu | status
 *   Sessions : token | user_id | role | nama | expires_at
 *
 * CATATAN PERUBAHAN KEAMANAN/PERFORMA:
 * - password_hash sekarang berformat "salt:hash" (SHA-256 dari salt+password),
 *   bukan hash polos. Lihat makePasswordHash() / verifyPassword(). Akun yang
 *   dibuat oleh setupSheets() versi ini sudah pakai format baru. Kalau sheet
 *   Guru/Siswa kamu masih berisi hash lama (tanpa "salt:" di depan, dari versi
 *   sebelumnya), reset password akun tersebut lewat updateSiswa/createSiswa
 *   (atau edit manual admin) supaya ikut ter-migrasi ke format baru.
 * - Login (guru & siswa) sekarang dibatasi (rate limit) memakai CacheService:
 *   5 kali gagal berturut-turut untuk identitas yang sama akan diblokir
 *   sementara (5 menit) sebelum bisa mencoba lagi.
 * - Semua action yang butuh token (checkSession, getSiswaList, getLaporan,
 *   getAbsensiHariIni) dulu dilayani lewat doGet dengan token di query
 *   string. Sekarang HANYA lewat doPost (token di body) -- lihat catatan
 *   di doGet(). Frontend (config.js, absen-siswa.html, dashboard-guru.html)
 *   sudah disesuaikan memakai apiPost untuk action-action ini.
 */

// ============ KONFIGURASI ============
const SHEET_GURU = 'Guru';
const SHEET_SISWA = 'Siswa';
const SHEET_ABSENSI = 'Absensi';
const SHEET_SESSIONS = 'Sessions';
const MAPEL_LIST = ['TIK', 'KKA'];
const STATUS_LIST = ['Hadir', 'Izin', 'Sakit', 'Alfa'];
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 jam

// ============ SETUP (jalankan manual sekali dari editor Apps Script) ============
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const guru = ss.getSheetByName(SHEET_GURU) || ss.insertSheet(SHEET_GURU);
  guru.clear();
  guru.appendRow(['id', 'username', 'password_hash', 'nama']);
  guru.appendRow(['1', 'admin', makePasswordHash('admin123'), 'Guru Admin']);

  const siswa = ss.getSheetByName(SHEET_SISWA) || ss.insertSheet(SHEET_SISWA);
  siswa.clear();
  siswa.appendRow(['id', 'nis', 'password_hash', 'nama', 'kelas']);

  const absensi = ss.getSheetByName(SHEET_ABSENSI) || ss.insertSheet(SHEET_ABSENSI);
  absensi.clear();
  absensi.appendRow(['id', 'siswa_id', 'nama_siswa', 'kelas', 'mapel', 'tanggal', 'waktu', 'status']);

  const sessions = ss.getSheetByName(SHEET_SESSIONS) || ss.insertSheet(SHEET_SESSIONS);
  sessions.clear();
  sessions.appendRow(['token', 'user_id', 'role', 'nama', 'expires_at']);

  Logger.log('Setup selesai. Login guru default -> username: admin / password: admin123 (SEGERA GANTI).');
}

// ============ ENTRY POINTS ============
// PERUBAHAN: dulu checkSession, getSiswaList, getLaporan, dan getAbsensiHariIni
// dilayani lewat doGet dengan token di query string (?token=...). Token di URL
// berisiko bocor lewat log eksekusi Apps Script (tercatat di sana untuk siapa
// pun yang punya akses editor project), riwayat browser, atau header Referer.
// Semua action yang butuh token sekarang HANYA dilayani lewat doPost (token di
// body request, seperti checkin/login yang sudah begitu sejak awal). doGet
// disisakan hanya untuk 'ping' yang memang tidak butuh autentikasi.
function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;
    switch (action) {
      case 'ping':
        result = { ok: true, message: 'pong' };
        break;
      default:
        result = { ok: false, error: 'Action "' + action + '" harus dipanggil lewat POST, bukan GET.' };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;
    switch (action) {
      case 'loginGuru':
        result = loginGuru(body.username, body.password);
        break;
      case 'loginSiswa':
        result = loginSiswa(body.nis, body.password);
        break;
      case 'logout':
        result = logout(body.token);
        break;
      case 'checkSession':
        result = handleCheckSession(body.token);
        break;
      case 'checkin':
        result = requireRole(body.token, 'siswa', (session) => checkin(session, body.mapel));
        break;
      case 'getAbsensiHariIni':
        result = requireRole(body.token, 'siswa', (session) => getAbsensiHariIni(session.user_id));
        break;
      case 'getSiswaList':
        result = requireRole(body.token, 'guru', () => getSiswaList(body.kelas));
        break;
      case 'getStatusHarian':
        result = requireRole(body.token, 'guru', () => getStatusHarian(body.kelas, body.mapel, body.tanggal));
        break;
      case 'setAbsensiStatus':
        result = requireRole(body.token, 'guru', (session) =>
          setAbsensiStatus(session, body.siswa_id, body.mapel, body.tanggal, body.status)
        );
        break;
      case 'getLaporan':
        result = requireRole(body.token, 'guru', () =>
          getLaporan(body.tanggal_mulai, body.tanggal_selesai, body.kelas, body.mapel)
        );
        break;
      case 'createSiswa':
        result = requireRole(body.token, 'guru', () => createSiswa(body.nis, body.nama, body.kelas, body.password));
        break;
      case 'importSiswaBulk':
        result = requireRole(body.token, 'guru', () => importSiswaBulk(body.items));
        break;
      case 'updateSiswa':
        result = requireRole(body.token, 'guru', () =>
          updateSiswa(body.id, body.nis, body.nama, body.kelas, body.password)
        );
        break;
      case 'deleteSiswa':
        result = requireRole(body.token, 'guru', () => deleteSiswa(body.id));
        break;
      case 'getGuruList':
        result = requireRole(body.token, 'guru', () => getGuruList());
        break;
      case 'createGuru':
        result = requireRole(body.token, 'guru', () => createGuru(body.username, body.password, body.nama));
        break;
      case 'updateGuru':
        result = requireRole(body.token, 'guru', (session) => updateGuru(session, body.id, body.username, body.nama));
        break;
      case 'resetGuruPassword':
        result = requireRole(body.token, 'guru', (session) => resetGuruPassword(session, body.id, body.password));
        break;
      case 'deleteGuru':
        result = requireRole(body.token, 'guru', (session) => deleteGuru(session, body.id));
        break;
      case 'changeOwnPassword':
        result = requireRole(body.token, 'guru', (session) => changeOwnPassword(session, body.old_password, body.new_password));
        break;
      default:
        result = { ok: false, error: 'Action tidak dikenal: ' + action };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ============ AUTH ============
function loginGuru(username, password) {
  if (!username || !password) return { ok: false, error: 'Username dan password wajib diisi' };

  const rateLimitId = 'guru_' + String(username).trim().toLowerCase();
  if (!checkRateLimit(rateLimitId)) {
    return { ok: false, error: 'Terlalu banyak percobaan login gagal. Coba lagi dalam beberapa menit.' };
  }

  const sheet = getSheet(SHEET_GURU);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [id, u, hash, nama] = rows[i];
    if (String(u) === String(username) && verifyPassword(password, hash)) {
      clearFailedLogin(rateLimitId);
      const token = createSession(id, 'guru', nama);
      return { ok: true, token: token, nama: nama, role: 'guru' };
    }
  }
  recordFailedLogin(rateLimitId);
  return { ok: false, error: 'Username atau password salah' };
}

function loginSiswa(nis, password) {
  if (!nis || !password) return { ok: false, error: 'NIS dan password wajib diisi' };

  const rateLimitId = 'siswa_' + String(nis).trim();
  if (!checkRateLimit(rateLimitId)) {
    return { ok: false, error: 'Terlalu banyak percobaan login gagal. Coba lagi dalam beberapa menit.' };
  }

  const sheet = getSheet(SHEET_SISWA);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [id, rowNis, hash, nama, kelas] = rows[i];
    if (String(rowNis) === String(nis) && verifyPassword(password, hash)) {
      clearFailedLogin(rateLimitId);
      const token = createSession(id, 'siswa', nama);
      return { ok: true, token: token, nama: nama, kelas: kelas, role: 'siswa' };
    }
  }
  recordFailedLogin(rateLimitId);
  return { ok: false, error: 'NIS atau password salah' };
}

function logout(token) {
  const sheet = getSheet(SHEET_SESSIONS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

function createSession(userId, role, nama) {
  const token = Utilities.getUuid();
  const expiresAt = new Date().getTime() + SESSION_DURATION_MS;
  getSheet(SHEET_SESSIONS).appendRow([token, userId, role, nama, expiresAt]);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sheet = getSheet(SHEET_SESSIONS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [t, userId, role, nama, expiresAt] = rows[i];
    if (t === token) {
      if (new Date().getTime() > Number(expiresAt)) {
        sheet.deleteRow(i + 1); // bersihkan session basi saat ketemu, biar sheet tidak membengkak
        return null;
      }
      return { user_id: userId, role: role, nama: nama, rowIndex: i + 1 };
    }
  }
  return null;
}

/**
 * Hapus semua session yang sudah kadaluarsa. Sheet "Sessions" hanya
 * dibersihkan otomatis untuk token yang sedang dicek (lazy, di getSession),
 * jadi token yang ditinggal begitu saja (browser ditutup tanpa logout)
 * tetap menumpuk dan lama-lama memperlambat SEMUA request berbasis login.
 * Jalankan fungsi ini manual dari editor, atau pasang time-based trigger
 * (Triggers > Add Trigger > cleanupExpiredSessions > Time-driven > Daily).
 */
function cleanupExpiredSessions() {
  const sheet = getSheet(SHEET_SESSIONS);
  const rows = sheet.getDataRange().getValues();
  const now = new Date().getTime();
  let deleted = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (now > Number(rows[i][4])) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  Logger.log(deleted + ' session kadaluarsa dihapus.');
  return deleted;
}

function handleCheckSession(token) {
  const session = getSession(token);
  if (!session) return { ok: false, error: 'Session tidak valid atau kadaluarsa' };
  return { ok: true, role: session.role, nama: session.nama, user_id: session.user_id };
}

// Menjalankan fn hanya jika token valid dan role sesuai. fn menerima (session).
function requireRole(token, role, fn) {
  const session = getSession(token);
  if (!session) return { ok: false, error: 'Session tidak valid atau kadaluarsa, silakan login ulang' };
  if (session.role !== role) return { ok: false, error: 'Akses ditolak untuk role ini' };
  return fn(session);
}

/**
 * Normalisasi nilai kolom "tanggal" dari Sheet ke string "yyyy-MM-dd".
 *
 * Meskipun tanggal ditulis sebagai string "yyyy-MM-dd" saat appendRow,
 * Google Sheets otomatis mendeteksi pola tanggal itu dan mengonversi sel
 * menjadi objek Date asli. Akibatnya getValues() bisa mengembalikan Date
 * ATAU string tergantung histori sel tsb. Semua perbandingan tanggal harus
 * lewat fungsi ini dulu supaya konsisten -- tanpanya, Date dibandingkan
 * dengan string via ===/</> selalu bernilai salah (silent bug).
 */
function normalizeTanggal(value) {
  if (value instanceof Date) {
    const tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  return String(value || '').trim();
}

// ============ CHECK-IN SISWA ============
function checkin(session, mapel) {
  if (MAPEL_LIST.indexOf(mapel) === -1) {
    return { ok: false, error: 'Mata pelajaran tidak valid. Pilih TIK atau KKA.' };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // tunggu maksimal 15 detik jika ada proses lain
  } catch (e) {
    return { ok: false, error: 'Server sibuk, silakan coba lagi.' };
  }

  try {
    const tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
    const now = new Date();
    const tanggal = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const waktu = Utilities.formatDate(now, tz, 'HH:mm:ss');

    const absensiSheet = getSheet(SHEET_ABSENSI);
    const existing = findAbsensiHariIni(absensiSheet, session.user_id, mapel, tanggal);
    if (existing) {
      return { ok: false, error: 'Kamu sudah check-in untuk ' + mapel + ' hari ini pukul ' + existing.waktu };
    }

    const siswaData = getSiswaById(session.user_id);
    const kelas = siswaData ? siswaData.kelas : '';
    const nama = siswaData ? siswaData.nama : session.nama;
    const newId = Utilities.getUuid();

    absensiSheet.appendRow([newId, session.user_id, nama, kelas, mapel, tanggal, waktu, 'Hadir']);
    return { ok: true, message: 'Check-in ' + mapel + ' berhasil pukul ' + waktu, tanggal: tanggal, waktu: waktu };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cek apakah siswa sudah check-in untuk mapel+tanggal tertentu.
 *
 * Versi sebelumnya membaca SELURUH sheet Absensi (getDataRange) di dalam
 * lock global setiap kali ada yang check-in. Itu berarti: (1) semua siswa
 * lain ikut antre menunggu lock selama pembacaan itu berlangsung, dan
 * (2) makin banyak riwayat absensi menumpuk sepanjang tahun ajaran, makin
 * lambat SETIAP check-in -- termasuk punya siswa yang baru pertama kali
 * absen hari itu.
 *
 * Perbaikan di sini memakai TextFinder untuk mencari baris milik siswa ini
 * SAJA di kolom siswa_id (pencarian dijalankan di sisi server Sheets, bukan
 * loop JS di atas seluruh data), lalu hanya baris yang cocok itu yang benar-
 * benar dibaca detail kolomnya. Untuk satu siswa, jumlah baris historisnya
 * jauh lebih kecil daripada total baris seluruh sekolah, jadi ini jauh lebih
 * ringan -- terutama begitu data absensi sudah menumpuk berbulan-bulan.
 *
 * Catatan: ini bukan index database sungguhan (Apps Script/Sheets memang
 * tidak punya itu), jadi untuk sekolah yang SANGAT besar dengan histori
 * bertahun-tahun tanpa pernah diarsipkan, pertimbangkan memisahkan sheet
 * Absensi per bulan/semester supaya sheet aktif tetap kecil.
 */
function findAbsensiHariIni(sheet, siswaId, mapel, tanggal) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const finder = sheet.getRange('B2:B' + lastRow).createTextFinder(String(siswaId)).matchEntireCell(true);
  const matches = finder.findAll();

  for (let i = 0; i < matches.length; i++) {
    const row = matches[i].getRow();
    const [rowMapel, rowTanggal, rowWaktu] = sheet.getRange(row, 5, 1, 3).getValues()[0]; // mapel, tanggal, waktu
    if (rowMapel === mapel && normalizeTanggal(rowTanggal) === tanggal) {
      return { waktu: rowWaktu };
    }
  }
  return null;
}

function getAbsensiHariIni(siswaId) {
  const tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  const tanggal = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const rows = getSheet(SHEET_ABSENSI).getDataRange().getValues();
  const status = {};
  MAPEL_LIST.forEach((m) => (status[m] = null));
  for (let i = 1; i < rows.length; i++) {
    const [, siswaIdRow, , , mapel, rowTanggal, waktu] = rows[i];
    if (String(siswaIdRow) === String(siswaId) && normalizeTanggal(rowTanggal) === tanggal) {
      status[mapel] = waktu;
    }
  }
  return { ok: true, tanggal: tanggal, status: status };
}

/**
 * Sama seperti findAbsensiHariIni, tapi mengembalikan nomor baris (bukan
 * cuma waktu) dan status saat ini -- dipakai setAbsensiStatus() untuk tahu
 * apakah harus UPDATE baris yang sudah ada (mis. siswa sudah check-in Hadir
 * sendiri) atau APPEND baris baru (siswa belum pernah tercatat sama sekali
 * untuk mapel+tanggal itu).
 */
function findAbsensiRow(sheet, siswaId, mapel, tanggal) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const finder = sheet.getRange('B2:B' + lastRow).createTextFinder(String(siswaId)).matchEntireCell(true);
  const matches = finder.findAll();

  for (let i = 0; i < matches.length; i++) {
    const row = matches[i].getRow();
    const [rowMapel, rowTanggal, rowWaktu, rowStatus] = sheet.getRange(row, 5, 1, 4).getValues()[0]; // mapel, tanggal, waktu, status
    if (rowMapel === mapel && normalizeTanggal(rowTanggal) === tanggal) {
      return { row: row, waktu: rowWaktu, status: rowStatus };
    }
  }
  return null;
}

/**
 * Guru menandai/mengoreksi status kehadiran siswa secara manual (Izin, Sakit,
 * Alfa -- atau koreksi balik ke Hadir kalau salah tandai). Ini melengkapi
 * checkin(), yang HANYA bisa mencatat "Hadir" dan cuma bisa dipanggil siswa
 * yang bersangkutan untuk tanggal hari itu sendiri.
 *
 * - Kalau baris Absensi utk siswa+mapel+tanggal itu SUDAH ada (mis. siswa
 *   sudah check-in Hadir lewat absen-siswa.html), statusnya DIGANTI di
 *   tempat -- tidak membuat baris duplikat.
 * - Kalau belum ada baris sama sekali (siswa tidak check-in), baris baru
 *   dibuat dengan kolom "waktu" kosong, karena ini bukan check-in nyata.
 * - Pakai LockService yang sama dengan checkin() supaya tidak balapan kalau
 *   siswa kebetulan check-in sendiri persis saat guru menandainya.
 */
function setAbsensiStatus(session, siswaId, mapel, tanggal, status) {
  if (!siswaId || !mapel || !tanggal || !status) {
    return { ok: false, error: 'Data tidak lengkap' };
  }
  if (MAPEL_LIST.indexOf(mapel) === -1) {
    return { ok: false, error: 'Mata pelajaran tidak valid' };
  }
  if (STATUS_LIST.indexOf(status) === -1) {
    return { ok: false, error: 'Status tidak valid. Pilih Hadir, Izin, Sakit, atau Alfa.' };
  }
  const tanggalNorm = normalizeTanggal(tanggal);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalNorm)) {
    return { ok: false, error: 'Format tanggal tidak valid' };
  }

  const siswaData = getSiswaById(siswaId);
  if (!siswaData) return { ok: false, error: 'Siswa tidak ditemukan' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { ok: false, error: 'Server sibuk, silakan coba lagi.' };
  }

  try {
    const sheet = getSheet(SHEET_ABSENSI);
    const existing = findAbsensiRow(sheet, siswaId, mapel, tanggalNorm);
    if (existing) {
      sheet.getRange(existing.row, 8).setValue(status); // kolom H = status
    } else {
      const newId = Utilities.getUuid();
      sheet.appendRow([newId, siswaId, siswaData.nama, siswaData.kelas, mapel, tanggalNorm, '', status]);
    }
    return { ok: true, message: 'Status ' + siswaData.nama + ' (' + mapel + ') diset menjadi ' + status };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Rekap status kehadiran satu kelas untuk satu mapel+tanggal. Beda dengan
 * getLaporan() (yang cuma menampilkan baris yang SUDAH ada di Absensi),
 * fungsi ini menggabungkan seluruh roster Siswa dengan baris Absensi yang
 * cocok -- jadi guru bisa lihat siapa saja yang BELUM tercatat sama sekali
 * (status null) dan menandainya lewat setAbsensiStatus().
 */
function getStatusHarian(kelas, mapel, tanggal) {
  if (MAPEL_LIST.indexOf(mapel) === -1) return { ok: false, error: 'Mata pelajaran tidak valid' };
  const tanggalNorm = normalizeTanggal(tanggal);

  const siswaRows = getSheet(SHEET_SISWA).getDataRange().getValues();
  const roster = [];
  for (let i = 1; i < siswaRows.length; i++) {
    const [id, , , nama, rowKelas] = siswaRows[i];
    if (!kelas || kelas === rowKelas) roster.push({ id: id, nama: nama, kelas: rowKelas });
  }

  const absensiRows = getSheet(SHEET_ABSENSI).getDataRange().getValues();
  const statusById = {};
  for (let i = 1; i < absensiRows.length; i++) {
    const [, siswaId, , , rowMapel, rowTanggal, waktu, status] = absensiRows[i];
    if (rowMapel === mapel && normalizeTanggal(rowTanggal) === tanggalNorm) {
      statusById[siswaId] = { status: status, waktu: waktu };
    }
  }

  const data = roster
    .map((s) => ({
      siswa_id: s.id,
      nama: s.nama,
      kelas: s.kelas,
      status: statusById[s.id] ? statusById[s.id].status : null,
      waktu: statusById[s.id] ? statusById[s.id].waktu : null,
    }))
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));

  return { ok: true, tanggal: tanggalNorm, mapel: mapel, data: data };
}

// ============ CRUD SISWA (guru) ============
function getSiswaList(kelasFilter) {
  const rows = getSheet(SHEET_SISWA).getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const [id, nis, , nama, kelas] = rows[i];
    if (!kelasFilter || kelasFilter === kelas) {
      list.push({ id: id, nis: nis, nama: nama, kelas: kelas });
    }
  }
  return { ok: true, data: list };
}

function getSiswaById(id) {
  const rows = getSheet(SHEET_SISWA).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      return { id: rows[i][0], nis: rows[i][1], nama: rows[i][3], kelas: rows[i][4] };
    }
  }
  return null;
}

function createSiswa(nis, nama, kelas, password) {
  if (!nis || !nama || !kelas || !password) return { ok: false, error: 'Semua field wajib diisi' };
  const sheet = getSheet(SHEET_SISWA);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(nis)) return { ok: false, error: 'NIS sudah terdaftar' };
  }
  const id = Utilities.getUuid();
  sheet.appendRow([id, nis, makePasswordHash(password), nama, kelas]);
  return { ok: true, id: id };
}

/**
 * Import banyak siswa sekaligus dari CSV (dikirim frontend sebagai array item).
 * Sengaja pakai SATU batch read (cek duplikat) + SATU batch write (setValues),
 * bukan appendRow per baris, supaya import 50-100 siswa tidak jadi 50-100
 * operasi Sheets API terpisah yang lambat.
 */
function importSiswaBulk(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Tidak ada data untuk diimport' };
  }
  if (items.length > 500) {
    return { ok: false, error: 'Maksimal 500 baris per import, pecah jadi beberapa file.' };
  }

  const sheet = getSheet(SHEET_SISWA);
  const existingRows = sheet.getDataRange().getValues();
  const existingNis = new Set();
  for (let i = 1; i < existingRows.length; i++) existingNis.add(String(existingRows[i][1]));

  const toAppend = [];
  const results = [];
  const seenInBatch = new Set();

  items.forEach((item, idx) => {
    const nis = String(item.nis || '').trim();
    const nama = String(item.nama || '').trim();
    const kelas = String(item.kelas || '').trim();
    const password = String(item.password || '').trim();

    if (!nis || !nama || !kelas || !password) {
      results.push({ index: idx, nis: nis, ok: false, error: 'Ada kolom kosong' });
      return;
    }
    if (existingNis.has(nis)) {
      results.push({ index: idx, nis: nis, ok: false, error: 'NIS sudah terdaftar di sistem' });
      return;
    }
    if (seenInBatch.has(nis)) {
      results.push({ index: idx, nis: nis, ok: false, error: 'NIS duplikat di dalam file' });
      return;
    }
    seenInBatch.add(nis);
    const id = Utilities.getUuid();
    toAppend.push([id, nis, makePasswordHash(password), nama, kelas]);
    results.push({ index: idx, nis: nis, nama: nama, kelas: kelas, ok: true, id: id });
  });

  if (toAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, 5).setValues(toAppend);
  }

  const successCount = results.filter((r) => r.ok).length;
  return { ok: true, total: items.length, success: successCount, failed: items.length - successCount, results: results };
}

function updateSiswa(id, nis, nama, kelas, password) {
  const sheet = getSheet(SHEET_SISWA);
  const rows = sheet.getDataRange().getValues();

  let targetIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) return { ok: false, error: 'Siswa tidak ditemukan' };

  // Dulu fungsi ini tidak mengecek NIS duplikat sama sekali (beda dengan
  // createSiswa), sehingga NIS seorang siswa bisa diubah menjadi sama
  // dengan siswa lain -- akibatnya login siswa jadi ambigu karena
  // loginSiswa() memakai NIS pertama yang cocok di sheet.
  if (nis && String(nis) !== String(rows[targetIndex][1])) {
    for (let i = 1; i < rows.length; i++) {
      if (i !== targetIndex && String(rows[i][1]) === String(nis)) {
        return { ok: false, error: 'NIS sudah dipakai siswa lain' };
      }
    }
  }

  const r = targetIndex + 1;
  if (nis) sheet.getRange(r, 2).setValue(nis);
  if (password) sheet.getRange(r, 3).setValue(makePasswordHash(password));
  if (nama) sheet.getRange(r, 4).setValue(nama);
  if (kelas) sheet.getRange(r, 5).setValue(kelas);
  return { ok: true };
}

function deleteSiswa(id) {
  const sheet = getSheet(SHEET_SISWA);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Siswa tidak ditemukan' };
}

// ============ MANAJEMEN AKUN GURU/ADMIN (guru) ============
// Halaman admin.html memakai action-action ini untuk mengelola akun Guru/Admin
// (yang sebelumnya cuma bisa dibuat sekali lewat setupSheets() atau edit
// manual Sheet). Catatan keamanan:
// - Password akun admin pakai skema hash yang sama dengan siswa (SHA-256 +
//   salt per-user, lihat makePasswordHash/verifyPassword) -- bukan sistem
//   terpisah yang lebih lemah.
// - Reset password admin LAIN (resetGuruPassword) sengaja TIDAK butuh
//   password lama -- ini memang wewenang admin yang sudah login (sama
//   seperti guru mereset password siswa lewat updateSiswa). Tapi ganti
//   password AKUN SENDIRI (changeOwnPassword) WAJIB konfirmasi password
//   lama dulu, supaya token/sesi yang "nyasar" (lupa logout di komputer
//   bersama, atau token dicuri) tidak otomatis bisa mengambil alih akun
//   hanya bermodal token -- tanpa tahu password aslinya, self password
//   change akan ditolak.
// - Admin tidak bisa menghapus akun sendiri saat sedang login (mencegah
//   kunci-diri-sendiri secara tidak sengaja), dan tidak bisa menghapus
//   admin terakhir yang tersisa (mencegah sistem kehilangan SEMUA akun
//   admin sehingga tidak ada yang bisa login lagi).
const PASSWORD_MIN_LENGTH = 6;

function getGuruList() {
  const rows = getSheet(SHEET_GURU).getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const [id, username, , nama] = rows[i];
    list.push({ id: id, username: username, nama: nama }); // password_hash sengaja tidak diikutkan di response
  }
  return { ok: true, data: list };
}

function isUsernameTaken(rows, username, excludeId) {
  const target = String(username).trim().toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if (excludeId && String(rows[i][0]) === String(excludeId)) continue;
    if (String(rows[i][1]).trim().toLowerCase() === target) return true;
  }
  return false;
}

function createGuru(username, password, nama) {
  username = String(username || '').trim();
  nama = String(nama || '').trim();
  password = String(password || '');
  if (!username || !password || !nama) return { ok: false, error: 'Semua field wajib diisi' };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: 'Password minimal ' + PASSWORD_MIN_LENGTH + ' karakter' };
  }

  const sheet = getSheet(SHEET_GURU);
  const rows = sheet.getDataRange().getValues();
  if (isUsernameTaken(rows, username)) return { ok: false, error: 'Username sudah dipakai' };

  const id = Utilities.getUuid();
  sheet.appendRow([id, username, makePasswordHash(password), nama]);
  return { ok: true, id: id };
}

function updateGuru(session, id, username, nama) {
  username = String(username || '').trim();
  nama = String(nama || '').trim();
  if (!username || !nama) return { ok: false, error: 'Username dan nama wajib diisi' };

  const sheet = getSheet(SHEET_GURU);
  const rows = sheet.getDataRange().getValues();
  let targetIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) return { ok: false, error: 'Akun admin tidak ditemukan' };
  if (isUsernameTaken(rows, username, id)) return { ok: false, error: 'Username sudah dipakai admin lain' };

  const r = targetIndex + 1;
  sheet.getRange(r, 2).setValue(username);
  sheet.getRange(r, 4).setValue(nama);
  return { ok: true };
}

// Reset password admin LAIN oleh admin yang sedang login -- lihat catatan
// keamanan di atas soal kenapa ini tidak butuh password lama.
function resetGuruPassword(session, id, newPassword) {
  newPassword = String(newPassword || '');
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: 'Password minimal ' + PASSWORD_MIN_LENGTH + ' karakter' };
  }

  const sheet = getSheet(SHEET_GURU);
  const rows = sheet.getDataRange().getValues();
  let targetIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) return { ok: false, error: 'Akun admin tidak ditemukan' };

  sheet.getRange(targetIndex + 1, 3).setValue(makePasswordHash(newPassword));
  return { ok: true };
}

function deleteGuru(session, id) {
  if (String(id) === String(session.user_id)) {
    return { ok: false, error: 'Tidak bisa menghapus akun sendiri saat sedang login' };
  }

  const sheet = getSheet(SHEET_GURU);
  const rows = sheet.getDataRange().getValues();
  if (rows.length - 1 <= 1) {
    return { ok: false, error: 'Tidak bisa menghapus admin terakhir -- sistem butuh minimal 1 akun admin yang tersisa' };
  }
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Akun admin tidak ditemukan' };
}

// Ganti password AKUN SENDIRI -- wajib konfirmasi password lama (lihat
// catatan keamanan di atas).
function changeOwnPassword(session, oldPassword, newPassword) {
  oldPassword = String(oldPassword || '');
  newPassword = String(newPassword || '');
  if (!oldPassword || !newPassword) return { ok: false, error: 'Password lama dan password baru wajib diisi' };
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: 'Password baru minimal ' + PASSWORD_MIN_LENGTH + ' karakter' };
  }

  const sheet = getSheet(SHEET_GURU);
  const rows = sheet.getDataRange().getValues();
  let targetIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(session.user_id)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) return { ok: false, error: 'Akun tidak ditemukan' };

  const currentHash = rows[targetIndex][2];
  if (!verifyPassword(oldPassword, currentHash)) {
    return { ok: false, error: 'Password lama salah' };
  }
  sheet.getRange(targetIndex + 1, 3).setValue(makePasswordHash(newPassword));
  return { ok: true };
}

// ============ LAPORAN (guru) ============
function getLaporan(tanggalMulai, tanggalSelesai, kelasFilter, mapelFilter) {
  const rows = getSheet(SHEET_ABSENSI).getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const [id, siswaId, namaSiswa, kelas, mapel, tanggalRaw, waktu, status] = rows[i];
    const tanggal = normalizeTanggal(tanggalRaw);
    if (tanggalMulai && tanggal < tanggalMulai) continue;
    if (tanggalSelesai && tanggal > tanggalSelesai) continue;
    if (kelasFilter && kelas !== kelasFilter) continue;
    if (mapelFilter && mapel !== mapelFilter) continue;
    list.push({ id, siswa_id: siswaId, nama_siswa: namaSiswa, kelas, mapel, tanggal, waktu, status });
  }
  list.sort((a, b) => (a.tanggal + a.waktu < b.tanggal + b.waktu ? 1 : -1));
  return { ok: true, data: list };
}

// ============ UTIL ============
function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" tidak ditemukan. Jalankan setupSheets() dahulu.');
  return sheet;
}

/**
 * Password hashing dengan salt per-user.
 *
 * Sebelumnya password di-hash SHA-256 tanpa salt. SHA-256 itu sengaja
 * dirancang cepat (bukan untuk password), jadi tanpa salt ia rentan
 * terhadap rainbow table dan brute force -- apalagi endpoint Apps Script
 * ini publik (Who has access: Anyone). Solusi ideal adalah algoritma
 * lambat seperti bcrypt/scrypt, tapi Apps Script tidak menyediakannya
 * secara native, jadi minimal kita tambahkan salt unik per user yang
 * disimpan bersama hash-nya (format "salt:hash").
 */
function generateSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashPassword(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return digest.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function makePasswordHash(password) {
  const salt = generateSalt();
  return salt + ':' + hashPassword(password, salt);
}

/**
 * Verifikasi password terhadap hash tersimpan. Mendukung deteksi hash lama
 * (tanpa salt, tanpa "salt:" prefix) supaya errornya jelas -- bukan diam-
 * diam gagal login tanpa sebab yang bisa ditelusuri.
 */
function verifyPassword(password, stored) {
  if (!stored || String(stored).indexOf(':') === -1) return false;
  const parts = String(stored).split(':');
  const salt = parts[0];
  const hash = parts[1];
  return hashPassword(password, salt) === hash;
}

/**
 * Rate limiting login sederhana pakai CacheService (bukan Sheet, supaya
 * tidak menambah baris/beban baca-tulis Sheets untuk sesuatu yang sifatnya
 * sementara). Maks 5 kali gagal berturut-turut per identitas (username/NIS),
 * lalu diblokir 5 menit. Terapkan whitespace-insensitive/lowercase di
 * pemanggil supaya "Admin" dan "admin" dianggap identitas yang sama.
 */
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 menit

function checkRateLimit(identifier) {
  const cache = CacheService.getScriptCache();
  const data = cache.get('loginfail_' + identifier);
  const attempts = data ? parseInt(data, 10) : 0;
  return attempts < RATE_LIMIT_MAX_ATTEMPTS;
}

function recordFailedLogin(identifier) {
  const cache = CacheService.getScriptCache();
  const key = 'loginfail_' + identifier;
  const data = cache.get(key);
  const attempts = data ? parseInt(data, 10) : 0;
  cache.put(key, String(attempts + 1), RATE_LIMIT_WINDOW_SECONDS);
}

function clearFailedLogin(identifier) {
  CacheService.getScriptCache().remove('loginfail_' + identifier);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
