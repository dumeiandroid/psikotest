// ============================================================
// who-engine.js
// ------------------------------------------------------------
// Engine khusus untuk tes WHO (Work Habit & Orientation):
//   - wFindNext   : cari indeks WHO test yang belum selesai
//   - wOpen       : buka satu WHO test (tampilkan instruksi)
//   - wDash       : tampilkan dashboard daftar semua WHO test
//   - wStart      : mulai mengerjakan soal WHO (load & render)
//   - wRQ         : render soal WHO mode normal (1 klik)
//   - wRQ_dual    : render soal WHO mode dual (2 langkah)
//   - wSC_dual    : handler klik langkah 1 & 2 mode dual
//   - wSC         : handler klik jawaban mode normal
//   - wGN         : navigasi ke soal WHO berikutnya
//   - wSK         : lewati soal WHO saat ini
//   - wMA         : tandai soal WHO sebagai sudah dijawab
//   - wUP         : update progress bar WHO
//   - wSS         : simpan state WHO ke localStorage
//   - wEnd        : selesaikan WHO test dan simpan ke DB
//   - wAfT        : pasca-WHO, buka test berikutnya atau goNext2
//
// State WHO tersimpan dalam variabel global:
//   wBL, wBI, wQs, wQi, wUA, wSkip, wAns, wDualFirst
//
// Bergantung pada: config.js, test-engine.js (goNext2, cekSebelumInstruksi)
// ============================================================

// ── State tambahan untuk mode dual ──
let wDualFirst=null; // menyimpan pilihan pertama (paling sesuai)

const wFindNext=()=>{for(let i=0;i<wBL.length;i++){const b=wBL[i],d=b.data,sf=d?(d.saveField||'x_07'):'x_07';let done=false;try{const o=JSON.parse(cu[sf]||'{}');done=o[b._taskId]!=null&&o[b._taskId]!==''}catch{}if(!done)return i}return -1};

async function wOpen(idx){
  // ── Periksa dulu sebelum lanjut ──
  const boleh=await cekSebelumInstruksi();
  if(!boleh)return;

  sl('Memuat tes...');
  try{
    const b=wBL[idx];if(!b.data)b.data=await(await fetch(b.dataUrl+'?v='+Date.now())).json();
    const d=b.data;
    cfg={
      _taskId:b._taskId,title:d.title||'Tes',desc:d.desc||'',
      instructions:d.instructions||'',exImgTop:d.exImgTop||'',
      exImgBottom:d.exImgBottom||'',exNote:d.exNote||'',
      saveField:d.saveField||'x_07',logField:d.logField||null,
      dataUrl:b.dataUrl,_isWho:true,
      _whoDual:(d.type||'')==='who_dual'  // ← tandai mode dual
    };
    hl();$('startTitle').innerText=cfg.title;$('startInstructions').innerText=cfg.instructions||cfg.desc;$('exNote').innerText=cfg.exNote;
    const it=$('exImgTop'),ib=$('exImgBottom');it.style.display=cfg.exImgTop?'':'none';ib.style.display=cfg.exImgBottom?'':'none';
    if(cfg.exImgTop)it.src=cfg.exImgTop;if(cfg.exImgBottom)ib.src=cfg.exImgBottom;
    $('exampleBlock').style.display=(cfg.exImgTop||cfg.exImgBottom||cfg.exNote)?'':'none';ss('screenStart');
  }catch(e){alert('Gagal: '+e.message);hl();if(wBL.length>1)wDash()}
}

async function wDash(){
  sl('Memuat daftar...');
  for(let i=0;i<wBL.length;i++){if(!wBL[i].data){try{wBL[i].data=await(await fetch(wBL[i].dataUrl+'?v='+Date.now())).json()}catch{wBL[i].data={title:'Tes '+wBL[i].fileKey}}}}
  hl();$('welcomeName').innerText='Halo, '+(gBio('bioNama')||'Peserta')+'!';
  const g=$('taskGrid');g.innerHTML='';let fp=null;
  wBL.forEach((b,i)=>{
    const d=b.data||{},sf=d.saveField||'x_07';let done=false;try{const o=JSON.parse(cu[sf]||'{}');done=o[b._taskId]!=null&&o[b._taskId]!==''}catch{}
    if(!done&&fp===null)fp=i;const cur=!done&&fp===i;
    const div=document.createElement('div');div.className='task-item'+(done?' done':cur?' current':' locked');
    div.innerHTML=`<div class="task-num">${done?'✓':i+1}</div><div class="task-name">${d.title||('Tes '+b.fileKey)}</div><span class="task-badge ${done?'badge-done':cur?'badge-current':'badge-locked'}">${done?'Selesai':cur?'▶ Mulai':'Terkunci'}</span>`;
    if(cur)div.onclick=()=>{wBI=i;wOpen(i)};g.appendChild(div);
  });
  $('welcomeSub').innerText=fp===null?'🎉 Semua selesai!':'Klik tes bertanda ▶ Mulai.';ss('screenDash');
}

async function wStart(){
  sl('Memuat soal...');
  try{
    const d=wBL[wBI].data;wQs=d.questions||[];if(!wQs.length)throw new Error('Soal kosong.');
    const sv=localStorage.getItem('_st_'+cfg._taskId);
    if(sv){
      const s=JSON.parse(sv);
      wQi=s.qIndex||0;wUA=s.userAnswers||[];wSkip=s.skippedIndices||[];wAns=s.answeredIndices||[];
      wDualFirst=s.dualFirst||null;  // resume state dual
    }
    else{wQi=0;wUA=[];wSkip=[];wAns=[];wDualFirst=null;}
    $('testTitle').innerText=cfg.title;ss('screenTest');wRQ();
  }catch(e){alert('Gagal: '+e.message);if(wBL.length>1)wDash()}finally{hl()}
}

