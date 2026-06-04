// ============================================================
// config.js
// ------------------------------------------------------------
// Berisi SEMUA konfigurasi statis dan variabel global aplikasi:
//   - Parameter URL (?p=nama-paket)
//   - Daftar paket yang auto-aktif
//   - URL endpoint API (tulis & baca)
//   - Nama tabel database
//   - ALL_CONFIG: daftar lengkap semua subtes beserta URL data
//     dan tipe soal masing-masing
//   - Variabel state global (cu, cfg, qs, qi, ua, sc, dll.)
//     yang dipakai bersama oleh semua modul lain
//
// CATATAN: File ini harus dimuat PERTAMA sebelum file lain,
// karena semua modul bergantung pada konstanta di sini.
// ============================================================

const _urlParams = new URLSearchParams(window.location.search);
const AUTO_PAKET = (_urlParams.get('p') || '').trim();

// Paket yang langsung aktif tanpa konfirmasi manual tester
const PAKET_AUTO_AKTIF = ['asmara','potensi','karakter','karir'];
const IS_AUTO_AKTIF = PAKET_AUTO_AKTIF.includes(AUTO_PAKET.toLowerCase());

const BASE='https://cipta.my.id/psikotest/simpel/';
const ALL_CONFIG=[
  {id:'apm0',  dataUrl:BASE+'apm0.txt',   type:'image_single',      saveField:'x_05'},
  {id:'apm1',  dataUrl:BASE+'apm1.txt',   type:'image_single',      saveField:'x_05'},
  {id:'apm1a', dataUrl:BASE+'apm1a.txt',  type:'image_single',      saveField:'x_05'},
  {id:'apm1b', dataUrl:BASE+'apm1b.txt',  type:'image_single',      saveField:'x_05'},
  {id:'apm2',  dataUrl:BASE+'apm2.txt',   type:'image_single',      saveField:'x_05'},
  {id:'apm2a', dataUrl:BASE+'apm2a.txt',  type:'image_single',      saveField:'x_05'},
  {id:'apm2b', dataUrl:BASE+'apm2b.txt',  type:'image_single',      saveField:'x_05'},
  {id:'apm14', dataUrl:BASE+'apm14.txt',  type:'image_single',      saveField:'x_05'},
  {id:'cfit0', dataUrl:BASE+'cfit0.txt',  type:'image_single',      saveField:'x_05'},
  {id:'cfit1', dataUrl:BASE+'cfit1.txt',  type:'image_single',      saveField:'x_05'},
  {id:'cfit2', dataUrl:BASE+'cfit2_a.txt',type:'image_multi',       saveField:'x_05'},
  {id:'cfit3', dataUrl:BASE+'cfit3.txt',  type:'image_single',      saveField:'x_05'},
  {id:'cfit4', dataUrl:BASE+'cfit4.txt',  type:'image_single',      saveField:'x_05'},
  {id:'epps',  dataUrl:BASE+'epps.txt',   type:'ab_choice',         saveField:'x_06'},
  {id:'ist0',  dataUrl:BASE+'ist0.txt',   type:'text_choice',       saveField:'x_05'},
  {id:'ist1',  dataUrl:BASE+'ist1.txt',   type:'text_choice',       saveField:'x_05'},
  {id:'ist2',  dataUrl:BASE+'ist2.txt',   type:'text_choice',       saveField:'x_05'},
  {id:'ist3',  dataUrl:BASE+'ist3.txt',   type:'text_choice',       saveField:'x_05'},
  {id:'ist4_a',dataUrl:BASE+'ist4_a.txt', type:'text_input_scored', saveField:'x_05'},
  {id:'ist5_a',dataUrl:BASE+'ist5_a.txt', type:'digit_check',       saveField:'x_05'},
  {id:'ist6_a',dataUrl:BASE+'ist6_a.txt', type:'digit_check',       saveField:'x_05'},
  {id:'ist7',  dataUrl:BASE+'ist7.txt',   type:'image_single',      saveField:'x_05'},
  {id:'ist8',  dataUrl:BASE+'ist8.txt',   type:'image_single',      saveField:'x_05'},
  {id:'ist9',  dataUrl:BASE+'ist9.txt',   type:'text_choice',       saveField:'x_05'},
  {id:'papi',  dataUrl:BASE+'papi.txt',   type:'ab_choice',         saveField:'x_06'},
  {id:'rmib',  dataUrl:BASE+'rmib.txt',   type:'ranking',           saveField:'x_06',kolom:1,totalKolom:8,showInstructionsOnce:true},
  {id:'tkd3',  dataUrl:BASE+'tkd3.txt',   type:'text_choice',       saveField:'x_05'},
  {id:'tkd6',  dataUrl:BASE+'tkd6_a.txt', type:'text_input',        saveField:'x_05'},
  {id:'kreplin',dataUrl:BASE+'kreplin.txt',type:'kreplin',          saveField:'x_06'}
];

