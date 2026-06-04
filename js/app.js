// ============================================================
// app.js
// ------------------------------------------------------------
// Titik masuk utama aplikasi — hanya berisi window.onload.
// Semua logika domain sudah dipindahkan ke file masing-masing:
//
//   config.js      ← konstanta, konfigurasi, variabel global
//   auth.js        ← login token, daftar, logout, loadAC
//   renderers.js   ← render soal per tipe
//   test-engine.js ← alur tes: loadQ, startTest, endTest, goNext2
//   who-engine.js  ← tes WHO (wOpen, wStart, wEnd, dll.)
//   kreplin.js     ← tes Kraepelin
//   ui.js          ← polling, countdown, monitor, anti-refresh
//
// Urutan <script> di HTML yang wajib diikuti:
//   1. config.js
//   2. auth.js
//   3. renderers.js
//   4. test-engine.js
//   5. who-engine.js
//   6. kreplin.js
//   7. ui.js
//   8. app.js   ← file ini, terakhir
// ============================================================

window.onload = async () => {
  // ── Cek ?p= lebih awal, sebelum apapun dijalankan ──
  if (!AUTO_PAKET) {
    hl();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    let errScreen = $('screenNoPacket');
    if (!errScreen) {
      errScreen = document.createElement('div');
      errScreen.id = 'screenNoPacket';
      errScreen.className = 'screen active';
      errScreen.innerHTML = `
        <div class="card" style="text-align:center;margin-top:40px">
          <div style="font-size:3em;margin-bottom:12px">📦</div>
          <div style="font-size:1.25em;font-weight:700;color:var(--danger);margin-bottom:10px">Paket Belum Dimasukkan</div>
          <p style="color:var(--muted);font-size:.9em;line-height:1.7">
            Halaman ini memerlukan parameter paket pada URL.<br>
            Tambahkan <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.9em">?p=nama-paket</code> di akhir URL Anda.<br><br>
            Contoh: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.9em">tes-template.html?p=tes-iq</code>
          </p>
        </div>`;
      document.body.appendChild(errScreen);
    } else {
      errScreen.classList.add('active');
    }
    return; // hentikan init
  }

  sl('Memeriksa paket...');

  // Cek paket di server SEBELUM apapun (termasuk sebelum cek token)
  await loadPaket();
  if (!sPaket) { showPaketNotFoundScreen(); return; }

  sl('Memuat halaman...');

  // Ambil URL fragment dari x_03 (JSON) jika tersedia, fallback ke hardcoded
  let _fragBiodata = FRAGMENT_BASE + BIODATA_FILE;
  let _fragPenutup = FRAGMENT_BASE + PENUTUP_FILE;
  try {
    const _x03 = JSON.parse(sPaket.x_03 || '{}');
    if (_x03.biodata) _fragBiodata = _x03.biodata;
    if (_x03.penutup) _fragPenutup = _x03.penutup;
  } catch(e) { console.warn('[FRAGMENT] Gagal parse x_03:', e); }

  // Muat kedua fragment secara paralel
  await Promise.all([
    loadFragment(_fragBiodata, 'biodataContainer'),
    loadFragment(_fragPenutup, 'penutupContainer'),
  ]);

  // Inisialisasi tombol WA di fragment penutup setelah DOM siap
  (function initPenutupWa() {
    const waIds = ['waAsmara','waKarakter','waKarier','waPotensi'];
    const btn = waIds.map(id => document.getElementById(id)).find(el => el);
    if (!btn) return; // tidak ada tombol penutup custom
    const namaMap = {
      waAsmara:   'Tes Asmara',
      waKarakter: 'Tes Karakter',
      waKarier:   'Tes Karier',
      waPotensi:  'Tes Potensi',
    };
    const namaBtn = waIds.find(id => document.getElementById(id) === btn);
    const namaTes = namaMap[namaBtn] || 'Tes';
    const id  = (cu && cu.id_x) ? String(cu.id_x) : (localStorage.getItem('db_id') || '');
    const text = 'Halo Admin Lidan, saya baru saja menyelesaikan ' + namaTes
      + ' dan ingin mendapatkan laporan hasil tes serta sertifikat eksklusif saya. Boleh saya tahu berapa biayanya?'
      + (id  ? '\n\nID: ' + id  : '');
    btn.href = 'https://wa.me/6285159601400?text=' + encodeURIComponent(text);
  })();

  sl('Memeriksa status tes...');
  const kontrol = await cekKontrol();
  if (!kontrol.aktif) { showScreenTutup(kontrol); return; }

  const tok = localStorage.getItem('token');
  if (tok) {
    const _pLama = localStorage.getItem('_p');
    // Catat apakah token ini berasal dari paket yang berbeda SEBELUM dioverwrite
    const _paketBeda = !!(_pLama && _pLama !== AUTO_PAKET);
    if (_paketBeda) {
      const _keysHapus = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('_st_')) _keysHapus.push(k);
      }
      _keysHapus.forEach(k => localStorage.removeItem(k));
      localStorage.setItem('_p', AUTO_PAKET);
      // PERBAIKAN INTI: reset status di DB ke 'nonaktif' jika pindah ke paket non-auto.
      if (!IS_AUTO_AKTIF) {
        const _oldDbId = localStorage.getItem('db_id');
        if (_oldDbId) {
          try {
            const _oldData = await aF(`${API_R}?table=${TBL}&id_x=${_oldDbId}`, {headers:{'X-Custom-Auth':AUTH}});
            if (_oldData.success && _oldData.data) {
              let _oldBio = {}; try { _oldBio = JSON.parse(_oldData.data.x_02 || '{}'); } catch {}
              if (_oldBio.status === 'aktif') {
                _oldBio.status = 'nonaktif';
                await aP(_oldDbId, {x_02: JSON.stringify(_oldBio)});
                console.log('[INIT] Status record lama di-reset ke nonaktif untuk paket:', AUTO_PAKET);
              }
            }
          } catch(e) { console.warn('[INIT] Gagal reset status lama:', e); }
        }
      }
    }
    sl('Memeriksa sesi...');
    try {
      const res = await aF(`${API_R}?table=${TBL}&x_01_eq=${tok}`, { headers: { 'X-Custom-Auth': AUTH } });
      if (!res.success || !res.count) { localStorage.clear(); hl(); ss('screenDaftar'); return; }
      cu = res.data[0]; localStorage.setItem('db_id', cu.id_x);
      vMap = {}; if (cu.x_09) { try { const v = JSON.parse(cu.x_09); Object.entries(v).forEach(([k, vl]) => { if (k && /^[a-zA-Z0-9_]+$/.test(k)) vMap[k] = parseInt(vl) || 0; }); } catch {} }
      await loadAC();
      let status = 'nonaktif'; try { status = JSON.parse(cu.x_02 || '{}').status || 'nonaktif'; } catch {}
      if (IS_AUTO_AKTIF) {
        // Paket auto-aktif (asmara/karakter/potensi/karir): langsung mulai
        hl(); startGlobalPolling(); await goNext2();
      } else if (status === 'aktif' && !_paketBeda) {
        // Paket non-auto (iq): lanjut hanya jika token memang dari paket ini
        hl(); startGlobalPolling(); await goNext2();
      } else {
        // Token dari paket lain, atau status belum diaktifkan admin → wajib tunggu
        hl(); ss('screenTunggu'); showZoomTunggu(); startGlobalPolling();
      }
    } catch (e) { localStorage.clear(); hl(); ss('screenDaftar'); }
    return;
  }
  hl(); ss('screenDaftar');
};