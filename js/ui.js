// ============================================================
// ui.js
// ------------------------------------------------------------
// Mengelola semua komponen UI yang berjalan di luar alur soal:
//   - startGlobalPolling / stopGlobalPolling
//       Polling terpusat; aktif di screenTunggu (30 dtk) dan
//       screenTutup (40 dtk), berhenti di layar lain.
//   - startLogoutPoll / stopLogoutPoll
//       Stub (dihapus — cek logout via cu langsung di goNext2).
//   - mulaiTes         : tombol "Mulai Tes" di screenTunggu
//   - cekKontrol       : fetch status aktif/nonaktif dari TBL_K
//   - showZoomTunggu   : isi konten screenTunggu (link Zoom, ID)
//   - showScreenTutup  : tampilkan layar tutup + countdown
//   - loadFragment     : fetch HTML fragment (biodata / penutup)
//   - getActiveScreen  : kembalikan id screen yang sedang aktif
//   - tampilTopBarId   : tampilkan ID peserta di top bar
//   - cekTombolLogout  : tampil/sembunyikan tombol logout
//   - stopPolling / stopTutupPolling : stub kompatibilitas lama
//
//   Monitor & Anti-refresh:
//   - visChg           : visibilitychange → catat tab-switch
//   - saveV            : simpan counter tab-switch ke DB
//   - trackBtn         : catat klik tombol tertentu ke DB
//   - isTestActive     : cek apakah layar aktif adalah layar soal
//   - showRefWarn      : tampilkan overlay peringatan refresh
//   - setupHistoryTrap : jebak tombol Back browser
//
// Bergantung pada: config.js, auth.js (loadPaket, doLogout),
//                  test-engine.js (goNext2)
// ============================================================

// ═══════════════════════════════════════════
// POLLING TERPUSAT
// ═══════════════════════════════════════════
let _globalPollInterval=null;
let _globalPollBusy=false;

function getActiveScreen(){
  const screens=['screenTutup','screenDaftar','screenTunggu','screenStart','screenTest','screenDash','screenDone','screenUpgrade'];
  for(const id of screens){const el=$(id);if(el&&el.classList.contains('active'))return id;}
  return null;
}

function startGlobalPolling(){
  stopGlobalPolling();

  async function pollTick(){
    if(_globalPollBusy)return;
    _globalPollBusy=true;
    try{
      const screen=getActiveScreen();

      // ── Layar TUTUP: tunggu tes global dibuka kembali ──
      if(screen==='screenTutup'){
        const kontrol=await cekKontrol();
        if(kontrol.aktif){
          stopGlobalPolling();
          if(_cdInterval){clearInterval(_cdInterval);_cdInterval=null;}
          const tok=localStorage.getItem('token'),dbId=localStorage.getItem('db_id');
          if(tok&&dbId){
            sl('Memeriksa sesi...');
            try{
              const res=await aF(`${API_R}?table=${TBL}&id_x=${dbId}`,{headers:{'X-Custom-Auth':AUTH}});
              if(res.success&&res.data){
                cu=res.data;await loadAC();
                let status='nonaktif';try{status=JSON.parse(cu.x_02||'{}').status||'nonaktif'}catch{}
                if(status==='aktif'){hl();startGlobalPolling();await goNext2();}
                else{hl();ss('screenTunggu');showZoomTunggu();startGlobalPolling();}
              }else{localStorage.clear();hl();ss('screenDaftar');loadPaket();}
            }catch{hl();ss('screenDaftar');loadPaket();}
          }else{hl();ss('screenDaftar');loadPaket();}
        }
        _globalPollBusy=false;return;
      }

      // ── Layar TUNGGU: tunggu peserta diaktifkan ──
      if(screen==='screenTunggu'){
        const dbId=localStorage.getItem('db_id');
        if(!dbId){_globalPollBusy=false;return;}
        const res=await aF(`${API_R}?table=${TBL}&id_x=${dbId}`,{headers:{'X-Custom-Auth':AUTH}});
        if(!res.success||!res.data){_globalPollBusy=false;return;}
        cu=res.data;
        let bioObj={};try{bioObj=JSON.parse(cu.x_02||'{}')}catch{}
        const status=bioObj.status||'nonaktif';
        if(bioObj.logout===true){hl();ss('screenDaftar');loadPaket();_globalPollBusy=false;return;}
        if(status==='aktif'){
          stopGlobalPolling();
          const st=$('tungguStatus'),tx=$('tungguStatusTxt'),btn=$('btnMulaiTes');
          if(st)st.classList.add('aktif');if(tx)tx.textContent='Tes siap dimulai!';if(btn)btn.style.display='block';
          startGlobalPolling();await goNext2();
        }
        _globalPollBusy=false;return;
      }

      // ── Layar lain (soal, instruksi, selesai) → tidak perlu poll ──
      _globalPollBusy=false;
    }catch(e){console.warn('[globalPoll]',e);_globalPollBusy=false;}
  }

  function scheduleNext(){
    const screen=getActiveScreen();
    // Hanya poll di layar tunggu & tutup
    if(screen!=='screenTunggu'&&screen!=='screenTutup'){return;}
    const delay=screen==='screenTunggu'?30000:40000; // hemat D1: 30s tunggu, 40s tutup
    _globalPollInterval=setTimeout(async()=>{await pollTick();scheduleNext();},delay);
  }
  scheduleNext();
}

