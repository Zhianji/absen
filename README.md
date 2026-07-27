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
  admin.html          -> kelola akun Guru/Admin (tambah, edit, reset password, hapus)
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
| Guru | admin        | admin123  |

Siswa belum ada akun bawaan — tambahkan lewat Dashboard Guru > Data Siswa.

## Aturan Bisnis yang Diimplementasikan

- Siswa hanya bisa check-in **1 kali per mata pelajaran per hari** (TIK dan KKA dihitung terpisah). Validasi dilakukan di server (`Code.gs`) dengan `LockService` untuk mencegah duplikasi saat ada request bersamaan — bukan hanya validasi di sisi frontend, karena frontend bisa dimanipulasi.
- Session berbasis token (bukan cookie), berlaku 12 jam, disimpan di Sheet `Sessions` dan divalidasi di setiap request yang butuh login.
- Password di-hash SHA-256 sebelum disimpan.

## Tandai Kehadiran Manual (Izin/Sakit/Alfa)

Siswa hanya bisa mencatat status **Hadir** lewat check-in sendiri (`absen-siswa.html`). Untuk Izin, Sakit, atau Alfa — atau mengoreksi status yang salah — guru menandainya lewat halaman **Dashboard Guru > Tandai Kehadiran**:

- Pilih tanggal, mata pelajaran (TIK/KKA), dan opsional filter kelas.
- Tabel menampilkan seluruh siswa di kelas tsb beserta status saat ini (`Belum ditandai` kalau belum ada catatan sama sekali).
- Klik salah satu tombol Hadir/Izin/Sakit/Alfa untuk menyimpan — kalau siswa sudah check-in sendiri, statusnya akan DIGANTI (bukan duplikat baris).
- **Tandai Semua**: tombol `Hadir`/`Izin`/`Sakit`/`Alfa` di atas tabel menandai SEMUA siswa yang sedang tampil (sesuai filter tanggal/mapel/kelas) sekaligus dengan satu status yang sama — berguna misal saat jam pelajaran kosong (tandai semua Alfa) atau study tour (tandai semua Izin). Ada dialog konfirmasi sebelum eksekusi karena akan menimpa status yang sudah ada.
- Backend: action `getStatusHarian` (baca), `setAbsensiStatus` (tulis satu siswa), dan `setAbsensiStatusBulk` (tulis massal, dipakai tombol Tandai Semua) — semuanya role guru, terkunci dengan `LockService` yang sama seperti check-in siswa supaya tidak balapan (untuk versi bulk, lock hanya diambil sekali untuk seluruh batch).

## Manajemen Akun Admin/Guru

Halaman `web/admin.html` (link tersedia di sidebar dashboard guru, "Kelola Akun Admin") dipakai untuk mengelola akun Guru/Admin -- yang sebelumnya cuma bisa dibuat sekali lewat `setupSheets()` atau edit manual di Sheet.

- **Login terpisah**: `admin.html` punya form login sendiri (memakai action `loginGuru` yang sama), jadi tetap butuh username+password akun guru untuk masuk.
- **Tambah / edit / hapus akun**: guru yang sedang login bisa menambah akun admin baru, mengubah username/nama akun lain, atau menghapusnya. Tidak bisa menghapus akun sendiri (mencegah kunci-diri-sendiri) dan tidak bisa menghapus admin terakhir yang tersisa.
- **Reset password akun lain**: tidak butuh password lama -- ini wewenang admin yang sudah login, sama seperti guru mereset password siswa.
- **Ganti password akun sendiri**: WAJIB konfirmasi password lama dulu sebelum bisa diganti, supaya token/sesi yang bocor atau lupa logout di komputer bersama tidak otomatis bisa mengambil alih akun.
- **Hashing**: semua password (guru maupun siswa) memakai skema yang sama -- SHA-256 + salt unik per akun (format `salt:hash`), tidak pernah disimpan dalam bentuk teks polos. Lihat `makePasswordHash()`/`verifyPassword()` di `Code.gs`.

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
