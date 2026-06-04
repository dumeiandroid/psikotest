// ============================================================
// auth.js
// ------------------------------------------------------------
// Mengelola semua proses autentikasi dan sesi peserta:
//   - Popup token: buka, tutup, login dengan token
//   - Pendaftaran peserta baru (handleDaftar)
//   - Validasi form biodata (nama, usia, telepon, kesediaan)
//   - Generate token unik peserta
//   - Load daftar paket dari DB (loadPaket)
//   - Load config subtes aktif sesuai paket (loadAC)
//   - Cek & restore sesi peserta yang sudah punya token
//   - Logout: reset sesi lokal dan flag DB (doLogout)
//   - Tampil/sembunyikan tombol logout dan ID bar
//
// Bergantung pada: config.js
// Dipanggil oleh: app.js (window.onload), ui.js (polling)
// ============================================================

function bukaPopupToken(){
  const popup=document.getElementById('popupToken');
  popup.style.display='block';
  setTimeout(()=>document.getElementById('inputToken').focus(),50);
}
function tutupPopupToken(){
  document.getElementById('popupToken').style.display='none';
  document.getElementById('inputToken').value='';
  document.getElementById('tokenErrBox').classList.remove('show');
}
function sembunyikanTokenBtn(){
  const btn=document.getElementById('btnTokenFloat');
  const popup=document.getElementById('popupToken');
  if(btn) btn.style.display='none';
  if(popup) popup.style.display='none';
}

async function loginDenganToken(){
  const input=document.getElementById('inputToken');
  const errBox=document.getElementById('tokenErrBox');
  const btn=document.getElementById('btnLoginToken');
  const tok=(input.value||'').trim();
  errBox.classList.remove('show');
  if(!tok){ errBox.textContent='⚠ Masukkan token terlebih dahulu.'; errBox.classList.add('show'); return; }
  btn.disabled=true; btn.textContent='⏳ Memeriksa...'; sl('Memeriksa token...');
  try{
    const d=await aF(`${API_W}?table=${TBL}&x_01_eq=${encodeURIComponent(tok)}`,{headers:{'X-Custom-Auth':AUTH}});
    if(!d.success||!d.data||(Array.isArray(d.data)&&d.data.length===0)){
      errBox.textContent='❌ Token tidak ditemukan. Periksa kembali token Anda.';
      errBox.classList.add('show'); hl(); return;
    }
    const row=Array.isArray(d.data)?d.data[0]:d.data;
    let pnm=AUTO_PAKET||'';
    if(!pnm){
      const tokPrefix=tok.split('-')[0]||'';
      const found=pList.find(p=>(p.x_01||'').trim().toLowerCase()===tokPrefix.toLowerCase());
      if(found) pnm=(found.x_01||'').trim();
    }
    localStorage.setItem('token',tok);
    localStorage.setItem('db_id',String(row.id_x));
    localStorage.setItem('_p',pnm);
    cu=row;
    tutupPopupToken();
    sl('Memuat tes...');
    await loadAC();
    let bioObj={};try{bioObj=JSON.parse(cu.x_02||'{}')}catch{}
    const status=bioObj.status||'nonaktif';
    hl();
    if(IS_AUTO_AKTIF){ startGlobalPolling(); await goNext2(); }
    else if(status==='aktif'){ startGlobalPolling(); await goNext2(); }
    else{ ss('screenTunggu'); showZoomTunggu(); startGlobalPolling(); }
  }catch(e){
    errBox.textContent='⚠ Gagal: '+e.message; errBox.classList.add('show'); hl();
  }finally{
    btn.disabled=false; btn.textContent='🔑 Masuk';
  }
}

async function chkTok(t){try{const d=await aF(`${API_W}?table=${TBL}&x_01_eq=${encodeURIComponent(t)}`,{headers:{'X-Custom-Auth':AUTH}});return d.success&&d.count>0}catch{return false}}
async function genTok(pid){for(let i=0;i<10;i++){const t=pid+'-'+rs(i<8?12:14);if(!(await chkTok(t)))return t}return pid+'-'+rs(16)}

async function loadPaket(){
  try{
    const d=await aF(`${API_R}?table=${TBL_P}`,{headers:{'X-Custom-Auth':AUTH}});
    pList=(d.success&&d.data)||[];
    sPaket=pList.find(p=>(p.x_01||'').trim()===AUTO_PAKET)||null;
    if(!sPaket)console.warn('[loadPaket] Paket tidak ditemukan:',AUTO_PAKET);
  }catch(e){console.error('[loadPaket]',e)}
}

