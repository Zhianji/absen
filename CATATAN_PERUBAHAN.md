# ✅ Perubahan yang Sudah Diterapkan

Semua perubahan sudah langsung diaplikasikan ke file Anda — tinggal upload/deploy. Tidak ada langkah manual lagi.

## 🐛 Bug fix: Attendance Trend chart
Sebelumnya, `loadOverview()` mengambil data laporan dengan `tanggal_mulai = tanggal_selesai = hari ini`. Akibatnya chart "Attendance Trend (7 Hari Terakhir)" hanya punya data 1 hari — jadi selalu tampil 1 batang terisi + 6 batang kosong, meski siswa rajin hadir di hari-hari sebelumnya.

**Fix:** sekarang mengambil rentang 7 hari (`tanggal_mulai` = 6 hari lalu, `tanggal_selesai` = hari ini) dalam **satu** API call yang sama (tidak nambah request). Chart tren pakai semua 7 hari data; kartu statistik, pie chart status, leaderboard, dan tabel aktivitas terbaru tetap difilter khusus hari ini saja seperti sebelumnya — jadi label-nya tetap akurat.

## File yang diubah

| File | Perubahan |
|---|---|
| `config.js` | + Sistem caching (`localStorage`), + `apiPostCached()` helper, cache dibersihkan saat logout |
| `dashboard-guru-enhanced.html` | − Hapus `recharts.min.js` (200KB, tidak dipakai), + skeleton loading, + `loadOverview()` pakai cache (instan lalu update background), + **fix bug Attendance Trend** (lihat atas), + register service worker |
| `index.html`, `absen-siswa.html`, `admin.html` | + Register service worker |
| `service-worker.js` (baru) | Cache file statis dengan strategi *stale-while-revalidate* |

## File yang TIDAK diubah
`Code.gs`, `style.css`, `dashboard-guru.html`, `README.md`, `SETUP.md`, `ENHANCEMENTS.md`.

## Cara pakai
1. Extract zip ini
2. Upload semua file ke hosting Anda (replace file lama)
3. **Hard refresh** browser sekali (Ctrl+Shift+R)
4. Selesai

## Catatan penting
- Data absensi tetap selalu **fresh dari server** — yang di-cache hanya file statis dan ringkasan overview (auto-expire 5 menit)
- Kalau ingin memaksa refresh data, jalankan `clearAllCache()` di browser console, atau logout-login
- **Leaderboard "Top Kelas"** saat ini menghitung jumlah check-in mentah per kelas, bukan persentase kehadiran — kelas dengan siswa lebih banyak otomatis unggul. Ini bukan bug, tapi kalau mau dibuat berbasis persentase (lebih adil), beri tahu saya.
