// ============================================================
// test-engine.js
// ------------------------------------------------------------
// Mesin utama yang mengatur seluruh alur tes standar:
//   - goNext2       : tentukan subtes berikutnya dan buka
//   - openById      : buka subtes berdasarkan ID config
//   - startTest     : mulai/resume tes (load soal, timer, UI)
//   - loadQ         : fetch dan parse data soal dari server
//   - renderQ       : tampilkan soal sesuai tipe config
//   - updProg       : update progress bar dan label
//   - goNx / skipQ  : navigasi soal berikutnya / lewati soal
//   - mAns          : tandai soal sebagai sudah dijawab
//   - endTest       : selesaikan tes dan simpan hasil ke DB
//   - afterT / farC : pasca-tes, lanjut ke subtes berikutnya
//   - saveSt        : simpan state soal ke localStorage
//   - resetSt       : reset semua state soal ke awal
//   - startTimer    : jalankan timer countdown
//   - startSW       : jalankan stopwatch (tanpa batas waktu)
//   - updTimer      : update tampilan timer
//   - syncT         : kirim timestamp START ke DB
//   - doneAll       : semua subtes selesai → screen upgrade
//   - upShowDetail / upSelectPaket / upSkip : pilihan laporan
//   - cekSebelumInstruksi : validasi status sebelum soal tampil
//
// Bergantung pada: config.js, renderers.js, who-engine.js,
//                  kreplin.js, ui.js, auth.js
// ============================================================

async function goNext2(){
  // ── Cek status logout dari cu (data sudah ada di memori, 0 request) ──
  try{let bio={};try{bio=JSON.parse(cu?.x_02||'{}')}catch{}cekTombolLogout(bio.logout===true);}catch{}
  // ── Periksa dulu sebelum lanjut ke instruksi berikutnya ──
  const boleh=await cekSebelumInstruksi();
  if(!boleh)return;

  // ── RESTORE: kalau ada soal aktif saat refresh, langsung lanjutkan tanpa instruksi ──
  const activeTask=localStorage.getItem('_activeTask');
  if(activeTask){
    const stKey='_st_'+activeTask;
    const stData=localStorage.getItem(stKey);
    // Kreplin: state-nya disimpan dengan key berbeda (_kreplinState)
    if(activeTask==='kreplin'){
      const krepSaved=kreplinLoadState();
      if(krepSaved&&krepSaved.introShown){
        const krepRef=UT.find(u=>u.type==='kreplin');
        if(krepRef){hl();await kreplinStart(krepRef.ref);return;}
      }else{localStorage.removeItem('_activeTask');}
    }else if(stData){
      // State masih ada — coba temukan config-nya dan langsung startTest()
      const isSub=activeTask.includes('_k');
      let base,kol;
      if(isSub){const b=activeTask.replace(/_k\d+$/,'');kol=parseInt(activeTask.split('_k')[1]);base=AC.find(c=>c.id===b);if(base)cfg={...base,kolom:kol,_taskId:activeTask}}
      else{base=AC.find(c=>c.id===activeTask);if(base)cfg={...base,_taskId:activeTask}}
      if(base&&cfg){
        // Muat meta jika belum ada
        if(cfg.dataUrl&&!cfg.title){
          try{sl('Memuat...');const raw=await(await fetch(cfg.dataUrl+'?v='+Date.now())).json();
            if(raw&&!Array.isArray(raw)&&raw.meta&&raw.soal){for(const k of Object.keys(raw.meta)){if(cfg[k]==null||cfg[k]==='')cfg[k]=raw.meta[k]}cfg._cs=raw.soal}}catch(e){console.warn('[restore]',e)}
        }
        await startTest();return;
      }
      // Config tidak ditemukan — bersihkan saja dan lanjut normal
      localStorage.removeItem('_activeTask');
      localStorage.removeItem(stKey);
    }else{
      // State sudah hilang (soal sudah selesai sebelumnya) — bersihkan
      localStorage.removeItem('_activeTask');
    }
  }

  for(const ut of UT){
    if(ut.type==='who'){wBL=WTL;const i=wFindNext();if(i!==-1){wBI=i;wOpen(i);return}}
    else if(ut.type==='kreplin'){
      let done=false;try{const o=JSON.parse(cu.x_06||'{}');done=!!o.kreplin&&o.kreplin.dikerjakan!==''}catch{}
      if(!done){hl();await kreplinStart(ut.ref);return}
    }
    else{
      const t=ut.ref;
      if(t.type==='ranking'&&t.totalKolom&&!t.id.includes('_k')){
        let fu=null;try{const o=JSON.parse(cu[t.saveField]||'{}');for(let k=1;k<=t.totalKolom;k++){if(o[t.id+'_k'+k]==null||o[t.id+'_k'+k]===''){fu=t.id+'_k'+k;break}}}catch{}
        if(fu){await openById(fu);return}continue;
      }
      const AL={'tkd3':'tkd5','tkd6':'deret6'};let done=false;
      try{const o=JSON.parse(cu[t.saveField]||'{}');done=o[t.id]!=null&&o[t.id]!=='';if(!done&&AL[t.id]){const a=AL[t.id];done=o[a]!=null&&o[a]!==''}}catch{}
      if(!done){await openById(t.id);return}
    }
  }
  doneAll();
}

