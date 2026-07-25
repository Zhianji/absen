/**
 * OPTIMASI DASHBOARD GURU - Code Snippet
 * 
 * Tunjukkan bagian mana yang perlu diubah dari dashboard-guru-enhanced.html
 * untuk implementasi caching dan skeleton loading
 */

// ===== TAMBAHKAN KE <head> section =====
// <link rel="preload" as="script" href="config-optimized.js">
// <style>
//   .skeleton {
//     background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
//     background-size: 200% 100%;
//     animation: loading 1.5s infinite;
//   }
//   
//   @keyframes loading {
//     0% { background-position: 200% 0; }
//     100% { background-position: -200% 0; }
//   }
//   
//   .stat-card.skeleton { height: 120px; border-radius: var(--radius); }
//   .chart-skeleton { height: 300px; border-radius: var(--radius); }
// </style>

// ===== REPLACE: Lazy load Recharts =====
// HAPUS:
// <script src="https://cdnjs.cloudflare.com/ajax/libs/recharts/2.10.3/recharts.min.js"></script>

// GANTI DENGAN:
function loadRechartsIfNeeded() {
  if (window.Recharts) return; // Sudah loaded
  console.log('[SW] Lazy loading Recharts...');
  
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/recharts/2.10.3/recharts.min.js';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    console.log('[SW] Recharts loaded');
    // Render chart jika sudah di tab statistik
    if (document.getElementById('tabStatistik').classList.contains('active')) {
      renderOverviewChart();
    }
  };
  document.head.appendChild(script);
}

// Tambahkan event listener di tab statistik:
// document.getElementById('tabStatistik').addEventListener('click', loadRechartsIfNeeded);


// ===== GANTI: loadOverview() function =====
// SEBELUM:
// async function loadOverview() {
//   const res1 = await apiPost('getStats', { token });
//   const res2 = await apiPost('getChart', { token });
//   const res3 = await apiPost('getKehadiran', { token });
//   // ... render semua
// }

// SESUDAH: dengan caching dan parallel loading
async function loadOverview() {
  const token = getToken();
  
  // 1. Render skeleton dulu (non-blocking)
  renderOverviewSkeleton();
  
  try {
    // 2. Load data dengan caching dan parallel
    const [statsRes, chartRes, kehadiranRes] = await apiParallel([
      {
        action: 'getStats',
        data: { token },
        cacheKey: CACHE_CONFIG.OVERVIEW.key,
      },
      {
        action: 'getChart',
        data: { token },
        cacheKey: 'cache_chart_data',
      },
      {
        action: 'getKehadiran',
        data: { token },
        cacheKey: 'cache_kehadiran_summary',
      },
    ]);
    
    // 3. Render data sekali semua siap
    if (statsRes.ok) renderStats(statsRes.data);
    if (chartRes.ok) renderChart(chartRes.data);
    if (kehadiranRes.ok) renderKehadiranSummary(kehadiranRes.data);
    
  } catch (err) {
    console.error('[ERROR] loadOverview failed:', err);
    showToast('Gagal memuat data overview', 'error');
  }
}

/**
 * Render skeleton placeholder saat loading
 */
function renderOverviewSkeleton() {
  const skeletonHTML = `
    <div class="stat-grid">
      <div class="stat-card skeleton"></div>
      <div class="stat-card skeleton"></div>
      <div class="stat-card skeleton"></div>
      <div class="stat-card skeleton"></div>
    </div>
    <div class="chart-skeleton skeleton"></div>
  `;
  
  const container = document.getElementById('overviewContainer');
  if (container) {
    container.innerHTML = skeletonHTML;
  }
}

/**
 * Render stats cards
 */
function renderStats(data) {
  const html = `
    <div class="stat-grid">
      <div class="stat-card variant-blue">
        <h3>Total Siswa</h3>
        <div class="stat-value">${data.totalSiswa || 0}</div>
      </div>
      <div class="stat-card variant-purple">
        <h3>Hadir Hari Ini</h3>
        <div class="stat-value">${data.hadirHariIni || 0}</div>
      </div>
      <div class="stat-card variant-green">
        <h3>Izin</h3>
        <div class="stat-value">${data.izin || 0}</div>
      </div>
      <div class="stat-card variant-red">
        <h3>Sakit</h3>
        <div class="stat-value">${data.sakit || 0}</div>
      </div>
    </div>
  `;
  
  const container = document.getElementById('overviewContainer');
  if (container) {
    // Replace skeleton dengan actual content
    container.innerHTML = html;
  }
}

/**
 * Render chart (with lazy-loaded Recharts)
 */
function renderChart(data) {
  // Lazy load Recharts jika belum loaded
  if (!window.Recharts) {
    loadRechartsIfNeeded();
    return;
  }
  
  // Render chart menggunakan Recharts
  const chartContainer = document.getElementById('chartContainer');
  if (chartContainer) {
    chartContainer.innerHTML = `
      <div style="height: 300px;">
        <!-- Chart rendering code di sini -->
        Chart data: ${JSON.stringify(data).substring(0, 100)}...
      </div>
    `;
  }
}