function showPaketNotFoundScreen(){
  hl();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  let errScreen=$('screenPaketTidakAda');
  if(!errScreen){
    errScreen=document.createElement('div');
    errScreen.id='screenPaketTidakAda';
    errScreen.className='screen active';
    errScreen.innerHTML=`
      <div class="card" style="text-align:center;margin-top:40px">
        <div style="font-size:3em;margin-bottom:12px">🔍</div>
        <div style="font-size:1.25em;font-weight:700;color:var(--danger);margin-bottom:10px">Paket Tidak Ada</div>
        <p style="color:var(--muted);font-size:.9em;line-height:1.7">
          Paket <strong style="color:var(--text)">${AUTO_PAKET}</strong> tidak ditemukan.<br>
          Pastikan nama paket sudah benar atau hubungi administrator.
        </p>
      </div>`;
    document.body.appendChild(errScreen);
  }else{
    errScreen.classList.add('active');
  }
}
function renderPaket(){}

// ─── Sinkronisasi tampilan radio button biodata ───
function syncRadioStyle(){
  const y=$('bioKesediaanY'),n=$('bioKesediaanN');
  const ly=$('radioLabelBersedia'),ln=$('radioLabelTidak');
  if(!ly||!ln)return;
  ly.style.borderColor=(y&&y.checked)?'var(--primary)':'var(--border)';
  ly.style.background=(y&&y.checked)?'#eff6ff':'';
  ln.style.borderColor=(n&&n.checked)?'var(--primary)':'var(--border)';
  ln.style.background=(n&&n.checked)?'#eff6ff':'';
}

async function handleDaftar(){
  const eb=$('daftarErrBox');eb.classList.remove('show');
  for(const[id,lb]of[['bioNama','Nama'],['bioUsia','Usia'],['bioPend','Pendidikan'],['bioGender','Jenis Kelamin']]){
    const el=$(id);el.classList.remove('error');if(!el.value.trim()){el.classList.add('error');el.focus();eb.textContent='Mohon isi: '+lb;eb.classList.add('show');return}
  }
  const telpEl=$('bioTelp');telpEl.classList.remove('error');
  const telpVal=telpEl.value.trim().replace(/\s+/g,'');
  if(!telpVal){telpEl.classList.add('error');telpEl.focus();eb.textContent='Mohon isi: Nomor Telepon / WhatsApp';eb.classList.add('show');return}
  if(!/^(\+62|62|0)[0-9]{8,13}$/.test(telpVal)){telpEl.classList.add('error');telpEl.focus();eb.textContent='Format nomor telepon tidak valid. Contoh: 08123456789 atau +6281234567890';eb.classList.add('show');return}
  const kesediaanEl=document.querySelector('input[name="bioKesediaan"]:checked');
  const adaKesediaan=document.querySelector('input[name="bioKesediaan"]');
  if(adaKesediaan&&!kesediaanEl){
    eb.textContent='Mohon pilih kesediaan dihubungi perusahaan.';eb.classList.add('show');
    const ly=$('radioLabelBersedia'),ln=$('radioLabelTidak');
    if(ly)ly.style.borderColor='var(--danger)';if(ln)ln.style.borderColor='var(--danger)';
    return;
  }
  if(!sPaket){eb.textContent='⚠ Paket tes tidak ditemukan. Hubungi administrator.';eb.classList.add('show');return}
  const btn=$('btnDaftar');sLoad(btn,true);sl('Membuat token...');
  try{
    const pid=String(sPaket.id_x).trim(),pnm=(sPaket.x_01||'').trim();
    const tok=await genTok(pid);
    const bio=JSON.stringify({
      nama:$('bioNama').value.trim(),
      usia:$('bioUsia').value.trim(),
      pendidikan:$('bioPend').value.trim(),
      jenis_kelamin:$('bioGender').value.trim(),
      telepon:telpVal,
      kesediaan_dihubungi:kesediaanEl?kesediaanEl.value:'tidak_berlaku',
      tgl_tes:td(),
      status:IS_AUTO_AKTIF?'aktif':'nonaktif'
    });
    sl('Menyimpan data...');
    const res=await aF(`${API_W}?table=${TBL}`,{method:'POST',headers:{'Content-Type':'application/json','X-Custom-Auth':AUTH},body:JSON.stringify({x_01:tok,x_02:bio})});
    if(!res.success)throw new Error(res.message||'Gagal.');
    localStorage.setItem('token',tok);localStorage.setItem('db_id',String(res.id_x));localStorage.setItem('_p',pnm);
    cu={id_x:res.id_x,x_01:tok,x_02:bio};sl('Memuat tes...');await loadAC();
    if(IS_AUTO_AKTIF){hl();startGlobalPolling();await goNext2();}
    else{
      hl();ss('screenTunggu');showZoomTunggu();startGlobalPolling();
      const idBox=document.getElementById('tungguIdBox');
      const idNum=document.getElementById('tungguIdNum');
      if(idBox&&idNum){idNum.textContent=String(res.id_x);idBox.style.display='block';}
    }
  }catch(e){hl();eb.textContent='⚠ '+e.message;eb.classList.add('show');sLoad(btn,false)}
}