function doneAll(){stopGlobalPolling();stopPolling();hl();ss('screenUpgrade');tampilTopBarId();startLogoutPoll();}

// ── UPGRADE LAPORAN ──
let upPaketSel=null,upHargaSel=0;
function upShowDetail(id,nama,harga,desc,el){
  const box=document.getElementById('upDetailBox');
  const wasSelected=el.classList.contains('selected');
  document.querySelectorAll('.up-paket-card').forEach(c=>c.classList.remove('selected'));
  if(wasSelected){box.classList.remove('show');return}
  el.classList.add('selected');
  trackBtn('lap_'+id);
  document.getElementById('upDetailName').textContent=nama;
  document.getElementById('upDetailPrice').textContent='Rp '+harga.toLocaleString('id-ID');
  document.getElementById('upDetailDesc').textContent=desc;
  document.getElementById('upDetailBtn').onclick=()=>upSelectPaket(nama,harga,el);
  box.classList.add('show');
  box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function upConfirmDetail(){}
async function upSelectPaket(nama,harga,el){
  trackBtn('lap_pilih_'+nama.toLowerCase());
  upPaketSel=nama;upHargaSel=harga;
  document.querySelectorAll('.up-paket-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  const pi=document.getElementById('upPaymentInfo');
  const nom=document.getElementById('upNominal');
  const btn=document.getElementById('upWaBtn');
  pi.classList.add('show');
  nom.textContent='Rp '+harga.toLocaleString('id-ID');
  const hariMap={'Dasar':'1 hari','Lengkap':'2 hari','Komprehensif':'3 hari'};
  const hariEl=document.getElementById('upHariEstimasi');
  if(hariEl)hariEl.textContent=hariMap[nama]||'3 hari';
  const id=localStorage.getItem('db_id')||'—';
  const tok=localStorage.getItem('token')||'—';
  const telp=gBio('biotelepon')||(() => {try{return JSON.parse((cu&&cu.x_02)||'{}').telepon||'—'}catch{return'—'}})();
  const msg=encodeURIComponent('Halo Lidan Psikologi, saya ingin memesan laporan hasil Tes IQ.\n\nPaket: '+nama+'\nHarga: Rp '+harga.toLocaleString('id-ID')+'\nID: '+id+'\nToken: '+tok+'\nNo. Telepon: '+telp+'\n\nMohon informasi selanjutnya. Terima kasih.');
  btn.href='https://wa.me/6285159601400?text='+msg;
  btn.onclick=()=>{trackBtn('lap_wa_'+nama.toLowerCase())};
  btn.style.display='flex';
  const dbId=localStorage.getItem('db_id');
  if(dbId){
    try{
      let bioObj={};try{bioObj=JSON.parse((cu&&cu.x_02)||localStorage.getItem('_bio_bak')||'{}')}catch{}
      bioObj.paket_laporan=nama;bioObj.harga_laporan='Rp '+harga.toLocaleString('id-ID');bioObj.tgl_pilih_laporan=td();
      const newBio=JSON.stringify(bioObj);await aP(dbId,{x_02:newBio});if(cu)cu.x_02=newBio;
    }catch(e){console.warn('[LAPORAN] Gagal update paket:',e)}
  }
}
function upSkip(){trackBtn('lap_lewati');$('doneIcon').innerText='🎉';$('doneTitle').innerText='Semua Tes Selesai!';$('doneDesc').innerText='Terima kasih sudah mengikuti tes. Hasil Anda telah tersimpan.';ss('screenDone');tampilTopBarId();startLogoutPoll();}

// ─── Pemeriksaan Ganda: Tes Global & Status Kolom ───────────────────────────
// Dipanggil sebelum setiap instruksi / soal ditampilkan.
// Mengembalikan true jika aman dilanjutkan, false jika dialihkan.
async function cekSebelumInstruksi(){
  // 1) Periksa apakah tes global masih aktif
  sl('Memeriksa status tes...');
  const kontrol=await cekKontrol();
  if(!kontrol.aktif){
    hl();showScreenTutup(kontrol);
    return false;
  }
  // 2) Periksa apakah status peserta masih aktif (kolom aktifkan)
  // Untuk paket auto-aktif, skip pengecekan status DB (tidak perlu aktivasi admin)
  if(!IS_AUTO_AKTIF){
    try{
      const id=localStorage.getItem('db_id');
      if(id){
        const res=await aF(`${API_R}?table=${TBL}&id_x=${id}`,{headers:{'X-Custom-Auth':AUTH}});
        if(res.success&&res.data){
          cu=res.data;
          let status='nonaktif';try{status=JSON.parse(cu.x_02||'{}').status||'nonaktif'}catch{}
          if(status!=='aktif'){
            hl();ss('screenTunggu');showZoomTunggu();startGlobalPolling();
            return false;
          }
        }
      }
    }catch(e){console.warn('[cekSebelumInstruksi] Gagal cek status peserta:',e)}
  }
  return true;
}

async function openById(tid){
  // ── Periksa dulu sebelum lanjut ──
  const boleh=await cekSebelumInstruksi();
  if(!boleh)return;

  const isSub=tid.includes('_k');let base,kol;
  if(isSub){const b=tid.replace(/_k\d+$/,'');kol=parseInt(tid.split('_k')[1]);base=AC.find(c=>c.id===b);cfg={...base,kolom:kol,_taskId:tid}}
  else{base=AC.find(c=>c.id===tid);cfg={...base,_taskId:tid}}
  if(!base){console.error('[openById]',tid);hl();return}
  if(cfg.dataUrl&&!cfg.title){
    try{sl('Memuat...');const raw=await(await fetch(cfg.dataUrl+'?v='+Date.now())).json();
      if(raw&&!Array.isArray(raw)&&raw.meta&&raw.soal){for(const k of Object.keys(raw.meta)){if(cfg[k]==null||cfg[k]==='')cfg[k]=raw.meta[k]}cfg._cs=raw.soal}}catch(e){console.warn(e)}
  }
  if(cfg.showInstructionsOnce&&cfg.kolom>1){rSel=Array(12).fill(null);uNum=[];sl('Memuat soal...');setTimeout(()=>startTest(),100);return}
  $('startTitle').innerText=cfg.title||cfg.id;$('startInstructions').innerText=cfg.instructions||cfg.desc||'';$('exNote').innerText=cfg.exNote||'';
  const hi=cfg.exImgTop||cfg.exImgBottom,hn=cfg.exNote&&cfg.exNote.trim();
  $('exampleBlock').style.display=(hi||hn)?'':'none';
  const iw=document.querySelector('#exampleBlock .example-images');if(iw)iw.style.display=hi?'':'none';
  if(cfg.exImgTop)$('exImgTop').src=cfg.exImgTop;if(cfg.exImgBottom)$('exImgBottom').src=cfg.exImgBottom;
  if(cfg.timer>0){const m=Math.floor(cfg.timer/60),s=cfg.timer%60;$('timerNote').innerText='⏱ Batas waktu: '+(m>0?m+'m '+(s>0?s+'d':''):s+'d').trim();$('timerNote').style.display='none'}
  else $('timerNote').style.display='none';
  ss('screenStart');hl();tampilTopBarId();
}

async function startTest(){
  if(cfg&&cfg._isWho){await wStart();return}
  sl('Memuat soal...');
  // Tandai soal yang sedang aktif agar bisa di-restore saat refresh
  if(cfg&&cfg._taskId) localStorage.setItem('_activeTask', cfg._taskId);
  try{
    await loadQ();
    const sv=localStorage.getItem('_st_'+cfg._taskId);
    if(sv){const s=JSON.parse(sv),rr=s.rowSelections||Array(12).fill(null);
      if(rr.filter(n=>n!==null).length<12){qi=s.qIndex||0;ua=s.userAnswers||[];sc=s.correctScore||0;tl=s.timeLeft||cfg.timer;rSel=rr;uNum=s.usedNumbers||[];skip=s.skippedIndices||[];ans=s.answeredIndices||[]}
      else{localStorage.removeItem('_st_'+cfg._taskId);resetSt()}}
    else resetSt();
    $('testTitle').innerText=cfg.title;ss('screenTest');$('timerDisplay').classList.add('hidden');tStarted=false;tampilTopBarId();
    if(cfg.timer>0){updTimer();startTimer()}else startSW();
    vCnt=0;fEnd=false;renderQ();
  }catch(e){alert('Gagal: '+e.message);ss('screenDash')}finally{hl()}
}
function resetSt(){qi=0;ua=[];sc=0;tl=cfg.timer||0;rSel=Array(12).fill(null);uNum=[];skip=[];ans=[]}
async function loadQ(){
  let data;
  if(cfg._cs){data=cfg._cs;delete cfg._cs}
  else{const raw=await(await fetch(cfg.dataUrl+'?v='+Date.now())).json();
    if(raw&&!Array.isArray(raw)&&raw.meta&&raw.soal){for(const k of Object.keys(raw.meta)){if(cfg[k]==null||cfg[k]==='')cfg[k]=raw.meta[k]}data=raw.soal}else data=raw}
  if(cfg.type==='ranking'){const hg=data.some(d=>d.gender);let fd=data;
    if(hg){const g=gBio('bioGender')||'L';fd=data.filter(d=>d.gender===g)}
    const kd=fd.find(d=>d.kolom===cfg.kolom);if(!kd)throw new Error('Kolom '+cfg.kolom+' tdk ada');cfg._pem=kd.pembuka;qs=kd.soal.map((s,i)=>({text:s,id:i}))}
  else qs=data;
}

function startTimer(){
  if(tStarted)return;tStarted=true;if(!tl)tl=cfg.timer;
  ti=setInterval(()=>{tl--;updTimer();saveSt();if(tl<=0){clearInterval(ti);endTest(true)}},1000);
  // Hanya kirim ke DB saat pertama kali mulai (bukan resume setelah refresh).
  const isResume = tl < cfg.timer;
  if(!isResume){
    syncT('START:'+cfg.title+':'+new Date().toISOString()+':'+cfg.timer);
  }
}
function startSW(){swEl=0;ti=setInterval(()=>{swEl++;saveSt()},1000)}
async function syncT(v){
  const id=localStorage.getItem('db_id');if(!id)return;
  try{await fetch(`${API_W}?table=${TBL}&id_x=${id}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Custom-Auth':AUTH},body:JSON.stringify({x_04:v})})}catch{}
}
function updTimer(){
  const m=String(Math.floor(tl/60)).padStart(2,'0'),s=String(tl%60).padStart(2,'0');
  // Timer disembunyikan dari user — hanya tampil di DevTools console untuk developer
  const el=$('timerDisplay');
  if(el){el.innerText=m+':'+s;el.classList.add('hidden');}
  console.log('[TIMER]',(cfg&&cfg._taskId)||'',m+':'+s);
}

function saveSt(){localStorage.setItem('_st_'+cfg._taskId,JSON.stringify({qIndex:qi,userAnswers:ua,correctScore:sc,timeLeft:tl,rowSelections:rSel,usedNumbers:uNum,skippedIndices:skip,answeredIndices:ans}))}

const SB='<span style="background:#fef3c7;color:#92400e;font-size:.75em;padding:2px 8px;border-radius:99px;font-weight:600">⟳ Dilewati</span>';
const skB=()=>skip.includes(qi)?' '+SB:'';

function renderQ(){
  updProg();if(cfg.type==='ranking'){renderRank();return}dbg('renderQ');
  if(qi<0||qi>=qs.length){if(skip.length>0){qi=skip.shift();saveSt()}else{endTest(false);return}}
  const q=qs[qi];
  ({image_single:rImgS,image_multi:rImgM,text_choice:rTxtC,text_input:rTxtI,text_input_scored:rTIS,digit_check:rDC,ab_choice:rAB}[cfg.type]||(_=>{}))(q);
}
function updProg(){
  const tot=cfg.type==='ranking'?8:qs.length,cur=cfg.type==='ranking'?(cfg.kolom||1):qi+1;
  $('progressBar').style.width=(tot?Math.round(((cur-1)/tot)*100):0)+'%';
  let info=cfg.type==='ranking'?`Kolom ${cfg.kolom} / ${cfg.totalKolom||8}`:`Soal ${qi+1} / ${qs.length}`;
  if(skip.length>0&&cfg.type!=='ranking')info+=` · ⟳ ${skip.length} dilewati`;
  $('progressInfo').innerText=info;const bt=$('bbTitle'),bp=$('bbProgress');if(bt)bt.innerText=cfg.title||'';if(bp)bp.innerText=info;
}

function goNx(){
  dbg('goNext');let f=-1;for(let i=qi+1;i<qs.length;i++){if(!ans.includes(i)&&!skip.includes(i)){f=i;break}}
  if(f!==-1){qi=f;dbg('→'+qi)}else if(skip.length>0){qi=skip.shift();dbg('→skip '+qi)}else{dbg('→selesai');saveSt();endTest(false);return}
  saveSt();renderQ();
}
function skipQ(){
  dbg('skipQ');if(!skip.includes(qi)&&!ans.includes(qi)){skip.push(qi);ua.push(`${qi+1}SKIPx`)}
  let f=-1;for(let i=qi+1;i<qs.length;i++){if(!ans.includes(i)&&!skip.includes(i)){f=i;break}}
  if(f!==-1){qi=f}else if(skip.length>0){qi=skip.shift()}else{saveSt();endTest(false);return}
  saveSt();renderQ();
}
function mAns(idx){
  if(!ans.includes(idx))ans.push(idx);const p=skip.indexOf(idx);
  if(p!==-1){skip.splice(p,1);const u=ua.indexOf(`${idx+1}SKIPx`);if(u!==-1)ua.splice(u,1)}
}

async function endTest(to){
  clearInterval(ti);sl('Menyimpan hasil...');const id=localStorage.getItem('db_id');
  try{
    const cur=await aG(id),upd={},sf=cfg.saveField;let o={};try{o=JSON.parse(cur.data[sf]||'{}')}catch{}
    if(cfg.type==='ab_choice')o[cfg.id]=ua.join(';')+';';
    else if(cfg.type==='ranking')o[cfg.id]=ua.join(';');
    else o[cfg.id]=sc;
    upd[sf]=JSON.stringify(o);
    if(cfg.logField&&qs.length>0){let lo={};try{lo=JSON.parse(cur.data[cfg.logField]||'{}')}catch{}lo[cfg.id]=ua.map((a,i)=>{const q=qs[i];if(!q)return'';if(cfg.type==='text_input_scored'){return`${i+1}.${a}✗`}return`${i+1}.${a}${String(a).toLowerCase()===String(q.answer||q.correctAnswer||'').toLowerCase()?'✓':'✗'}`}).join(';');upd[cfg.logField]=JSON.stringify(lo)}
    if(cfg.timer>0)upd.x_04='';upd.x_12='';
    await aP(id,upd);
    localStorage.removeItem('_st_'+cfg._taskId);
    localStorage.removeItem('_activeTask');
    cu=cur.data;cu[sf]=upd[sf];if(cfg.logField)cu[cfg.logField]=upd[cfg.logField];
    hl();afterT();
  }catch(e){alert('Gagal: '+e.message);hl()}
}
function afterT(){
  try{
    vMap={};if(cu.x_09){try{const v=JSON.parse(cu.x_09);Object.entries(v).forEach(([k,vl])=>{if(k&&/^[a-zA-Z0-9_]+$/.test(k))vMap[k]=parseInt(vl)||0})}catch{}}
    goNext2();
  }catch(e){console.error('[afterT]',e);farC(localStorage.getItem('token'))}
}
async function farC(token){
  sl('Memeriksa...');
  try{
    const res=await aF(`${API_R}?table=${TBL}&x_01_eq=${token}`,{headers:{'X-Custom-Auth':AUTH}});
    if(!res.success||!res.count){localStorage.clear();hl();ss('screenDaftar');loadPaket();return}
    cu=res.data[0];localStorage.setItem('db_id',cu.id_x);
    vMap={};if(cu.x_09){try{const v=JSON.parse(cu.x_09);Object.entries(v).forEach(([k,vl])=>{if(k&&/^[a-zA-Z0-9_]+$/.test(k))vMap[k]=parseInt(vl)||0})}catch{}}
    await loadAC();await goNext2();
  }catch(e){console.error(e);hl();ss('screenDaftar');loadPaket()}
  finally{hl()}
}