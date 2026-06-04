// ============================================================
// kreplin.js
// ------------------------------------------------------------
// Engine khusus untuk Tes Kraepelin (penjumlahan berulang):
//   - kreplinStart           : inisialisasi + tampilkan intro atau resume
//   - kreplinRun             : mulai dari kolom 1 (baru)
//   - kreplinRenderKolom     : update header progress kolom
//   - kreplinNextKolom       : lanjut ke kolom berikutnya
//   - kreplinSoalBaru        : generate soal acak dan tombol jawaban
//   - kreplinBuatOpsi        : buat array angka 0–9 (tombol jawaban)
//   - kreplinJawab           : proses jawaban user, lanjut soal/kolom
//   - kreplinCatatKolom      : catat hasil kolom dan simpan ke server
//   - kreplinBuildPayload    : susun payload dikerjakan|benar|salah
//   - kreplinStartTimer      : mulai timer per kolom (dari awal)
//   - kreplinStartTimerResume: resume timer dari sisa waktu tersimpan
//   - kreplinUpdTimer        : update tampilan timer di UI
//   - kreplinSelesai         : selesaikan semua kolom, simpan ke DB
//   - kreplinSaveState       : simpan state ke localStorage
//   - kreplinLoadState       : baca state dari localStorage
//   - kreplinClearState      : hapus state dari localStorage
//
// State tersimpan di localStorage dengan key: _krep_state
// Bergantung pada: config.js, test-engine.js (goNext2)
// ============================================================

let _kCfg={},_kKolom=0,_kSoalIdx=0,_kBenar=0,_kSalah=0,_kTimer=null,_kTL=0,_kLog=[],_kA=0,_kB=0,_kDone=false;
const _kSK='_krep_state';

function kreplinSaveState(){
  localStorage.setItem(_kSK,JSON.stringify({
    kolom:_kKolom,soalIdx:_kSoalIdx,benar:_kBenar,salah:_kSalah,
    benarPrev:_kBenarPrev,salahPrev:_kSalahPrev,
    timeLeft:_kTL,log:_kLog,introShown:true
  }));
}

function kreplinLoadState(){
  try{return JSON.parse(localStorage.getItem(_kSK)||'null')}catch{return null}
}

function kreplinClearState(){localStorage.removeItem(_kSK)}

async function kreplinStart(ref){
  // Load config dari txt
  let meta={totalKolom:45,soalPerKolom:50,detikPerKolom:30,angkaMin:1,angkaMax:9};
  let title='Tes Kraepelin',instructions='',desc='',exNote='';
  if(ref&&ref.dataUrl){
    try{
      const raw=await(await fetch(ref.dataUrl+'?v='+Date.now())).json();
      if(raw&&raw.meta){
        const m=raw.meta;
        if(m.title)title=m.title;
        if(m.instructions)instructions=m.instructions;
        if(m.desc)desc=m.desc;
        if(m.exNote)exNote=m.exNote;
        if(m.kreplin)Object.assign(meta,m.kreplin);
      }
    }catch(e){console.warn('[kreplin] gagal load config:',e)}
  }
  _kCfg=meta;_kDone=false;

  // Cek apakah ada state tersimpan (resume setelah refresh)
  const saved=kreplinLoadState();
  if(saved&&saved.introShown&&saved.kolom&&saved.kolom<=meta.totalKolom){
    // Resume langsung tanpa intro
    _kKolom=saved.kolom;
    _kSoalIdx=saved.soalIdx||0;
    _kBenar=saved.benar||0;
    _kSalah=saved.salah||0;
    _kBenarPrev=saved.benarPrev||0;
    _kSalahPrev=saved.salahPrev||0;
    _kTL=saved.timeLeft||meta.detikPerKolom;
    _kLog=saved.log||[];
    ss('screenKreplin');hl();
    localStorage.setItem('_activeTask','kreplin');
    kreplinRenderKolom();
    kreplinSoalBaru();
    // Timer resume dari sisa waktu
    kreplinStartTimerResume(_kTL);
    return;
  }

  // Intro hanya ditampilkan pertama kali
  cfg={title,instructions,desc,exNote,exImgTop:'',exImgBottom:'',timer:0,_taskId:'kreplin'};
  $('startTitle').innerText=title;
  $('startInstructions').innerText=instructions||desc||'';
  $('exNote').innerText=exNote||'';
  $('exampleBlock').style.display=exNote?'':'none';
  const iw=document.querySelector('#exampleBlock .example-images');if(iw)iw.style.display='none';
  $('timerNote').style.display='none';
  $('btnStart').onclick=()=>kreplinRun();
  ss('screenStart');hl();tampilTopBarId();
}

function kreplinRun(){
  _kKolom=1;_kBenar=0;_kSalah=0;_kBenarPrev=0;_kSalahPrev=0;_kLog=[];_kDone=false;_kSoalIdx=0;
  _kTL=_kCfg.detikPerKolom||30;
  localStorage.setItem('_activeTask','kreplin');
  kreplinSaveState();
  ss('screenKreplin');
  kreplinRenderKolom();
  kreplinSoalBaru();
  kreplinStartTimer();
}

function kreplinRenderKolom(){
  $('krepTitle').innerText='Tes Kraepelin';
  $('krepProgress').innerText='Kolom '+_kKolom+' / '+(_kCfg.totalKolom||45);
  $('krepProgressBar').style.width=Math.round(((_kKolom-1)/(_kCfg.totalKolom||45))*100)+'%';
}