async function loadAC(){
  const p=localStorage.getItem('_p');
  function expand(list){const r=[];for(const c of list){if(c.type==='ranking'&&c.totalKolom){for(let k=1;k<=c.totalKolom;k++)r.push({type:'config',ref:{...c,id:c.id+'_k'+k,_baseId:c.id,kolom:k,_taskId:c.id+'_k'+k}})}else r.push({type:'config',ref:c})}return r}
  if(!p){AC=ALL_CONFIG;WTL=[];UT=expand(ALL_CONFIG);return}
  try{
    const d=await aF(`${API_R}?table=${TBL_P}&x_01_eq=${encodeURIComponent(p)}`,{headers:{'X-Custom-Auth':AUTH}});
    if(!d.success||!d.count){AC=ALL_CONFIG;WTL=[];UT=expand(ALL_CONFIG);return}
    const items=(d.data[0].x_02||'').split('|').map(s=>s.trim()).filter(Boolean);
    AC=[];WTL=[];UT=[];
    for(const item of items){
      if(item.startsWith('who:')){const k=item.slice(4).trim(),w={fileKey:k,dataUrl:WHO_B+k+'.txt',data:null,_taskId:'who_'+k};WTL.push(w);UT.push({type:'who',ref:w})}
      else if(item==='kreplin'){const c=ALL_CONFIG.find(c=>c.id==='kreplin');if(c){AC.push(c);UT.push({type:'kreplin',ref:{...c,_taskId:'kreplin'}})}}
      else{const k=item.replace(/\.txt$/i,''),c=ALL_CONFIG.find(c=>(c.dataUrl||'').split('/').pop().replace(/\.txt$/i,'')==k);
        if(c){AC.push(c);if(c.type==='ranking'&&c.totalKolom){for(let ki=1;ki<=c.totalKolom;ki++)UT.push({type:'config',ref:{...c,id:c.id+'_k'+ki,_baseId:c.id,kolom:ki,_taskId:c.id+'_k'+ki}})}else UT.push({type:'config',ref:c})}}
    }
    await Promise.all(WTL.map(async w=>{try{w.data=await(await fetch(w.dataUrl+'?v='+Date.now())).json()}catch(e){console.warn('[who]',w.fileKey,e)}}));
  }catch(e){console.error('[loadAC]',e);AC=ALL_CONFIG;WTL=[];UT=expand(ALL_CONFIG)}
}

async function doLogout(dbId){
  try{
    let bioObj={};try{bioObj=JSON.parse(cu.x_02||'{}')}catch{}
    bioObj.logout=false;
    await fetch(`${API_W}?table=${TBL}&id_x=${dbId}`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','X-Custom-Auth':AUTH},
      body:JSON.stringify({x_02:JSON.stringify(bioObj)})
    });
  }catch(e){console.warn('[logout] gagal reset flag:',e)}
  localStorage.clear();
  stopGlobalPolling();
  stopLogoutPoll();
  hl();
  ss('screenDaftar');
  loadPaket();
  startGlobalPolling();
}

function tampilTopBarId(){
  const el=document.getElementById('topBarId');
  if(!el)return;
  const id=localStorage.getItem('db_id');
  if(id){el.textContent='ID: '+id;el.style.display='inline-block';}
  else{el.style.display='none';}
}

function cekTombolLogout(aktif){
  const btn=$('btnLogoutPeserta');
  if(!btn)return;
  btn.style.display=aktif?'inline-flex':'none';
}