function stopGlobalPolling(){
  if(_globalPollInterval){clearTimeout(_globalPollInterval);_globalPollInterval=null;}
  _globalPollBusy=false;
}

// Logout poll dihapus — cek dari cu langsung saat refresh/goNext2
let _logoutPollInterval=null;
function startLogoutPoll(){}
function stopLogoutPoll(){
  if(_logoutPollInterval){clearInterval(_logoutPollInterval);_logoutPollInterval=null;}
}

// Stub kompatibilitas referensi lama
function stopPolling(){}
function stopTutupPolling(){}

async function mulaiTes(){startGlobalPolling();await goNext2()}

// ── Kontrol admin (aktif/nonaktif/link/waktu) ──
let _cdInterval=null;
let _kontrolInfo={aktif:false,waktu_mulai:'',link:''};

async function cekKontrol(){
  try{
    const res=await aF(`${API_R}?table=${TBL_K}&id_x=1`,{headers:{'X-Custom-Auth':AUTH}});
    if(!res.success||!res.data)return{aktif:false,waktu_mulai:'',link:''};
    let raw={};try{raw=JSON.parse(res.data.x_01||'{}')}catch{}
    const paketArr=Array.isArray(raw.paket)?raw.paket:[];
    const entry=paketArr.find(p=>(p.nama||'').trim()===AUTO_PAKET);
    if(!entry)return{aktif:false,waktu_mulai:'',link:''};
    _kontrolInfo={aktif:(entry.status||'').trim()==='aktif',waktu_mulai:entry.waktu_mulai||'',link:entry.link||''};
    return _kontrolInfo;
  }catch{return{aktif:false,waktu_mulai:'',link:''}}
}

function showZoomTunggu(){
  // ── Tampilkan konten khusus IQ ──
  if(AUTO_PAKET.toLowerCase()==='iq'){
    const iqExtra=document.getElementById('tungguIqExtra');
    const subText=document.getElementById('tungguSubText');
    if(iqExtra)iqExtra.style.display='block';
    if(subText){
      subText.textContent='Tes ini akan diawasi tester secara langsung. Pastikan Anda mengerjakan dengan benar dan jujur.';
    }
    // Update WA link dengan data peserta jika sudah ada
    const btn=document.getElementById('btnWaLidan');
    if(btn){
      let nama='';let telp='';let idPeserta=localStorage.getItem('db_id')||'';
      if(cu){try{const bio=JSON.parse(cu.x_02||'{}');nama=bio.nama||'';telp=bio.telepon||'';}catch{}}
      const pretext='Halo Lidan Psikologi, saya '+(nama||'peserta')+' sudah mengisi biodata dan siap untuk memulai Tes IQ.'+(telp?' No. WhatsApp saya: '+telp+'.':'')+(idPeserta?' ID Peserta: '+idPeserta+'.':'')+' Mohon konfirmasi dari tester. Saya ingin tahu berapa biayanya?';
      btn.href='https://wa.me/6285159601400?text='+encodeURIComponent(pretext);
    }
  }
  // ── Tampilkan ID peserta ──
  const idBox=document.getElementById('tungguIdBox');
  const idNum=document.getElementById('tungguIdNum');
  const savedId=localStorage.getItem('db_id');
  if(idBox&&idNum&&savedId){idNum.textContent=savedId;idBox.style.display='block';}

  if(_kontrolInfo.link){
    const wrap=document.getElementById('tungguZoomWrap'),btn=document.getElementById('tungguLinkBtn');
    if(wrap)wrap.style.display='block';if(btn)btn.href=_kontrolInfo.link;
  }
}

function showScreenTutup(info){
  if(info.link){document.getElementById('tutupLinkBtn').href=info.link;document.getElementById('tutupLinkWrap').style.display='block';}
  if(info.waktu_mulai){
    const target=new Date(info.waktu_mulai);
    if(!isNaN(target)){
      document.getElementById('tutupCountdown').style.display='block';
      const fmt=target.toLocaleString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
      document.getElementById('cdWaktuLabel').textContent='📅 '+fmt+' WIB';
      if(_cdInterval)clearInterval(_cdInterval);
      function tick(){
        const now=new Date(),diff=target-now;
        if(diff<=0){clearInterval(_cdInterval);['cdHari','cdJam','cdMenit','cdDetik'].forEach(id=>$(id).textContent='00');setTimeout(()=>location.reload(),3000);return}
        const h=Math.floor(diff/3600000);
        document.getElementById('cdHari').textContent=String(Math.floor(h/24)).padStart(2,'0');
        document.getElementById('cdJam').textContent=String(h%24).padStart(2,'0');
        document.getElementById('cdMenit').textContent=String(Math.floor((diff%3600000)/60000)).padStart(2,'0');
        document.getElementById('cdDetik').textContent=String(Math.floor((diff%60000)/1000)).padStart(2,'0');
      }
      tick();_cdInterval=setInterval(tick,1000);
    }
  }
  hl();ss('screenTutup');startGlobalPolling();
}