/**
 * Render kehadiran summary
 */
function renderKehadiranSummary(data) {
  const container = document.getElementById('kehadiranSummary');
  if (container) {
    const html = `
      <h3>Ringkasan Kehadiran</h3>
      <p>Hadir: ${data.hadir || 0}</p>
      <p>Izin: ${data.izin || 0}</p>
      <p>Sakit: ${data.sakit || 0}</p>
      <p>Alfa: ${data.alfa || 0}</p>
    `;
    container.innerHTML = html;
  }
}


// ===== GANTI: loadKehadiran() function =====
// SEBELUM:
// async function loadKehadiran() {
//   const tanggal = document.getElementById('khTanggal').value;
//   const mapel = document.getElementById('khMapel').value;
//   const kelas = document.getElementById('khKelas').value;
//   const res = await apiPost('getStatusHarian', { token, tanggal, mapel, kelas });
//   // ... render table
// }

// SESUDAH: dengan skeleton loading
async function loadKehadiran() {
  const tanggal = document.getElementById('khTanggal').value;
  const mapel = document.getElementById('khMapel').value;
  const kelas = document.getElementById('khKelas').value;
  
  if (!tanggal) {
    showToast('Pilih tanggal dulu', 'error');
    return;
  }
  
  // 1. Render skeleton
  document.getElementById('tblKehadiran').innerHTML = createSkeletonLoader('table', 3);
  
  try {
    // 2. Fetch data (bisa dari cache atau API)
    const res = await apiPostWithCache(
      'getStatusHarian',
      { token: getToken(), tanggal, mapel, kelas },
      `cache_kehadiran_${tanggal}_${mapel}_${kelas}`, // Unique cache key
      false // Use cache
    );
    
    if (!res.ok) {
      showToast(res.error || 'Gagal memuat data', 'error');
      return;
    }
    
    // 3. Render actual data
    kehadiranCache = res.data;
    renderKehadiranTable();
    
  } catch (err) {
    console.error('[ERROR] loadKehadiran failed:', err);
    showToast('Gagal terhubung ke server', 'error');
  }
}


// ===== GANTI: loadLaporan() function =====
// SESUDAH: dengan skeleton loading dan pagination optimization
async function loadLaporan() {
  const params = {
    token: getToken(),
    tanggal_mulai: document.getElementById('fltMulai').value,
    tanggal_selesai: document.getElementById('fltSelesai').value,
    kelas: document.getElementById('fltKelas').value.trim(),
    mapel: document.getElementById('fltMapel').value,
  };
  
  const tbody = document.getElementById('tblLaporan');
  
  // 1. Render skeleton
  tbody.innerHTML = createSkeletonLoader('table', 5);
  
  try {
    // 2. Fetch dengan cache
    const cacheKey = `cache_laporan_${params.tanggal_mulai}_${params.tanggal_selesai}`;
    const res = await apiPostWithCache(
      'getLaporan',
      params,
      cacheKey
    );
    
    if (!res.ok) {
      showToast(res.error || 'Gagal memuat laporan', 'error');
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Gagal memuat data</td></tr>';
      return;
    }
    
    // 3. Render data
    laporanCache = res.data;
    laporanPage = 1;
    renderLaporanPage();
    
  } catch (err) {
    console.error('[ERROR] loadLaporan failed:', err);
    showToast('Gagal terhubung ke server', 'error');
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Gagal terhubung ke server</td></tr>';
  }
}


// ===== GANTI: init() function =====
// SEBELUM:
// (async function init() {
//   const session = await guardPage('guru');
//   if (!session) return;
//   document.getElementById('namaGuru').textContent = getNama();
//   updateClock();
//   await loadOverview();
// })();

// SESUDAH: dengan Service Worker registration
(async function init() {
  // 1. Check session
  const session = await guardPage('guru');
  if (!session) return;
  
  // 2. Set UI sebelum data loading
  document.getElementById('namaGuru').textContent = getNama();
  updateClock();
  
  // 3. Register Service Worker (untuk offline support)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then((reg) => console.log('[SW] Registered:', reg))
      .catch((err) => console.error('[SW] Registration failed:', err));
  }
  
  // 4. Load data (non-blocking dengan skeleton)
  await loadOverview();
})();


// ===== HELPER: Force refresh cache =====
// Panggil ini untuk refresh semua cached data
function refreshAllData() {
  console.log('[INFO] Refreshing all cached data...');
  
  // Clear semua cache
  clearAllCache();
  
  // Reload overview
  loadOverview();
}

// Tambahkan button untuk manual refresh:
// <button onclick="refreshAllData()" class="btn-secondary">Refresh Data</button>


// ===== OPTIONAL: Enable debug mode =====
// Jalankan ini di console untuk debug:
// localStorage.setItem('absensi_debug', 'true');
// Reload halaman, maka akan ada window.DEBUG dengan info cache
