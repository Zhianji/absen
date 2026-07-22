# Absensi Digital - TIK & KKA

Web service absensi ringan untuk 2 role: **Guru** dan **Siswa**.

## Arsitektur

```
Browser (HTML/CSS/JS statis, di-hosting GitHub Pages)
        │  fetch() → HTTPS
        ▼
Google Apps Script Web App  (berfungsi sebagai REST API)
        │
        ▼
Google Spreadsheet  (database: Guru, Siswa, Absensi, Sessions)
```

Tidak ada server yang perlu di-maintain — backend berjalan di infrastruktur Google, database-nya adalah Google Sheet yang bisa dibuka & diedit manual kapan saja.

## Struktur Folder

```
apps-script/
  Code.gs      -> seluruh logic backend (auth, CRUD, check-in, laporan)
  SETUP.md     -> langkah setup Sheet & deploy Web App
web/
  index.html          -> halaman login (tab Guru / Siswa)
  absen-siswa.html    -> layar check-in siswa (jam digital + tombol TIK/KKA)
  dashboard-guru.html -> dashboard guru (overview, CRUD siswa, laporan + export CSV)
  config.js           -> konfigurasi URL API + helper fetch
  style.css           -> design token & style bersama semua halaman
```

## Cara Menjalankan

1. **Setup backend** — ikuti `apps-script/SETUP.md` langkah demi langkah (buat Sheet, paste Code.gs, jalankan `setupSheets()`, deploy sebagai Web App, copy URL exec).
2. **Hubungkan frontend ke backend** — buka `web/config.js`, ganti nilai `APPS_SCRIPT_URL` dengan URL exec yang didapat dari langkah 1.
3. **Hosting frontend via GitHub Pages**:
   ```
   git init
   git add .
   git commit -m "init absensi app"
   git branch -M main
   git remote add origin <url-repo-kamu>
   git push -u origin main
   ```
   Lalu di GitHub: **Settings > Pages > Source: Deploy from branch > pilih branch `main` folder `/web`** (atau pindahkan isi folder `web/` ke root repo jika ingin path `/`).
4. Buka URL GitHub Pages yang muncul (`https://username.github.io/nama-repo/`). Login guru default: `admin` / `admin123` — **segera ganti**.

## Login Default

| Role | Username/NIS | Password  |
|------|--------------|-----------|
| Guru |              |           |

Siswa belum ada akun bawaan — tambahkan lewat Dashboard Guru > Data Siswa.

## Aturan Bisnis yang Diimplementasikan

- Siswa hanya bisa check-in **1 kali per mata pelajaran per hari** (TIK dan KKA dihitung terpisah). Validasi dilakukan di server (`Code.gs`) dengan `LockService` untuk mencegah duplikasi saat ada request bersamaan — bukan hanya validasi di sisi frontend, karena frontend bisa dimanipulasi.
- Session berbasis token (bukan cookie), berlaku 12 jam, disimpan di Sheet `Sessions` dan divalidasi di setiap request yang butuh login.
- Password di-hash SHA-256 sebelum disimpan.

## Batasan yang Perlu Diketahui (jangan diabaikan)

Ini bukan sekadar disclaimer administratif — ini memengaruhi apakah stack ini cocok untuk skala sekolahmu:

1. **Kuota Apps Script**: akun Google gratis punya batas eksekusi script per hari dan batas concurrent execution. Kalau ratusan siswa check-in dalam hitungan detik yang sama (misal bel masuk), sebagian request bisa antre/gagal. [Medium confidence — perlu dicek ulang di dokumentasi resmi Google Workspace/Apps Script quotas karena angka bisa berubah]
2. **Latency**: tiap panggilan API ke Sheets biasanya 300ms–1.5 detik, jauh lebih lambat dari database relasional biasa. UI dirancang untuk terasa cepat (feedback instan di tombol), tapi network call di baliknya tetap ada jeda.
3. **Keamanan**: cukup untuk skala sekolah/internal, bukan untuk data sensitif tingkat tinggi. Siapa pun yang tahu URL Apps Script dan berhasil menebak/mencuri token session bisa memanggil API — pastikan tidak share URL secara sembarangan meski akses tetap dilindungi login.
4. **GitHub Pages** murni hosting file statis — tidak menjalankan kode server apa pun. Semua logic backend memang sengaja dipindah seluruhnya ke Apps Script.

## Rencana Pengembangan Lanjutan (opsional, belum diimplementasikan)

- Reset password mandiri untuk siswa (saat ini hanya guru yang bisa reset via form edit).
- Import massal siswa dari file CSV/Excel di Dashboard Guru.
- Notifikasi ke wali kelas jika siswa belum check-in sampai jam tertentu (butuh trigger time-based di Apps Script).