// ═══════════════════════════════════════════
// FETCH FRAGMENT — biodata & penutup
// ═══════════════════════════════════════════
async function loadFragment(url, containerId) {
  try {
    const res = await fetch(url + '?v=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    document.getElementById(containerId).innerHTML = html;
  } catch (e) {
    console.error('[FRAGMENT] Gagal memuat', url, e);
    document.getElementById(containerId).innerHTML =
      '<p style="color:var(--danger);padding:16px;text-align:center">⚠ Gagal memuat konten. Coba muat ulang halaman.</p>';
  }
}

// ── Tampilan ID peserta & tombol logout ──
function tampilTopBarId(){
  const el=document.getElementById('topBarId');
  if(!el)return;
  const id=localStorage.getItem('db_id');
  if(id){el.textContent='ID: '+id;el.style.display='inline-block';}
  else{el.style.display='none';}
}

function cekTombolLogout(aktif){
  let btn=$('btnLogoutPeserta');
  if(!btn)return;
  btn.style.display=aktif?'inline-flex':'none';
}

// ═══════════════════════════════════════════
// MONITOR — tab-switch & klik tombol
// ═══════════════════════════════════════════
function visChg(){if(!document.hidden)return;if(!$('screenTest').classList.contains('active'))return;vCnt++;saveV()}
async function saveV(){const id=localStorage.getItem('db_id');if(!id||!cfg)return;try{const k=(cfg._taskId||cfg.id||'').trim();vMap[k]=(vMap[k]||0)+1;await fetch(`${API_W}?table=${TBL}&id_x=${id}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Custom-Auth':AUTH},body:JSON.stringify({x_09:JSON.stringify(vMap)})})}catch{}}
async function trackBtn(key){const id=localStorage.getItem('db_id');if(!id)return;try{vMap[key]=(vMap[key]||0)+1;await fetch(`${API_W}?table=${TBL}&id_x=${id}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Custom-Auth':AUTH},body:JSON.stringify({x_09:JSON.stringify(vMap)})})}catch{}}
document.addEventListener('visibilitychange',visChg);
document.addEventListener('contextmenu',e=>{if(e.target.tagName==='IMG'){e.preventDefault();return false}});
document.addEventListener('dragstart',e=>{if(e.target.tagName==='IMG'){e.preventDefault();return false}});
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='s'){e.preventDefault();return false}});

// ═══════════════════════════════════════════
// ANTI-REFRESH SYSTEM
// ═══════════════════════════════════════════
function isTestActive(){
  const s = document.querySelector('.screen.active');
  return s && (s.id==='screenTest' || s.id==='screenKreplin');
}
function showRefWarn(){
  const ov=document.getElementById('refreshWarningOverlay');
  if(ov) ov.style.display='flex';
}

// 1) Keyboard: F5, Ctrl+R, Ctrl+Shift+R, Ctrl+W, Alt+F4
document.addEventListener('keydown', function(e){
  if(!isTestActive()) return;
  const k=e.key.toLowerCase();
  const ctrl=e.ctrlKey||e.metaKey;
  if(e.key==='F5' || (ctrl&&k==='r') || (ctrl&&e.shiftKey&&k==='r') || (ctrl&&k==='w') || (e.altKey&&e.key==='F4')){
    e.preventDefault(); e.stopPropagation(); showRefWarn(); return false;
  }
}, true);

// 2) Klik kanan disable (mencegah menu Reload)
document.addEventListener('contextmenu', function(e){
  if(!isTestActive()) return;
  e.preventDefault();
}, true);

// 3) Tombol Back browser / swipe back (history trick)
(function setupHistoryTrap(){
  if(history.state && history.state._testTrap) return;
  history.pushState({_testTrap:true}, '');
  window.addEventListener('popstate', function(e){
    if(!isTestActive()) return;
    history.pushState({_testTrap:true}, '');
    showRefWarn();
  });
})();

// 4) Deteksi tab tersembunyi > 2 detik saat tes aktif
let _warnShownAt = 0;
document.addEventListener('visibilitychange', function(){
  if(!isTestActive()) return;
  if(document.visibilityState==='hidden'){
    _warnShownAt = Date.now();
  } else {
    if(_warnShownAt && Date.now()-_warnShownAt > 2000) showRefWarn();
    _warnShownAt = 0;
  }
});