const API_W='https://lidan-co-id.pages.dev/api/contacts_filter_dinamis6';
const API_R='https://lidan-co-id.pages.dev/api/contacts_filter_dinamis7';
const TBL='nilai1_json', TBL_P='alat_tes', TBL_K='admin_kontrol', AUTH='admin';
const WHO_B='https://cipta.my.id/who2/';
const CHARS='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// ── State global peserta & sesi ──
let cu=null;   // data peserta aktif dari DB
let vMap={};   // peta visibilitas/tracking tombol

// ── State global subtes aktif ──
let cfg=null;  // config subtes yang sedang berjalan
let qs=[];     // array soal aktif
let qi=0;      // indeks soal saat ini
let ua=[];     // array jawaban user
let sc=0;      // skor benar
let tl=0;      // sisa waktu (detik)
let ti=null;   // interval timer

// ── State kontrol alur ──
let tStarted=false;
let fEnd=false;
let swEl=0;
let vCnt=0;

// ── State ranking ──
let rSel=[];
let uNum=[];

// ── State navigasi ──
let skip=[];
let ans=[];

// ── State daftar subtes aktif ──
let AC=[];   // daftar config subtes yang dipakai paket ini
let WTL=[];  // daftar WHO tests
let UT=[];   // unified task list (gabungan AC + WHO + kreplin)

// ── State WHO engine (who-engine.js) ──
let wBL=[];      // WHO block list aktif (salinan WTL saat tes WHO jalan)
let wBI=0;       // indeks WHO test yang sedang dibuka
let wQs=[];      // array soal WHO aktif
let wQi=0;       // indeks soal WHO saat ini
let wUA=[];      // array jawaban WHO
let wSkip=[];    // indeks soal WHO yang dilewati
let wAns=[];     // indeks soal WHO yang sudah dijawab

// ── State paket ──
let pList=[];    // semua paket dari DB
let sPaket=null; // paket yang sedang aktif

// ── Helper umum ──
const $=id=>document.getElementById(id);
const sl=t=>{$('loaderText').innerText=t||'Memuat...';$('globalLoader').classList.remove('hidden')};
const hl=()=>$('globalLoader').classList.add('hidden');
const ss=id=>{
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
  // Tombol token hanya muncul di screenDaftar
  const btnTF=document.getElementById('btnTokenFloat');
  const popupTF=document.getElementById('popupToken');
  if(btnTF) btnTF.style.display=(id==='screenDaftar')?'block':'none';
  if(popupTF && id!=='screenDaftar') popupTF.style.display='none';
};
function sLoad(btn,on){btn.disabled=on;if(on){btn.dataset.t=btn.innerHTML;btn.innerHTML='<span class="spinner" style="width:18px;height:18px;border-width:3px;display:inline-block"></span>'}else btn.innerHTML=btn.dataset.t}
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const td=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const dbg=m=>console.log('[DBG]',m);
const rs=n=>{let r='';for(let i=0;i<n;i++)r+=CHARS[Math.floor(Math.random()*CHARS.length)];return r};

// ── Helper API ──
const aF=async(u,o={})=>(await fetch(u,o)).json();
const aG=id=>aF(`${API_R}?table=${TBL}&id_x=${id}`,{headers:{'X-Custom-Auth':AUTH}});
const aP=(id,b)=>fetch(`${API_W}?table=${TBL}&id_x=${id}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Custom-Auth':AUTH},body:JSON.stringify(b)});
const gBio=f=>{try{const o=JSON.parse(cu.x_02||'{}');return o[f.replace(/^bio/,'').toLowerCase()]||''}catch{return''}};

// SB dan skB didefinisikan di test-engine.js