function kreplinNextKolom(){
  if(_kKolom>_kCfg.totalKolom){kreplinSelesai();return}
  _kSoalIdx=0;
  _kTL=_kCfg.detikPerKolom||30;
  kreplinRenderKolom();
  kreplinSoalBaru();
  kreplinSaveState();
  kreplinStartTimer();
}

function kreplinSoalBaru(){
  const min=_kCfg.angkaMin||1,max=_kCfg.angkaMax||9;
  _kA=Math.floor(Math.random()*(max-min+1))+min;
  _kB=Math.floor(Math.random()*(max-min+1))+min;
  $('krepSoalQ').innerText=_kA+' + '+_kB;
  const jawaban=(_kA+_kB)%10;
  const wrap=$('krepOpts');wrap.innerHTML='';
  [0,1,2,3,4,5,6,7,8,9].forEach(n=>{
    const btn=document.createElement('button');
    btn.className='btn btn-outline btn-sm';
    btn.style.cssText='width:56px;height:56px;font-size:1.4em;font-weight:800;border-radius:12px;padding:0';
    btn.innerText=n;
    btn.onclick=()=>kreplinJawab(n,jawaban);
    wrap.appendChild(btn);
  });
}

function kreplinBuatOpsi(jawaban){
  return [0,1,2,3,4,5,6,7,8,9];
}

function kreplinJawab(pilihan,jawaban){
  const benar=pilihan===jawaban;
  if(benar)_kBenar++;else _kSalah++;
  _kSoalIdx++;
  kreplinSaveState();
  if(_kSoalIdx>=(_kCfg.soalPerKolom||50)){
    kreplinCatatKolom();
    clearInterval(_kTimer);_kTimer=null;
    _kKolom++;kreplinNextKolom();
  } else {
    kreplinSoalBaru();
  }
}

function kreplinBuildPayload(){
  const total=_kCfg.totalKolom||45;
  const dikerjakan=Array(total).fill('');
  const benar=Array(total).fill('');
  const salah=Array(total).fill('');
  _kLog.forEach(k=>{
    const i=(k.kolom||1)-1;
    if(i>=0&&i<total){
      dikerjakan[i]=String(k.soal||0);
      benar[i]=String(k.benar||0);
      salah[i]=String(k.salah||0);
    }
  });
  return {
    dikerjakan:dikerjakan.join('|'),
    benar:benar.join('|'),
    salah:salah.join('|')
  };
}

let _kBenarPrev=0,_kSalahPrev=0;

function kreplinCatatKolom(){
  const benarKolom=_kBenar-_kBenarPrev;
  const salahKolom=_kSalah-_kSalahPrev;
  _kLog.push({kolom:_kKolom,soal:_kSoalIdx,benar:benarKolom,salah:salahKolom});
  _kBenarPrev=_kBenar;
  _kSalahPrev=_kSalah;
  // Simpan progress ke server setiap akhir kolom
  const dbId=localStorage.getItem('db_id');
  if(dbId){
    aG(dbId).then(cur=>{
      const sf='x_06';
      let o={};try{o=JSON.parse(cur.data[sf]||'{}')}catch{}
      o.kreplin=kreplinBuildPayload();
      const upd={};upd[sf]=JSON.stringify(o);
      return aP(dbId,upd).then(()=>{cu=cur.data;cu[sf]=upd[sf];});
    }).catch(e=>console.warn('[kreplin] gagal simpan kolom:',e));
  }
}

function kreplinStartTimer(){
  if(_kTimer)clearInterval(_kTimer);
  kreplinUpdTimer();
  _kTimer=setInterval(()=>{
    _kTL--;kreplinUpdTimer();kreplinSaveState();
    if(_kTL<=0){
      clearInterval(_kTimer);_kTimer=null;
      kreplinCatatKolom();
      _kKolom++;kreplinNextKolom();
    }
  },1000);
}

function kreplinStartTimerResume(sisaWaktu){
  if(_kTimer)clearInterval(_kTimer);
  _kTL=sisaWaktu;
  kreplinUpdTimer();
  _kTimer=setInterval(()=>{
    _kTL--;kreplinUpdTimer();kreplinSaveState();
    if(_kTL<=0){
      clearInterval(_kTimer);_kTimer=null;
      kreplinCatatKolom();
      _kKolom++;kreplinNextKolom();
    }
  },1000);
}

function kreplinUpdTimer(){
  const m=String(Math.floor(_kTL/60)).padStart(2,'0'),s=String(_kTL%60).padStart(2,'0');
  const el=$('krepTimerDisplay');if(!el)return;
  el.innerText=m+':'+s;
  el.style.color=_kTL<=10?'var(--danger)':'var(--text)';
}

async function kreplinSelesai(){
  if(_kDone)return;_kDone=true;
  if(_kTimer){clearInterval(_kTimer);_kTimer=null;}
  kreplinClearState();
  localStorage.removeItem('_activeTask');
  const dbId=localStorage.getItem('db_id');
  if(dbId){
    sl('Menyimpan hasil...');
    try{
      const cur=await aG(dbId);
      const sf='x_06';
      let o={};try{o=JSON.parse(cur.data[sf]||'{}')}catch{}
      o.kreplin=kreplinBuildPayload();
      const upd={};upd[sf]=JSON.stringify(o);
      await aP(dbId,upd);
      cu=cur.data;cu[sf]=upd[sf];
    }catch(e){console.warn('[kreplin] gagal simpan:',e)}
  }
  hl();
  $('doneIcon').innerText='✅';
  $('doneTitle').innerText='Tes Kraepelin Selesai!';
  $('doneDesc').innerText='Hasil telah tersimpan.';
  ss('screenDone');
  setTimeout(()=>{sl('Memuat tes berikutnya...');goNext2()},2000);
}