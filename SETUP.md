# Setup Backend (Google Apps Script + Google Sheets)

## 1. Buat Spreadsheet
1. Buka https://sheets.google.com > buat spreadsheet baru, beri nama misalnya `DB-Absensi`.
2. Buka menu **Extensions > Apps Script**.
3. Hapus isi default `Code.gs`, lalu copy-paste seluruh isi file `Code.gs` dari folder ini.

## 2. Jalankan Setup Sekali
1. Di editor Apps Script, pilih fungsi `setupSheets` pada dropdown toolbar (di sebelah tombol Run/Debug).
2. Klik **Run**. Saat diminta izin, klik **Review permissions** > pilih akun Google > **Advanced** > **Go to (nama project) (unsafe)** > **Allow**. (Ini normal untuk script buatan sendiri.)
3. Cek tab Spreadsheet — akan otomatis terbuat 4 sheet: `Guru`, `Siswa`, `Absensi`, `Sessions`.
4. Sheet `Guru` sudah berisi 1 akun default:
   - username: `admin`
   - password: `admin123`
   - **Segera ganti password ini** setelah login pertama kali (lewat direct edit di Sheet, hash password baru bisa digenerate lewat fungsi `hashPassword('password_baru')` yang dijalankan manual dari editor lalu di-log).

## 3. Deploy sebagai Web App
1. Klik **Deploy > New deployment**.
2. Klik ikon gear di sebelah "Select type" > pilih **Web app**.
3. Isi:
   - Description: `absensi-api-v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Klik **Deploy**, izinkan akses lagi jika diminta.
5. **Copy URL Web App** yang muncul (bentuknya seperti `https://script.google.com/macros/s/XXXXXXXX/exec`).
6. Paste URL ini ke `web/config.js` pada variabel `APPS_SCRIPT_URL`.

## 4. Setiap Kali Mengubah Code.gs
Apps Script **tidak otomatis update URL production** setelah edit kode. Setiap selesai edit:
1. **Deploy > Manage deployments**.
2. Klik ikon pensil pada deployment aktif.
3. Version: pilih **New version** > **Deploy**.

URL exec-nya tetap sama, tidak perlu update `config.js` lagi setelah deployment pertama.

## Catatan Keamanan & Batasan
- Password ditransmisi via HTTPS dan disimpan ter-hash (SHA-256) di Sheet — cukup untuk skala sekolah, **bukan** tingkat keamanan enterprise.
- Akun Google gratis (bukan Workspace) punya kuota eksekusi Apps Script harian. Untuk sekolah besar dengan trafik check-in serentak sangat tinggi, ada risiko delay/quota — lihat catatan trade-off yang sudah didiskusikan.
- Jangan commit URL Apps Script + isi `config.js` ke repo publik jika ingin membatasi siapa yang tahu endpoint-nya (meski akses tetap dilindungi login + token session).