function wRQ(){
  wUP();
  if(wQi<0||wQi>=wQs.length){if(wSkip.length>0){wQi=wSkip.shift();wSS()}else{wEnd();return}}
  if(cfg._whoDual){wRQ_dual();return}  // ← arahkan ke render dual
  // ── Mode normal (1 klik) ──
  const q=wQs[wQi],opts=q.options||{};
  const wb=wSkip.includes(wQi)?' '+SB:'';let btns='';
  for(const k of Object.keys(opts)){if(!opts[k])continue;btns+=`<button class="opt-grid-btn" onclick="wSC('${k}')"><span class="opt-key">${k}</span>${esc(opts[k])}</button>`}
  $('questionContent').innerHTML=`<div class="q-label">Soal No. ${wQi+1}${wb}</div><div class="q-text">${esc(q.question)}</div><div class="options-grid">${btns}</div>`;
  $('actionBar').innerHTML='';
}

// ── Render mode dual ──
function wRQ_dual(){
  const q=wQs[wQi],opts=q.options||{};
  const wb=wSkip.includes(wQi)?' '+SB:'';
  const isStep2=wDualFirst!==null;
  const hintCls=isStep2?'step2':'step1';
  const hintTxt=isStep2
    ?`<b style="color:#92400e">Langkah 2 / 2</b> — Pilih yang <u>PALING TIDAK SESUAI</u> diri Anda`
    :`<b style="color:var(--primary)">Langkah 1 / 2</b> — Pilih yang <u>PALING SESUAI</u> diri Anda`;
  let btns='';
  for(const k of Object.keys(opts)){
    if(!opts[k])continue;
    const isFirst=k===wDualFirst;
    const cls=isFirst?'opt-grid-btn who-selected-first':'opt-grid-btn';
    const onclk=isFirst?'':`onclick="wSC_dual('${k}')"`;
    const tag=isFirst?` <span style="font-size:.7em;background:var(--primary);color:#fff;border-radius:99px;padding:2px 8px;margin-left:4px">✓ Dipilih</span>`:'';
    btns+=`<button class="${cls}" ${onclk}><span class="opt-key">${k}</span>${esc(opts[k])}${tag}</button>`;
  }
  $('questionContent').innerHTML=`
    <div class="q-label">Soal No. ${wQi+1}${wb}</div>
    <div class="q-text">${esc(q.question)}</div>
    <div class="who-dual-hint ${hintCls}">${hintTxt}</div>
    <div class="options-grid">${btns}</div>`;
  $('actionBar').innerHTML='';
}

// ── Handler klik mode dual ──
function wSC_dual(k){
  if(wDualFirst===null){
    // Klik pertama: simpan, render ulang dengan step 2
    wDualFirst=k;
    wSS();
    wRQ_dual();
  } else {
    // Klik kedua: gabung, simpan ke wUA, lanjut
    const combined=wDualFirst+'_'+k;
    wDualFirst=null;
    wMA(wQi);
    wUA.push(combined);
    wSS();
    wGN();
  }
}

function wSC(k){wMA(wQi);wUA.push(k);wSS();wGN()}
function wSS(){localStorage.setItem('_st_'+cfg._taskId,JSON.stringify({qIndex:wQi,userAnswers:wUA,skippedIndices:wSkip,answeredIndices:wAns,dualFirst:wDualFirst}))}
function wGN(){
  let f=-1;for(let i=wQi+1;i<wQs.length;i++){if(!wAns.includes(i)&&!wSkip.includes(i)){f=i;break}}
  if(f!==-1){wQi=f}else if(wSkip.length>0){wQi=wSkip.shift()}else{wSS();wEnd();return}
  wDualFirst=null;wSS();wRQ();
}
function wSK(){
  if(!wSkip.includes(wQi)&&!wAns.includes(wQi)){wSkip.push(wQi);wUA.push('SKIP')}
  wDualFirst=null;
  let f=-1;for(let i=wQi+1;i<wQs.length;i++){if(!wAns.includes(i)&&!wSkip.includes(i)){f=i;break}}
  if(f!==-1){wQi=f}else if(wSkip.length>0){wQi=wSkip.shift()}else{wSS();wEnd();return}
  wSS();wRQ();
}
function wMA(idx){if(!wAns.includes(idx))wAns.push(idx);const p=wSkip.indexOf(idx);if(p!==-1){wSkip.splice(p,1);const u=wUA.indexOf('SKIP');if(u!==-1)wUA.splice(u,1)}}
function wUP(){const t=wQs.length,d=wAns.length;$('progressBar').style.width=(t?Math.round((d/t)*100):0)+'%';let info=`Soal ${wQi+1} / ${t}`;if(wSkip.length>0)info+=` · ⟳ ${wSkip.length} dilewati`;$('progressInfo').innerText=info;const bt=$('bbTitle'),bp=$('bbProgress');if(bt)bt.innerText=cfg.title||'';if(bp)bp.innerText=info}
function wAfT(){const i=wFindNext();if(i!==-1){wBI=i;wOpen(i)}else goNext2()}
async function wEnd(){
  sl('Menyimpan...');const id=localStorage.getItem('db_id');
  try{const cur=await aG(id),sf=cfg.saveField;let o={};try{o=JSON.parse(cur.data[sf]||'{}')}catch{}o[cfg._taskId]=wUA.join(';')+';';const v=JSON.stringify(o);await aP(id,{[sf]:v});localStorage.removeItem('_st_'+cfg._taskId);wDualFirst=null;cu=cur.data;cu[sf]=v;hl();wAfT()}
  catch(e){alert('Gagal: '+e.message);hl()}
}