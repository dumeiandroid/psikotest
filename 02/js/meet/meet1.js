/**
 * lidan-meet.js  — v1.6
 * Injectable script — sisipkan di <head> halaman soal manapun.
 * Otomatis inject UI lobby, Jitsi meeting, PiP kamera, dan sistem sinyal.
 *
 * Cara pakai:
 *   <script src="lidan-meet.js"><\/script>
 *
 * Opsional — tentukan room langsung via attribute:
 *   <script src="lidan-meet.js" data-room="ujian-matematika"><\/script>
 *
 * FIXES v1.1:
 *  - prejoinPageEnabled: FALSE  → tidak ada layar "Join meeting" dari Jitsi
 *  - startWithAudioMuted: TRUE  → masuk langsung mute, tidak minta izin lagi
 *  - startWithVideoMuted: FALSE → video aktif langsung
 *  - handleLeave() → confirm dialog + konfirmasi sebelum keluar
 *  - Fallback timeout loading screen lebih agresif (5 detik)
 *  - Tombol "Keluar" ditambahkan ke PiP panel (ada di v1.0 tapi hilang dari HTML inject)
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════
     SELF CACHE BUSTER
     Setiap kali versi script berubah, halaman reload
     otomatis agar user tidak perlu clear cache manual.
  ══════════════════════════════════════════════════ */
  const _SCRIPT_VERSION = '1.6';
  const _CACHE_KEY      = 'lidan_meet_ver';
  const _storedVer      = localStorage.getItem(_CACHE_KEY);
  if (_storedVer && _storedVer !== _SCRIPT_VERSION) {
    // Versi baru terdeteksi — reload sekali dengan cache-bust di URL
    localStorage.setItem(_CACHE_KEY, _SCRIPT_VERSION);
    const sep = location.search ? '&' : '?';
    location.replace(location.href.replace(/[?&]_lmv=[^&]*/g, '') + sep + '_lmv=' + _SCRIPT_VERSION);
    // Hentikan eksekusi script lama
    throw new Error('[LidanMeet] Reloading untuk versi ' + _SCRIPT_VERSION);
  }
  localStorage.setItem(_CACHE_KEY, _SCRIPT_VERSION);

  /* ══════════════════════════════════════════════════
     AMBIL KONFIGURASI DARI SCRIPT TAG
     Gunakan attributes: data-room, data-account, data-api,
     data-signal-path, data-join-path
  ══════════════════════════════════════════════════ */
  const _scriptTag     = document.currentScript;
  const PRESET_ROOM    = _scriptTag ? (_scriptTag.getAttribute('data-room')        || '') : '';
  const PRESET_ACCOUNT = _scriptTag ? (_scriptTag.getAttribute('data-account')     || '') : '';
  const BASE_API       = _scriptTag ? (_scriptTag.getAttribute('data-api')          || 'https://tabi.my.id/api') : 'https://tabi.my.id/api';
  const SIGNAL_PATH    = _scriptTag ? (_scriptTag.getAttribute('data-signal-path') || 'signal-universal')        : 'signal-universal';
  const JOIN_PATH      = _scriptTag ? (_scriptTag.getAttribute('data-join-path')   || 'join-room-universal')     : 'join-room-universal';

  /* ══════════════════════════════════════════════════
     CONFIG — dibangun dari atribut script tag
  ══════════════════════════════════════════════════ */
  const API_SIGNAL    = `${BASE_API}/${SIGNAL_PATH}`;
  const API_JOIN      = `${BASE_API}/${JOIN_PATH}`;
  const SIGNAL_POLL_MS = 2500;

  /* ══════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════ */
  let jitsiAPI      = null;
  let selfStream    = null;
  let micEnabled    = false;
  let roomData      = null;
  let myName        = '';
  let timerInterval = null;
  let meetStart     = null;
  let pollInterval  = null;
  let handRaised    = false;
  let queuePos      = null;
  let adminStatus   = 'idle';
  let _uiInjected        = false;
  let _pipAutoCloseTimer = null;
  let _adminParticipantId = null; // Jitsi participant ID milik pengawas
  let _joinedAt           = null; // timestamp saat berhasil join (untuk filter history replay)

  /* ══════════════════════════════════════════════════
     CSS
  ══════════════════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById('lidan-meet-styles')) return;
    const style = document.createElement('style');
    style.id = 'lidan-meet-styles';
    style.textContent = `
      :root {
        --lm-bg: #0b0f1a;
        --lm-bg2: #111827;
        --lm-surface: #161d2e;
        --lm-surface2: #1e2a40;
        --lm-border: #243047;
        --lm-accent: #3b82f6;
        --lm-accent-glow: rgba(59,130,246,0.25);
        --lm-accent2: #06b6d4;
        --lm-success: #10b981;
        --lm-danger: #ef4444;
        --lm-warn: #f59e0b;
        --lm-text: #e8edf5;
        --lm-text-muted: #6b7fa3;
        --lm-text-dim: #3d5170;
        --lm-radius: 14px;
        --lm-radius-sm: 8px;
        --lm-font-display: 'Syne', sans-serif;
        --lm-font-body: 'DM Sans', sans-serif;
      }

      /* ── OVERLAY LOBBY ── */
      #lm-lobby-overlay {
        position: fixed; inset: 0;
        z-index: 99999;
        background: var(--lm-bg);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        font-family: var(--lm-font-body);
        color: var(--lm-text);
        padding: 20px;
        overflow-y: auto;
      }
      #lm-lobby-overlay::before {
        content: '';
        position: fixed; inset: 0;
        background-image:
          linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px);
        background-size: 40px 40px;
        pointer-events: none; z-index: 0;
      }
      #lm-lobby-overlay.lm-hidden { display: none; }

      .lm-lobby-wrap {
        position: relative; z-index: 1;
        width: 100%; max-width: 440px;
        animation: lmFadeUp 0.5s ease both;
      }
      @keyframes lmFadeUp {
        from { opacity:0; transform: translateY(20px); }
        to   { opacity:1; transform: translateY(0); }
      }

      .lm-logo {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 28px;
      }
      .lm-logo-icon {
        width: 34px; height: 34px;
        background: linear-gradient(135deg, var(--lm-accent), var(--lm-accent2));
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 16px;
      }
      .lm-logo-text {
        font-family: var(--lm-font-display);
        font-size: 20px; font-weight: 800;
        color: var(--lm-text); letter-spacing: -0.5px;
      }
      .lm-logo-text span {
        background: linear-gradient(90deg, var(--lm-accent), var(--lm-accent2));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      }

      .lm-hero-badge {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(59,130,246,0.12);
        border: 1px solid rgba(59,130,246,0.25);
        border-radius: 100px; padding: 5px 14px;
        font-size: 12px; font-weight: 500;
        color: var(--lm-accent); letter-spacing: 0.5px;
        text-transform: uppercase; margin-bottom: 16px;
      }
      .lm-hero-title {
        font-family: var(--lm-font-display);
        font-size: clamp(28px, 5vw, 44px);
        font-weight: 800; line-height: 1.1;
        letter-spacing: -1.5px; margin-bottom: 8px;
      }
      .lm-hero-title .lm-hl {
        background: linear-gradient(90deg, var(--lm-accent), var(--lm-accent2));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      }
      .lm-hero-sub {
        color: var(--lm-text-muted); font-size: 14px;
        line-height: 1.7; margin-bottom: 28px;
      }
      .lm-card {
        background: var(--lm-surface);
        border: 1px solid var(--lm-border);
        border-radius: 20px; padding: 32px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.4);
      }
      .lm-hash-notice {
        display: none;
        background: rgba(59,130,246,0.08);
        border: 1px solid rgba(59,130,246,0.2);
        border-radius: 10px; padding: 12px 16px;
        margin-bottom: 18px;
        font-size: 13px; color: var(--lm-accent);
      }
      .lm-hash-notice.lm-show { display: block; }
      .lm-hash-label {
        font-size: 11px; color: var(--lm-text-muted);
        text-transform: uppercase; letter-spacing: 0.8px;
        margin-bottom: 3px;
      }
      .lm-hash-name {
        font-family: var(--lm-font-display);
        font-weight: 700; font-size: 15px;
      }
      .lm-form-group { margin-bottom: 16px; }
      .lm-label {
        display: block; font-size: 12px; font-weight: 500;
        color: var(--lm-text-muted); text-transform: uppercase;
        letter-spacing: 0.8px; margin-bottom: 7px;
      }
      .lm-input {
        width: 100%; padding: 12px 15px;
        background: var(--lm-bg2);
        border: 1px solid var(--lm-border);
        border-radius: var(--lm-radius-sm);
        color: var(--lm-text);
        font-family: var(--lm-font-body); font-size: 15px;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
        box-sizing: border-box;
      }
      .lm-input:focus {
        border-color: var(--lm-accent);
        box-shadow: 0 0 0 3px var(--lm-accent-glow);
      }
      .lm-input::placeholder { color: var(--lm-text-dim); }
      .lm-btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 8px; width: 100%; padding: 13px 20px;
        border: none; border-radius: var(--lm-radius-sm);
        font-family: var(--lm-font-body); font-size: 15px;
        font-weight: 500; cursor: pointer;
        transition: all 0.2s; box-sizing: border-box;
      }
      .lm-btn-primary { background: var(--lm-accent); color: #fff; }
      .lm-btn-primary:hover { background: #2563eb; transform: translateY(-1px); }
      .lm-btn-primary:active { transform: translateY(0); }
      .lm-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
      .lm-spinner {
        display: none; width: 16px; height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: lmSpin 0.8s linear infinite;
      }
      .lm-spinner.lm-show { display: block; }
      @keyframes lmSpin { to { transform: rotate(360deg); } }
      .lm-alert {
        display: none; margin-top: 14px;
        padding: 12px 16px; border-radius: 10px;
        font-size: 14px;
        background: rgba(239,68,68,0.1);
        border: 1px solid rgba(239,68,68,0.25);
        color: var(--lm-danger);
      }
      .lm-alert.lm-show { display: block; }

      /* ── JITSI CONTAINER (tersembunyi di background, WebRTC tetap hidup) ── */
      /* Harus ukuran penuh agar Jitsi bisa render dan emit videoConferenceJoined */
      #lm-jitsi-wrap {
        position: fixed;
        top: 0; left: -9999px; /* geser ke luar layar, bukan 1px */
        z-index: -1;
        opacity: 0;
        pointer-events: none;
        width: 100vw; height: 100vh;
        transition: opacity 0.2s;
      }
      #lm-jitsi-wrap.lm-chat-open {
        left: 0 !important;
        top: 0 !important;
        z-index: 99994 !important;
        opacity: 1 !important;
        pointer-events: all !important;
      }
      /* Saat chat terbuka, iframe dimulai dari bawah close bar */
      #lm-jitsi-wrap.lm-chat-open #lm-jitsi-container {
        height: calc(100vh - 44px) !important;
        margin-top: 44px;
      }
      #lm-jitsi-container { width: 100%; height: 100%; }

      /* ── CHAT CLOSE BAR ── */
      #lm-chat-close-bar {
        display: none;
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 99995;
        height: 44px;
        background: rgba(11,15,26,0.97);
        border-bottom: 1px solid var(--lm-border);
        align-items: center;
        padding: 0 14px;
        gap: 12px;
        font-family: var(--lm-font-body);
        font-size: 13px;
        color: var(--lm-text-muted);
      }
      #lm-chat-close-bar.lm-show { display: flex; }
      #lm-chat-close-btn {
        margin-left: auto;
        background: rgba(239,68,68,0.12);
        border: 1px solid rgba(239,68,68,0.3);
        color: var(--lm-danger);
        border-radius: 7px;
        padding: 5px 14px;
        font-family: var(--lm-font-body);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }
      #lm-chat-close-btn:hover { background: var(--lm-danger); color: #fff; }

      /* ── VIDEO BLOCK (area di sebelah kanan chat, ditutupi) ── */
      /* Lebar chat Jitsi ~315px; sisanya ditutup */
      #lm-video-block {
        position: fixed;
        top: 44px; left: 315px; right: 0; bottom: 0;
        z-index: 99996;
        background: #0b0f1a;
        display: none;
        align-items: center; justify-content: center;
        flex-direction: column; gap: 12px;
        color: #3d5170; font-family: var(--lm-font-body); font-size: 14px;
        pointer-events: all;
      }
      @media (max-width: 600px) {
        #lm-video-block { display: none !important; }
      }

      /* ── PiP WIDGET ── */
      #lm-pip-widget {
        position: fixed;
        bottom: 20px; left: 0;
        z-index: 99990;
        display: none;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        font-family: var(--lm-font-body);
      }
      #lm-pip-widget.lm-visible { display: flex; }

      .lm-pip-panel {
        background: rgba(11,15,26,0.96);
        border: 1px solid var(--lm-border);
        border-radius: 14px;
        padding: 12px 14px;
        display: flex; flex-direction: column; gap: 8px;
        min-width: 185px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        transform-origin: bottom left;
        transform: scale(0.85) translateY(8px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .lm-pip-panel.lm-open {
        opacity: 1;
        transform: scale(1) translateY(0);
        pointer-events: all;
      }
      .lm-admin-bar {
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; color: var(--lm-text-muted);
        padding-bottom: 6px;
        border-bottom: 1px solid var(--lm-border);
      }
      .lm-admin-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--lm-text-dim);
        transition: background 0.3s; flex-shrink: 0;
      }
      .lm-admin-dot.available { background: var(--lm-success); box-shadow: 0 0 6px var(--lm-success); }
      .lm-admin-dot.busy      { background: var(--lm-danger); }
      .lm-admin-dot.broadcast { background: var(--lm-warn); box-shadow: 0 0 6px var(--lm-warn); }
      .lm-admin-dot.idle      { background: var(--lm-text-dim); }

      .lm-queue-info {
        display: none;
        font-size: 11px; color: var(--lm-text-muted);
        background: rgba(245,158,11,0.06);
        border: 1px solid rgba(245,158,11,0.15);
        border-radius: 6px; padding: 5px 10px;
      }
      .lm-queue-info.lm-show { display: block; }

      .lm-strip-btns { display: flex; flex-direction: column; gap: 6px; }
      .lm-ctrl-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 12px; border-radius: 8px;
        font-family: var(--lm-font-body); font-size: 12px; font-weight: 500;
        cursor: grab; border: 1px solid;
        transition: all 0.2s; width: 100%;
        box-sizing: border-box; text-align: left;
      }
      .lm-ctrl-raise {
        background: rgba(245,158,11,0.12);
        border-color: rgba(245,158,11,0.3);
        color: var(--lm-warn);
      }
      .lm-ctrl-raise:hover { background: rgba(245,158,11,0.2); border-color: var(--lm-warn); }
      .lm-ctrl-raise.lm-in-queue {
        background: rgba(245,158,11,0.2); border-color: var(--lm-warn);
        animation: lmRaiseGlow 2s infinite;
      }
      .lm-ctrl-raise.lm-cancel {
        background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); color: var(--lm-danger);
      }
      @keyframes lmRaiseGlow {
        0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
        50%      { box-shadow: 0 0 0 4px rgba(245,158,11,0.2); }
      }
      .lm-ctrl-hangup {
        background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); color: var(--lm-danger);
      }
      .lm-ctrl-hangup:hover { background: var(--lm-danger); color: #fff; border-color: var(--lm-danger); }
      .lm-ctrl-mic { background: var(--lm-surface); border-color: var(--lm-border); color: var(--lm-text-muted); }
      .lm-ctrl-chat {
        background: rgba(6,182,212,0.08);
        border-color: rgba(6,182,212,0.25);
        color: var(--lm-accent2);
      }
      .lm-ctrl-chat:hover { background: rgba(6,182,212,0.18); border-color: var(--lm-accent2); }
      .lm-ctrl-chat.lm-has-unread {
        background: rgba(6,182,212,0.18); border-color: var(--lm-accent2);
        animation: lmChatPulse 2s infinite;
      }
      @keyframes lmChatPulse {
        0%,100% { box-shadow: 0 0 0 0 rgba(6,182,212,0); }
        50%      { box-shadow: 0 0 0 4px rgba(6,182,212,0.2); }
      }

      .lm-ctrl-mic.lm-active {
        background: rgba(16,185,129,0.1); border-color: var(--lm-success); color: var(--lm-success);
      }

      .lm-self-video-box {
        position: relative;
        width: 140px; height: 100px;
        background: var(--lm-surface);
        border: 2px solid var(--lm-border);
        border-radius: 12px;
        overflow: hidden;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        transition: border-color 0.2s, box-shadow 0.2s;
        flex-shrink: 0;
      }
      .lm-self-video-box:hover {
        border-color: var(--lm-accent);
        box-shadow: 0 4px 20px rgba(59,130,246,0.3);
      }
      .lm-self-video-box.lm-active-pip {
        border-color: var(--lm-accent);
        box-shadow: 0 0 0 3px var(--lm-accent-glow);
      }
      #lm-self-video {
        width: 100%; height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
      }
      .lm-cam-label {
        position: absolute; bottom: 5px; left: 7px;
        font-size: 9px; font-weight: 500;
        background: rgba(0,0,0,0.65);
        color: var(--lm-text); padding: 2px 6px;
        border-radius: 4px; letter-spacing: 0.3px;
        pointer-events: none;
      }
      .lm-pip-hint {
        position: absolute; top: 5px; right: 7px;
        font-size: 10px; opacity: 0.6;
        pointer-events: none;
      }
      .lm-cam-off {
        display: none;
        position: absolute; inset: 0;
        background: var(--lm-surface2);
        align-items: center; justify-content: center;
        flex-direction: column; gap: 4px;
      }
      .lm-cam-off.lm-show { display: flex; }
      .lm-cam-off-icon { font-size: 22px; opacity: 0.5; }

      /* ── TOMBOL MELAYANG TANYA PENGAWAS (FAB) ── */
      #lm-fab-tanya {
        display: none;
        position: fixed;
        bottom: 12px; left: 12px;
        z-index: 2147483647;
        align-items: center; gap: 6px;
        padding: 4px 12px;
        background: #e0e7ff;
        border: 2px solid #6366f1;
        border-radius: 8px;
        color: #4338ca;
        font-family: 'Courier New', monospace; font-size: .78em; font-weight: 700;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,.2);
        transition: background 0.15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        user-select: none;
      }
      #lm-fab-tanya.lm-fab-visible { display: flex; }
      #lm-fab-tanya.lm-fab-hidden  { display: none !important; }
      #lm-fab-tanya:active { background: #c7d2fe; }


      /* ── POPUP FAB ── */
      #lm-fab-popup {
        display: none;
        position: fixed;
        bottom: 46px; left: 12px;
        z-index: 999999;
        background: rgba(11,15,26,0.98);
        border: 1px solid var(--lm-border);
        border-radius: 16px;
        padding: 14px 16px;
        min-width: 210px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6);
        flex-direction: column; gap: 8px;
        font-family: var(--lm-font-body);
        backdrop-filter: blur(12px);
        animation: lmFadeUp 0.2s ease both;
      }
      #lm-fab-popup.lm-fab-open { display: flex; }

      /* ── TOASTS ── */
      #lm-toast-container {
        position: fixed; top: 70px; right: 20px;
        z-index: 999999; display: flex; flex-direction: column; gap: 8px;
        font-family: var(--lm-font-body);
        pointer-events: none;
      }
      .lm-toast {
        background: var(--lm-surface2);
        border: 1px solid var(--lm-border);
        border-radius: 10px; padding: 12px 16px;
        font-size: 14px; max-width: 280px;
        animation: lmToastIn 0.3s ease both;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        color: var(--lm-text);
      }
      .lm-toast.success { border-left: 3px solid var(--lm-success); }
      .lm-toast.warn    { border-left: 3px solid var(--lm-warn); }
      .lm-toast.info    { border-left: 3px solid var(--lm-accent); }
      @keyframes lmToastIn {
        from { opacity:0; transform: translateX(20px); }
        to   { opacity:1; transform: translateX(0); }
      }

      #lm-broadcast-banner {
        display: none;
        position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
        z-index: 99995;
        background: rgba(245,158,11,0.15);
        border: 1px solid rgba(245,158,11,0.4);
        border-radius: 10px; padding: 10px 20px;
        font-size: 13px; color: var(--lm-warn);
        text-align: center;
        font-family: var(--lm-font-body);
        animation: lmFadeUp 0.3s ease;
        white-space: nowrap;
      }
      #lm-broadcast-banner.lm-show { display: block; }

      #lm-private-banner {
        display: none;
        position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
        z-index: 99995;
        background: rgba(59,130,246,0.12);
        border: 1px solid rgba(59,130,246,0.3);
        border-radius: 10px; padding: 10px 20px;
        font-size: 13px; color: var(--lm-accent);
        text-align: center;
        font-family: var(--lm-font-body);
        white-space: nowrap;
      }
      #lm-private-banner.lm-show { display: block; }

      /* ── LOADING SCREEN ── */
      #lm-loading-screen {
        display: none;
        position: fixed; inset: 0;
        z-index: 99998;
        background: var(--lm-bg);
        flex-direction: column;
        align-items: center; justify-content: center;
        gap: 16px;
        font-family: var(--lm-font-body);
        color: var(--lm-text-muted);
        font-size: 14px;
      }
      #lm-loading-screen.lm-show { display: flex; }
      #lm-loading-screen.lm-hidden { display: none !important; }
      .lm-loading-ring {
        width: 36px; height: 36px;
        border: 3px solid var(--lm-border);
        border-top-color: var(--lm-accent);
        border-radius: 50%;
        animation: lmSpin 0.8s linear infinite;
      }

      /* ── TIMER BADGE ── */
      #lm-timer-badge {
        display: none;
        position: fixed; top: 14px; left: 14px;
        z-index: 99991;
        background: rgba(11,15,26,0.9);
        border: 1px solid var(--lm-border);
        border-radius: 8px; padding: 5px 12px;
        font-family: var(--lm-font-display);
        font-size: 13px; letter-spacing: 1px;
        color: var(--lm-text-muted);
        backdrop-filter: blur(8px);
      }
      #lm-timer-badge.lm-show { display: block; }
    `;
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════════════════
     FONT LOADER
  ══════════════════════════════════════════════════ */
  function injectFonts() {
    if (document.getElementById('lidan-meet-fonts')) return;
    const link = document.createElement('link');
    link.id   = 'lidan-meet-fonts';
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap';
    document.head.appendChild(link);
  }

  /* ══════════════════════════════════════════════════
     HTML — inject ke <body>
  ══════════════════════════════════════════════════ */
  function injectHTML() {
    if (_uiInjected) return;
    _uiInjected = true;

    const hashRoom   = decodeURIComponent(window.location.hash.replace('#', '').trim());
    const presetRoom = PRESET_ROOM || hashRoom;

    // ── LOBBY OVERLAY ──
    const lobby = document.createElement('div');
    lobby.id = 'lm-lobby-overlay';
    lobby.innerHTML = `
      <div class="lm-lobby-wrap">
        <div class="lm-logo">
          <div class="lm-logo-icon">🎓</div>
          <div class="lm-logo-text">Lidan<span>Meet</span></div>
        </div>
        <div class="lm-hero-badge">📋 Peserta Ujian</div>
        <h1 class="lm-hero-title">Masuk ke<br/><span class="lm-hl">Ruang Ujian</span></h1>
        <p class="lm-hero-sub">Masukkan nama dan kode room ujian untuk bergabung. Kamera Anda akan aktif selama ujian berlangsung.</p>

        <div class="lm-card">
          <div class="lm-hash-notice ${presetRoom ? 'lm-show' : ''}" id="lm-hash-notice">
            <div class="lm-hash-label">Room ujian telah ditentukan</div>
            <div class="lm-hash-name" id="lm-hash-room-display">${presetRoom || '—'}</div>
          </div>

          <div class="lm-form-group" id="lm-room-input-group" ${presetRoom ? 'style="display:none"' : ''}>
            <label class="lm-label" for="lm-inp-room">Kode / Link Room</label>
            <input class="lm-input" type="text" id="lm-inp-room" placeholder="misal: ujian-matematika" value="${presetRoom}" />
          </div>
          <input type="hidden" id="lm-inp-room-hidden" value="${presetRoom}" />

          <div class="lm-form-group">
            <label class="lm-label" for="lm-inp-name">Nama Lengkap</label>
            <input class="lm-input" type="text" id="lm-inp-name" placeholder="Nama Anda akan terlihat pengawas" />
          </div>

          <div class="lm-form-group">
            <label class="lm-label" for="lm-inp-email">Email (opsional)</label>
            <input class="lm-input" type="email" id="lm-inp-email" placeholder="email@contoh.com" />
          </div>

          <button class="lm-btn lm-btn-primary" id="lm-btn-join">
            <span class="lm-spinner" id="lm-spinner"></span>
            <span id="lm-btn-join-text">Masuk Ruang Ujian</span>
          </button>

          <div class="lm-alert" id="lm-alert"></div>
        </div>
      </div>
    `;
    document.body.appendChild(lobby);

    // ── JITSI WRAP (tersembunyi, audio tetap hidup) ──
    const jitsiWrap = document.createElement('div');
    jitsiWrap.id = 'lm-jitsi-wrap';
    jitsiWrap.innerHTML = `<div id="lm-jitsi-container"></div>`;
    document.body.appendChild(jitsiWrap);

    // ── CHAT CLOSE BAR (muncul saat Jitsi overlay terbuka) ──
    const chatCloseBar = document.createElement('div');
    chatCloseBar.id = 'lm-chat-close-bar';
    chatCloseBar.innerHTML = `
      <span>💬</span>
      <span>Chat Jitsi — Anda masih dalam ujian</span>
      <button id="lm-chat-close-btn">✕ Kembali ke Ujian</button>
    `;
    document.body.appendChild(chatCloseBar);

    // ── LOADING SCREEN ──
    const loading = document.createElement('div');
    loading.id = 'lm-loading-screen';
    loading.innerHTML = `
      <div class="lm-loading-ring"></div>
      <div id="lm-loading-text">Menghubungkan ke ruang ujian…</div>
    `;
    document.body.appendChild(loading);

    // ── PiP WIDGET ──
    const pip = document.createElement('div');
    pip.id = 'lm-pip-widget';
    pip.innerHTML = `
      <div class="lm-pip-panel" id="lm-pip-panel">
        <div class="lm-admin-bar">
          <div class="lm-admin-dot" id="lm-admin-dot"></div>
          <span id="lm-admin-text">Menghubungkan ke pengawas…</span>
        </div>
        <div class="lm-queue-info" id="lm-queue-info"></div>
        <div class="lm-strip-btns">
          <button class="lm-ctrl-btn lm-ctrl-raise" id="lm-btn-raise">🖐️ Tanya Pengawas</button>
          <button class="lm-ctrl-btn lm-ctrl-mic"   id="lm-btn-mic">🔇 Mic Mati</button>
          <button class="lm-ctrl-btn lm-ctrl-chat" id="lm-btn-chat">💬 Chat</button>
          <button class="lm-ctrl-btn lm-ctrl-hangup" id="lm-btn-leave">📴 Keluar</button>
        </div>
      </div>
      <div class="lm-self-video-box" id="lm-pip-box">
        <video id="lm-self-video" autoplay playsinline muted></video>
        <div class="lm-cam-off" id="lm-cam-off">
          <div class="lm-cam-off-icon">📷</div>
          <div style="font-size:10px;color:var(--lm-text-muted)">Kamera mati</div>
        </div>
        <div class="lm-cam-label">Kamera Anda</div>
        <div class="lm-pip-hint">⚙️</div>
      </div>
    `;
    document.body.appendChild(pip);

    // ── TIMER ──
    const timer = document.createElement('div');
    timer.id = 'lm-timer-badge';
    timer.textContent = '00:00';
    document.body.appendChild(timer);

    // ── TOASTS & BANNERS ──
    const toasts = document.createElement('div');
    toasts.id = 'lm-toast-container';
    document.body.appendChild(toasts);

    const bcastBanner = document.createElement('div');
    bcastBanner.id = 'lm-broadcast-banner';
    bcastBanner.textContent = '📢 Pengawas sedang berbicara kepada semua peserta';
    document.body.appendChild(bcastBanner);

    const privateBanner = document.createElement('div');
    privateBanner.id = 'lm-private-banner';
    privateBanner.textContent = '📞 Pengawas sedang menghubungi Anda secara privat';
    document.body.appendChild(privateBanner);

    // ── TOMBOL MELAYANG TANYA PENGAWAS (FAB) ──
    const fab = document.createElement('button');
    fab.id = 'lm-fab-tanya';
    fab.innerHTML = '🖐️ Tanya Pengawas';
    document.body.appendChild(fab);

    // ── POPUP FAB ──
    const fabPopup = document.createElement('div');
    fabPopup.id = 'lm-fab-popup';
    fabPopup.innerHTML = `
      <div class="lm-admin-bar" style="padding-bottom:8px;margin-bottom:4px;">
        <div class="lm-admin-dot" id="lm-fab-admin-dot"></div>
        <span id="lm-fab-admin-text" style="font-size:11px;color:var(--lm-text-muted)">Menghubungkan…</span>
      </div>
      <div class="lm-queue-info" id="lm-fab-queue-info"></div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <button class="lm-ctrl-btn lm-ctrl-raise" id="lm-fab-btn-raise">🖐️ Angkat Tangan</button>
        <button class="lm-ctrl-btn lm-ctrl-mic"   id="lm-fab-btn-mic">🔇 Mic Mati</button>
        <button class="lm-ctrl-btn lm-ctrl-chat"  id="lm-fab-btn-chat">💬 Chat</button>
        <button class="lm-ctrl-btn lm-ctrl-hangup" id="lm-fab-btn-leave">📴 Keluar</button>
      </div>
    `;
    document.body.appendChild(fabPopup);

    // ── EVENT LISTENERS ──
    document.getElementById('lm-btn-join').addEventListener('click', handleJoin);
    document.getElementById('lm-inp-name').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleJoin();
    });
    document.getElementById('lm-btn-raise').addEventListener('click', handleRaiseHand);
    document.getElementById('lm-btn-mic').addEventListener('click', toggleMic);
    document.getElementById('lm-btn-leave').addEventListener('click', handleLeave);
    document.getElementById('lm-btn-chat').addEventListener('click', toggleChat);
    document.getElementById('lm-chat-close-btn').addEventListener('click', closeJitsiOverlay);
    initPipDrag(); // drag + klik + auto-close + outside-click

    // ── FAB event listeners ──
    document.getElementById('lm-fab-tanya').addEventListener('click', toggleFabPopup);
    document.getElementById('lm-fab-btn-raise').addEventListener('click', function() { closeFabPopup(); handleRaiseHand(); });
    document.getElementById('lm-fab-btn-mic').addEventListener('click', function() { toggleMic(); _syncFabMicBtn(); });
    document.getElementById('lm-fab-btn-chat').addEventListener('click', function() { closeFabPopup(); toggleChat(); });
    document.getElementById('lm-fab-btn-leave').addEventListener('click', function() { closeFabPopup(); handleLeave(); });

    // Tutup FAB popup saat tap di luar
    document.addEventListener('mousedown', function(e) {
      const popup = document.getElementById('lm-fab-popup');
      const btn   = document.getElementById('lm-fab-tanya');
      if (popup && popup.classList.contains('lm-fab-open') &&
          !popup.contains(e.target) && btn && !btn.contains(e.target)) {
        closeFabPopup();
      }
    });
    document.addEventListener('touchstart', function(e) {
      const popup = document.getElementById('lm-fab-popup');
      const btn   = document.getElementById('lm-fab-tanya');
      if (popup && popup.classList.contains('lm-fab-open') &&
          !popup.contains(e.target) && btn && !btn.contains(e.target)) {
        closeFabPopup();
      }
    }, { passive: true });

    // Panel hover → tahan auto-close timer
    document.getElementById('lm-pip-panel').addEventListener('mouseenter', clearPipAutoClose);
    document.getElementById('lm-pip-panel').addEventListener('mouseleave', function() {
      const panel = document.getElementById('lm-pip-panel');
      if (panel.classList.contains('lm-open')) schedulePipAutoClose();
    });
    document.getElementById('lm-pip-panel').addEventListener('touchstart', clearPipAutoClose, { passive: true });

    // Cegah tutup tab saat ujian berlangsung
    window.addEventListener('beforeunload', function (e) {
      if (roomData) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ══════════════════════════════════════════════════
     SESSION PERSIST
  ══════════════════════════════════════════════════ */
  function saveSession() {
    if (!roomData || !myName) return;
    const emailEl = document.getElementById('lm-inp-email');
    sessionStorage.setItem('lidan_session', JSON.stringify({
      roomData, myName,
      myEmail: emailEl ? emailEl.value : ''
    }));
  }
  function clearSession() {
    sessionStorage.removeItem('lidan_session');
  }
  function restoreSession() {
    const saved = sessionStorage.getItem('lidan_session');
    if (!saved) return false;
    try {
      const sess = JSON.parse(saved);
      if (sess.roomData && sess.myName) {
        roomData = sess.roomData;
        myName   = sess.myName;
        return true;
      }
    } catch (e) { sessionStorage.removeItem('lidan_session'); }
    return false;
  }

  /* ══════════════════════════════════════════════════
     JOIN
  ══════════════════════════════════════════════════ */
  async function handleJoin() {
    const hiddenRoom  = document.getElementById('lm-inp-room-hidden').value.trim();
    const visibleRoom = document.getElementById('lm-inp-room')
                          ? document.getElementById('lm-inp-room').value.trim()
                          : '';
    const roomInput   = hiddenRoom || visibleRoom;
    const displayName = document.getElementById('lm-inp-name').value.trim();
    const email       = document.getElementById('lm-inp-email').value.trim();

    if (!roomInput)   return showAlert('Kode room wajib diisi.');
    if (!displayName) return showAlert('Nama lengkap wajib diisi.');

    setLoading(true);
    hideAlert();

    try {
      const res = await fetch(API_JOIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: PRESET_ACCOUNT, roomName: roomInput, displayName, userEmail: email }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      if (!data.success || !data.token) {
        setLoading(false);
        return showAlert(data.error || 'Gagal mendapatkan token.');
      }
      roomData = data;
      myName   = displayName;
    } catch (e) {
      setLoading(false);
      return showAlert('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
    }

    await startSelfCamera();
    startMeet();
    setLoading(false);
  }

  /* ══════════════════════════════════════════════════
     SELF CAMERA
  ══════════════════════════════════════════════════ */
  async function startSelfCamera() {
    try {
      selfStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const vid  = document.getElementById('lm-self-video');
      vid.srcObject = selfStream;
      document.getElementById('lm-cam-off').classList.remove('lm-show');
      // Mute audio track — Jitsi yang urus audio, bukan selfStream
      selfStream.getAudioTracks().forEach(t => t.enabled = false);
    } catch (e) {
      console.warn('[LidanMeet] Kamera tidak tersedia:', e);
      document.getElementById('lm-cam-off').classList.add('lm-show');
    }
  }

  /* ══════════════════════════════════════════════════
     START MEET
  ══════════════════════════════════════════════════ */
  function startMeet() {
    document.getElementById('lm-lobby-overlay').classList.add('lm-hidden');
    document.getElementById('lm-loading-screen').classList.add('lm-show');
    document.getElementById('lm-pip-widget').classList.add('lm-visible');
    // Timer badge disembunyikan (tidak ditampilkan ke peserta)

    meetStart     = Date.now();
    timerInterval = setInterval(updateTimer, 1000);

    saveSession();
    window.location.hash = encodeURIComponent(roomData.room);

    embedJitsi();
    startSignalPoll();
  }

  /* ══════════════════════════════════════════════════
     JITSI EMBED  v1.3
     FIX: 8x8.vc mengabaikan prejoinPageEnabled:false,
     sehingga prejoin page tetap muncul tapi tersembunyi
     di -9999px. Solusi: auto-bypass via postMessage +
     DOM polling klik tombol join di dalam iframe.
  ══════════════════════════════════════════════════ */
  function embedJitsi() {
    const container = document.getElementById('lm-jitsi-container');
    let   _prejoinBypassInterval = null;
    let   _alreadyJoined         = false;

    /* ── Helper: kirim perintah bypass ke iframe ── */
    function sendPrejoinBypass(iframe) {
      if (!iframe || _alreadyJoined) return;
      try {
        // Cara 1: postMessage format Jitsi (beberapa versi 8x8 mendengarkan ini)
        iframe.contentWindow.postMessage({ name: 'join-conference' }, '*');
        // Cara 2: postMessage format lama
        iframe.contentWindow.postMessage(JSON.stringify({
          action: 'join-conference'
        }), '*');
      } catch {}
    }

    /* ── Helper: klik tombol join via DOM iframe (same-origin tidak bisa,
       tapi beberapa env 8x8 iframe accessible) ── */
    function clickPrejoinButton(iframe) {
      if (!iframe || _alreadyJoined) return;
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        // Selector umum tombol join Jitsi prejoin page
        const selectors = [
          '[data-testid="prejoin.joinMeeting"]',
          '.prejoin-button-join',
          'button[class*="join"]',
          'button[class*="Join"]',
          '.premeeting-screen button',
          'div[role="button"][class*="join"]',
        ];
        for (const sel of selectors) {
          const btn = doc.querySelector(sel);
          if (btn) { btn.click(); return true; }
        }
      } catch {} // cross-origin → skip, andalkan postMessage
      return false;
    }

    /* ── Mulai loop bypass setiap 800ms ── */
    function startPrejoinBypass() {
      if (_prejoinBypassInterval) return;
      let attempts = 0;
      _prejoinBypassInterval = setInterval(() => {
        if (_alreadyJoined) {
          clearInterval(_prejoinBypassInterval);
          _prejoinBypassInterval = null;
          return;
        }
        attempts++;
        const iframe = container.querySelector('iframe');
        if (iframe) {
          sendPrejoinBypass(iframe);
          clickPrejoinButton(iframe);
        }
        // Hentikan setelah 30 detik (60 × 500ms) — jangan loop selamanya
        if (attempts >= 60) {
          clearInterval(_prejoinBypassInterval);
          _prejoinBypassInterval = null;
        }
      }, 500);
    }

    const tryEmbed = () => {
      if (typeof JitsiMeetExternalAPI === 'undefined') {
        setTimeout(tryEmbed, 300);
        return;
      }

      const cleanToken = (roomData.token || '').replace(/^"|"$/g, '').trim();

      const options = {
        roomName  : roomData.room,
        width     : '100%',
        height    : '100%',
        parentNode: container,
        jwt       : cleanToken,

        configOverwrite: {
          prejoinPageEnabled        : false,   // dicoba dulu, kadang berhasil
          prejoinConfig             : { enabled: false },
          startWithAudioMuted       : true,
          startWithVideoMuted       : false,
          toolbarButtons            : [],
          filmstrip                 : { enabled: false },
          disableTileView           : true,
          hideConferenceSubject     : true,
          subject                   : ' ',
          enableWelcomePage         : false,
          defaultRemoteDisplayName  : 'Peserta',
          disableModeratorIndicator : true,
        },

        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK        : false,
          SHOW_WATERMARK_FOR_GUESTS   : false,
          SHOW_BRAND_WATERMARK        : false,
          SHOW_POWERED_BY             : false,
          TOOLBAR_ALWAYS_VISIBLE      : false,
          DEFAULT_BACKGROUND          : '#0b0f1a',
          APP_NAME                    : 'Lidan Meet',
          DEFAULT_REMOTE_DISPLAY_NAME : 'Peserta',
          FILM_STRIP_MAX_HEIGHT       : 0,
          HIDE_INVITE_MORE_HEADER     : true,
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
        },
      };

      // Bersihkan instance lama
      if (jitsiAPI) { try { jitsiAPI.dispose(); } catch {} }
      if (_prejoinBypassInterval) {
        clearInterval(_prejoinBypassInterval);
        _prejoinBypassInterval = null;
      }
      _alreadyJoined = false;
      container.querySelectorAll('iframe').forEach(el => el.remove());

      jitsiAPI = new JitsiMeetExternalAPI(roomData.domain, options);

      // Mulai bypass prejoin segera setelah API dibuat
      startPrejoinBypass();

      // Event: berhasil join → sembunyikan loading, stop bypass loop
      jitsiAPI.addEventListener('videoConferenceJoined', () => {
        _alreadyJoined = true;
        if (_prejoinBypassInterval) {
          clearInterval(_prejoinBypassInterval);
          _prejoinBypassInterval = null;
        }
        hideLoadingScreen();
        showToast('✅ Terhubung ke ruang ujian.', 'success');
        // FAB akan muncul otomatis via signal. Burst poll agar tidak terlambat.
        startSignalPollBurst();
        // Mic sudah mute saat join karena startWithAudioMuted:true — tidak perlu command tambahan
        // Tandai waktu join — pesan dalam 5 detik pertama diabaikan (history replay)
        _joinedAt = Date.now();
        // Kirim ping admin "available" jika ini halaman admin
        if (PRESET_ACCOUNT && document.body.dataset.lidanRole === 'admin') {
          _startAdminPing();
        }
      });

      // Lacak participant → cari ID admin (displayName mengandung "[Pengawas]")
      jitsiAPI.addEventListener('participantJoined', ({ id, displayName }) => {
        if ((displayName || '').includes('[Pengawas]') || (displayName || '').toLowerCase().includes('pengawas')) {
          _adminParticipantId = id;
        }
      });
      jitsiAPI.addEventListener('participantLeft', ({ id }) => {
        if (id === _adminParticipantId) _adminParticipantId = null;
      });

      // FIX: sync state micEnabled dari Jitsi agar selalu akurat
      jitsiAPI.addEventListener('audioMuteStatusChanged', ({ muted }) => {
        micEnabled = !muted;
        _updateMicUI(micEnabled);
      });

      // Intercept outgoingMessage: jika bukan private ke admin, batalkan via toast
      // (Jitsi sudah kirim — kita tidak bisa batalkan, tapi bisa redirect ulang)
      jitsiAPI.addEventListener('outgoingMessage', ({ message, privateMessage, recipientDisplayName }) => {
        if (!privateMessage) {
          // Pesan dikirim ke "Everyone" — coba kirim ulang sebagai private ke admin
          if (_adminParticipantId) {
            try {
              jitsiAPI.executeCommand('sendChatMessage', message, _adminParticipantId);
            } catch {}
          }
          // Tampilkan peringatan
          showToast('⚠️ Pesan hanya bisa dikirim ke Pengawas.', 'warn');
        }
      });

      // Event: pesan masuk dari Jitsi chat → tampilkan notifikasi di tombol PiP
      // Abaikan pesan dalam 5 detik pertama setelah join (history replay)
      jitsiAPI.addEventListener('incomingMessage', ({ from, message, privateMessage }) => {
        if (_joinedAt && Date.now() - _joinedAt < 5000) return;
        const btn = document.getElementById('lm-btn-chat');
        if (btn) {
          btn.classList.add('lm-has-unread');
          btn.textContent = '💬 Chat (baru)';
        }
        const label = privateMessage ? '🔒 Pesan privat' : `💬 ${from || 'Pengawas'}`;
        showToast(`${label}: ${(message || '').substring(0, 50)}`, 'info');
      });

      // Reset badge unread saat chat Jitsi dibuka
      jitsiAPI.addEventListener('chatUpdated', ({ isOpen }) => {
        const btn = document.getElementById('lm-btn-chat');
        if (isOpen) {
          if (btn) { btn.classList.remove('lm-has-unread'); btn.textContent = '✕ Tutup Chat'; }
        } else {
          if (btn && _jitsiOverlayOpen) closeJitsiOverlay();
        }
      });

      // Fallback: paksa sembunyikan loading setelah 12 detik
      // (lebih panjang dari sebelumnya agar bypass sempat bekerja)
      setTimeout(() => {
        if (!_alreadyJoined) {
          hideLoadingScreen();
          showToast('⚠️ Koneksi lambat — audio/video mungkin butuh beberapa saat.', 'warn');
        }
      }, 12000);
    };

    // Load script Jitsi jika belum
    if (typeof JitsiMeetExternalAPI === 'undefined') {
      setLoadingText('Memuat modul video…');
      const s   = document.createElement('script');
      s.src     = 'https://8x8.vc/vpaas-magic-cookie-6a0d4b63e58e420781a516524f2d3fd3/external_api.js';
      s.onload  = tryEmbed;
      s.onerror = () => {
        hideLoadingScreen();
        showToast('⚠️ Gagal memuat modul video. Audio mungkin tidak aktif.', 'warn');
      };
      document.head.appendChild(s);
    } else {
      tryEmbed();
    }
  }

  function hideLoadingScreen() {
    const el = document.getElementById('lm-loading-screen');
    if (el) { el.classList.remove("lm-show"); el.classList.add("lm-hidden"); }
  }

  function setLoadingText(msg) {
    const el = document.getElementById('lm-loading-text');
    if (el) el.textContent = msg;
  }

  /* ══════════════════════════════════════════════════
     LEAVE
  ══════════════════════════════════════════════════ */
  function handleLeave() {
    if (!confirm('Yakin ingin keluar dari ruang ujian?')) return;

    if (handRaised) signalSend('cancel');
    if (jitsiAPI)   { try { jitsiAPI.dispose(); } catch {} jitsiAPI = null; }
    if (selfStream) { selfStream.getTracks().forEach(t => t.stop()); selfStream = null; }

    clearInterval(timerInterval);
    clearInterval(pollInterval);
    timerInterval = pollInterval = null;

    const ids = ['lm-pip-widget','lm-pip-panel','lm-timer-badge',
                 'lm-broadcast-banner','lm-private-banner'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('lm-visible','lm-open','lm-show');
    });

    const fabEl = document.getElementById('lm-fab-tanya');
    if (fabEl) fabEl.classList.remove('lm-fab-visible');
    closeFabPopup();

    // Tutup Jitsi overlay jika sedang terbuka
    const wrap = document.getElementById('lm-jitsi-wrap');
    const bar  = document.getElementById('lm-chat-close-bar');
    if (wrap) wrap.classList.remove('lm-chat-open');
    if (bar)  bar.classList.remove('lm-show');
    _jitsiOverlayOpen = false;

    hideLoadingScreen();
    document.getElementById('lm-lobby-overlay').classList.remove('lm-hidden');

    window.location.hash = '';
    clearSession();
    roomData = null; myName = ''; handRaised = false; micEnabled = false; _adminParticipantId = null; _joinedAt = null;
  }

  /* ══════════════════════════════════════════════════
     PiP PANEL TOGGLE
     - Auto-close setelah 3 detik
     - Klik di luar panel tutup
  ══════════════════════════════════════════════════ */
  function openPipPanel() {
    // Jika admin idle, jangan tampilkan panel sama sekali
    if (adminStatus === 'idle') return;
    const panel = document.getElementById('lm-pip-panel');
    const box   = document.getElementById('lm-pip-box');
    panel.classList.add('lm-open');
    box.classList.add('lm-active-pip');
    schedulePipAutoClose();
  }

  function closePipPanel() {
    const panel = document.getElementById('lm-pip-panel');
    const box   = document.getElementById('lm-pip-box');
    panel.classList.remove('lm-open');
    box.classList.remove('lm-active-pip');
    clearPipAutoClose();
  }

  function togglePipPanel() {
    const panel = document.getElementById('lm-pip-panel');
    if (panel.classList.contains('lm-open')) { closePipPanel(); }
    else { openPipPanel(); }
  }

  function schedulePipAutoClose() {
    clearPipAutoClose();
    _pipAutoCloseTimer = setTimeout(closePipPanel, 3000);
  }

  function clearPipAutoClose() {
    if (_pipAutoCloseTimer) { clearTimeout(_pipAutoCloseTimer); _pipAutoCloseTimer = null; }
  }

  /* ══════════════════════════════════════════════════
     PiP DRAG — klik tahan / drag widget video
  ══════════════════════════════════════════════════ */
  function initPipDrag() {
    const widget = document.getElementById('lm-pip-widget');
    if (!widget) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;
    let dragMoved = false;

    function toAbsolute() {
      const rect = widget.getBoundingClientRect();
      widget.style.bottom = 'auto';
      widget.style.right  = 'auto';
      widget.style.top    = rect.top  + 'px';
      widget.style.left   = rect.left + 'px';
    }

    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

    function onPointerDown(e) {
      if (!e.target.closest('#lm-pip-box')) return;
      e.preventDefault();
      isDragging = true; dragMoved = false;
      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX; startY = touch.clientY;
      toAbsolute();
      origLeft = parseFloat(widget.style.left);
      origTop  = parseFloat(widget.style.top);
      widget.style.transition = 'none';
      widget.style.userSelect = 'none';
      widget.style.cursor     = 'grabbing';
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      const touch = e.touches ? e.touches[0] : e;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
      widget.style.left = clamp(origLeft + dx, 0, window.innerWidth  - widget.offsetWidth)  + 'px';
      widget.style.top  = clamp(origTop  + dy, 0, window.innerHeight - widget.offsetHeight) + 'px';
    }

    function onPointerUp() {
      if (!isDragging) return;
      isDragging = false;
      widget.style.transition = '';
      widget.style.cursor     = '';
      widget.style.userSelect = '';
      if (!dragMoved) togglePipPanel();
    }

    widget.addEventListener('mousedown',   onPointerDown);
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup',   onPointerUp);
    widget.addEventListener('touchstart',  onPointerDown, { passive: false });
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend',  onPointerUp);

    // Klik di luar pip widget → tutup panel
    document.addEventListener('mousedown', function(e) {
      const w = document.getElementById('lm-pip-widget');
      const p = document.getElementById('lm-pip-panel');
      if (p && p.classList.contains('lm-open') && w && !w.contains(e.target)) {
        closePipPanel();
      }
    });
    document.addEventListener('touchstart', function(e) {
      const w = document.getElementById('lm-pip-widget');
      const p = document.getElementById('lm-pip-panel');
      if (p && p.classList.contains('lm-open') && w && !w.contains(e.target)) {
        closePipPanel();
      }
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════
     MIC TOGGLE
  ══════════════════════════════════════════════════ */
  function toggleMic() {
    if (!jitsiAPI) return;

    // FIX: gunakan 'toggleAudio' bukan 'setAudioMuted' (tidak dikenal External API)
    try { jitsiAPI.executeCommand('toggleAudio'); } catch {}

    micEnabled = !micEnabled;

    if (selfStream) {
      selfStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    }

    _updateMicUI(micEnabled);
  }

  function _updateMicUI(on) {
    const btn = document.getElementById('lm-btn-mic');
    if (btn) {
      btn.textContent = on ? '🎙️ Mic Hidup' : '🔇 Mic Mati';
      btn.classList.toggle('lm-active', on);
    }
    _syncFabMicBtn();
  }

  /* ══════════════════════════════════════════════════
     RAISE HAND
  ══════════════════════════════════════════════════ */
  async function handleRaiseHand() {
    if (!roomData) return;
    const btn    = document.getElementById('lm-btn-raise');
    const fabBtn = document.getElementById('lm-fab-btn-raise');

    if (handRaised) {
      // Batalkan antrian
      handRaised = false;
      if (btn)    { btn.classList.remove('lm-in-queue', 'lm-cancel'); btn.textContent = '🖐️ Tanya Pengawas'; }
      if (fabBtn) { fabBtn.classList.remove('lm-in-queue', 'lm-cancel'); fabBtn.textContent = '🖐️ Tanya Pengawas'; }
      const qi = document.getElementById('lm-queue-info');
      if (qi) qi.classList.remove('lm-show');
      await signalSend('cancel');
      showToast('Pertanyaan dibatalkan.', 'info');
      return;
    }

    if (adminStatus === 'idle') {
      showToast('Pengawas sedang tidak aktif. Coba lagi nanti.', 'warn');
      return;
    }

    handRaised = true;
    if (btn)    { btn.classList.add('lm-in-queue'); btn.textContent = '⏳ Menunggu… (tap untuk batal)'; }
    if (fabBtn) { fabBtn.classList.add('lm-in-queue'); fabBtn.textContent = '⏳ Menunggu… (tap untuk batal)'; }

    const res = await signalSend('raise');
    if (res && res.position !== undefined) {
      queuePos = res.position;
      if (queuePos === 0 && adminStatus === 'available') {
        showToast('Pengawas siap! Mic Anda akan dibuka.', 'success');
        if (btn)    { btn.textContent = '🗣️ Sedang Bicara…'; btn.classList.remove('lm-in-queue'); }
        if (fabBtn) { fabBtn.textContent = '🗣️ Sedang Bicara…'; fabBtn.classList.remove('lm-in-queue'); }
      } else {
        updateQueueDisplay(queuePos);
        if (btn)    { btn.classList.add('lm-cancel'); btn.textContent = `⏳ Antrian #${queuePos + 1} — tap untuk batal`; }
        if (fabBtn) { fabBtn.classList.add('lm-cancel'); fabBtn.textContent = `⏳ Antrian #${queuePos + 1} — tap untuk batal`; }
      }
    }
  }

  function updateQueueDisplay(pos) {
    const el   = document.getElementById('lm-queue-info');
    const wait = (pos + 1) * 2;
    el.textContent = `Posisi antrian: #${pos + 1} — estimasi tunggu ±${wait} menit`;
    el.classList.add('lm-show');
  }

  /* ══════════════════════════════════════════════════
     CHAT — tampilkan Jitsi sebagai overlay layar penuh
  ══════════════════════════════════════════════════ */
  let _jitsiOverlayOpen = false;

  function toggleChat() {
    if (_jitsiOverlayOpen) { closeJitsiOverlay(); } else { openJitsiOverlay(); }
  }

  function openJitsiOverlay() {
    _jitsiOverlayOpen = true;
    const wrap = document.getElementById('lm-jitsi-wrap');
    const bar  = document.getElementById('lm-chat-close-bar');
    const btn  = document.getElementById('lm-btn-chat');
    if (wrap) wrap.classList.add('lm-chat-open');
    if (bar)  bar.classList.add('lm-show');
    if (btn)  { btn.classList.remove('lm-has-unread'); btn.textContent = '✕ Tutup Chat'; }

    // Sembunyikan FAB agar tidak menutupi input chat
    const fab = document.getElementById('lm-fab-tanya');
    if (fab) fab.classList.add('lm-fab-hidden');
    closeFabPopup();

    // Pasang video-block overlay (menutupi area non-chat)
    const vb = document.getElementById('lm-video-block');
    if (vb) vb.style.display = 'flex';
    else { ensureVideoBlockOverlay(); document.getElementById('lm-video-block').style.display = 'flex'; }

    // Buka chat Jitsi via command setelah overlay tampil
    setTimeout(() => {
      if (jitsiAPI) {
        try { jitsiAPI.executeCommand('toggleChat'); } catch {}
      }
    }, 200);
  }

  /* ── Video-block overlay: kotak hitam menutupi area video,
     hanya area chat kiri (~315px) yang transparan ── */
  function ensureVideoBlockOverlay() {
    if (document.getElementById('lm-video-block')) return;
    const el = document.createElement('div');
    el.id = 'lm-video-block';
    el.innerHTML = `
      <div style="font-size:32px">📋</div>
      <div style="color:#6b7fa3;font-weight:500">Sedang Ujian</div>
      <div style="font-size:12px;color:#3d5170">Video dinonaktifkan selama ujian berlangsung</div>
    `;
    document.body.appendChild(el);
  }

  function closeJitsiOverlay() {
    _jitsiOverlayOpen = false;
    const wrap = document.getElementById('lm-jitsi-wrap');
    const bar  = document.getElementById('lm-chat-close-bar');
    const btn  = document.getElementById('lm-btn-chat');
    if (wrap) wrap.classList.remove('lm-chat-open');
    if (bar)  bar.classList.remove('lm-show');
    if (btn)  btn.textContent = '💬 Chat';

    // Tampilkan kembali FAB jika pengawas masih aktif
    const fab = document.getElementById('lm-fab-tanya');
    if (fab) fab.classList.remove('lm-fab-hidden');

    // Sembunyikan video block overlay
    const vb = document.getElementById('lm-video-block');
    if (vb) vb.style.display = 'none';
    // Tutup chat Jitsi juga
    if (jitsiAPI) {
      try { jitsiAPI.executeCommand('toggleChat'); } catch {}
    }
  }

  /* ══════════════════════════════════════════════════
     SIGNAL — send & poll
  ══════════════════════════════════════════════════ */
  async function signalSend(action, payload = {}) {
    try {
      const res = await fetch(API_SIGNAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room:        roomData?.room,
          action:      action,
          participant: myName,
          ...payload,
        }),
      });
      return await res.json();
    } catch { return null; }
  }

  function startSignalPoll() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollSignal, SIGNAL_POLL_MS);
    pollSignal();
  }

  // Burst poll saat baru join: coba 3x dengan jeda 1 detik agar FAB tidak terlambat muncul
  function startSignalPollBurst() {
    let attempts = 0;
    const burst = setInterval(() => {
      pollSignal();
      attempts++;
      if (attempts >= 3) clearInterval(burst);
    }, 1000);
  }

  async function pollSignal() {
    if (!roomData) return;
    try {
      const res = await fetch(
        `${API_SIGNAL}?room=${encodeURIComponent(roomData.room)}&participant=${encodeURIComponent(myName)}`,
        { signal: AbortSignal.timeout(4000) }
      );
      // Tetap proses jika ada data meski status non-ok (misal 304, 5xx dengan body)
      let data;
      try { data = await res.json(); } catch { return; }
      if (!data || !data.success) return;
      processSignal(data);
    } catch {} // timeout / network error — abaikan, tunggu poll berikutnya
  }

  function processSignal(data) {
    if (data.adminStatus !== undefined) {
      const prev  = adminStatus;
      adminStatus = data.adminStatus;
      updateAdminStatusUI(adminStatus, prev);
    }

    if (data.myQueue !== undefined) {
      queuePos = data.myQueue;
      if (handRaised && queuePos !== null) {
        updateQueueDisplay(queuePos);
        const btn = document.getElementById('lm-btn-raise');
        if (btn) btn.textContent = `⏳ Antrian #${queuePos + 1} — tap untuk batal`;
      }
    }

    if (data.answerPrivate && data.answerPrivate === myName) {
      showPrivateCallBanner();
      if (!micEnabled) toggleMic();
    }

    const bcastEl = document.getElementById('lm-broadcast-banner');
    if (bcastEl) bcastEl.classList.toggle('lm-show', !!data.broadcast);

    if (data.queueDone && handRaised) {
      handRaised = false;
      queuePos   = null;
      const btn  = document.getElementById('lm-btn-raise');
      if (btn) {
        btn.classList.remove('lm-in-queue', 'lm-cancel');
        btn.textContent = '🖐️ Tanya Pengawas';
      }
      const qi = document.getElementById('lm-queue-info');
      if (qi) qi.classList.remove('lm-show');
      if (micEnabled) toggleMic();
      showToast('Sesi tanya jawab selesai. Mic Anda dinonaktifkan.', 'info');
    }

    // Terima pesan chat dari pengawas/server — sudah ditangani Jitsi built-in
  }

  function updateAdminStatusUI(status, prev) {
    const dot  = document.getElementById('lm-admin-dot');
    const text = document.getElementById('lm-admin-text');
    if (!dot || !text) return;
    dot.className = 'lm-admin-dot';

    const map = {
      available: { cls: 'available', label: '🟢 Pengawas tersedia' },
      busy:      { cls: 'busy',      label: '🔴 Pengawas sedang bicara privat' },
      broadcast: { cls: 'broadcast', label: '📢 Pengawas sedang bicara ke semua' },
      idle:      { cls: 'idle',      label: '⏸️ Pengawas tidak aktif' },
    };
    const s = map[status] || map.idle;
    dot.classList.add(s.cls);
    text.textContent = s.label;

    // Sync dot & teks di popup FAB
    const fabDot  = document.getElementById('lm-fab-admin-dot');
    const fabText = document.getElementById('lm-fab-admin-text');
    if (fabDot)  { fabDot.className = 'lm-admin-dot'; fabDot.classList.add(s.cls); }
    if (fabText) fabText.textContent = s.label;

    // FAB: tampil hanya saat pengawas aktif (bukan idle)
    const fab = document.getElementById('lm-fab-tanya');
    if (fab) {
      if (status !== 'idle') {
        fab.classList.add('lm-fab-visible');
        closeFabPopup();  // tutup popup lama jika ada, biarkan user buka ulang
      } else {
        fab.classList.remove('lm-fab-visible');
        closeFabPopup();
      }
    }

    if (status === 'broadcast' && prev !== 'broadcast') {
      showToast('📢 Pengawas sedang bicara kepada semua peserta.', 'warn');
    }
  }

  /* ══════════════════════════════════════════════════
     FAB — tombol melayang Tanya Pengawas
  ══════════════════════════════════════════════════ */
  function toggleFabPopup() {
    const fab = document.getElementById('lm-fab-tanya');
    if (fab && fab.classList.contains('lm-fab-idle')) return; // block saat idle
    const popup = document.getElementById('lm-fab-popup');
    if (!popup) return;
    if (popup.classList.contains('lm-fab-open')) {
      closeFabPopup();
    } else {
      openFabPopup();
    }
  }

  function openFabPopup() {
    const popup = document.getElementById('lm-fab-popup');
    if (popup) popup.classList.add('lm-fab-open');
    _syncFabMicBtn();
    _syncFabRaiseBtn();
    _syncFabChatBtn();
  }

  function closeFabPopup() {
    const popup = document.getElementById('lm-fab-popup');
    if (popup) popup.classList.remove('lm-fab-open');
  }

  function _syncFabMicBtn() {
    const btn = document.getElementById('lm-fab-btn-mic');
    if (!btn) return;
    if (micEnabled) {
      btn.textContent = '🎙️ Mic Hidup';
      btn.classList.add('lm-active');
    } else {
      btn.textContent = '🔇 Mic Mati';
      btn.classList.remove('lm-active');
    }
  }

  function _syncFabRaiseBtn() {
    const src = document.getElementById('lm-btn-raise');
    const dst = document.getElementById('lm-fab-btn-raise');
    if (!src || !dst) return;
    dst.textContent = src.textContent;
    dst.classList.toggle('lm-in-queue', src.classList.contains('lm-in-queue'));
    dst.classList.toggle('lm-cancel',   src.classList.contains('lm-cancel'));
  }

  function _syncFabChatBtn() {
    const src = document.getElementById('lm-btn-chat');
    const dst = document.getElementById('lm-fab-btn-chat');
    if (src && dst) dst.textContent = src.textContent;
  }

  function showPrivateCallBanner() {
    const el = document.getElementById('lm-private-banner');
    if (el) {
      el.classList.add('lm-show');
      showToast('📞 Pengawas menghubungi Anda. Mic dibuka otomatis.', 'success');
      setTimeout(() => el.classList.remove('lm-show'), 6000);
    }
  }

  /* ══════════════════════════════════════════════════
     TIMER
  ══════════════════════════════════════════════════ */
  function updateTimer() {
    const e = Math.floor((Date.now() - meetStart) / 1000);
    const m = String(Math.floor(e / 60)).padStart(2, '0');
    const s = String(e % 60).padStart(2, '0');
    const el = document.getElementById('lm-timer-badge');
    if (el) el.textContent = `${m}:${s}`;
  }

  /* ══════════════════════════════════════════════════
     UI HELPERS
  ══════════════════════════════════════════════════ */
  function setLoading(on) {
    const btn  = document.getElementById('lm-btn-join');
    const sp   = document.getElementById('lm-spinner');
    const text = document.getElementById('lm-btn-join-text');
    if (!btn) return;
    btn.disabled = on;
    if (sp)   sp.classList.toggle('lm-show', on);
    if (text) text.textContent = on ? 'Menghubungkan…' : 'Masuk Ruang Ujian';
  }

  function showAlert(msg) {
    const el = document.getElementById('lm-alert');
    if (el) { el.textContent = msg; el.classList.add('lm-show'); }
  }
  function hideAlert() {
    const el = document.getElementById('lm-alert');
    if (el) el.classList.remove('lm-show');
  }

  function showToast(msg, type = 'info') {
    const c = document.getElementById('lm-toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className   = `lm-toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => {
      t.style.opacity    = '0';
      t.style.transition = 'opacity 0.3s';
      setTimeout(() => t.remove(), 300);
    }, 4000);
  }

  /* ══════════════════════════════════════════════════
     ADMIN PING — kirim status "available" ke server
     setiap 20 detik agar peserta tahu pengawas aktif
  ══════════════════════════════════════════════════ */
  let _adminPingInterval = null;

  function _startAdminPing() {
    _sendAdminStatus('available');
    if (_adminPingInterval) clearInterval(_adminPingInterval);
    _adminPingInterval = setInterval(() => _sendAdminStatus('available'), 20000);
  }

  async function _sendAdminStatus(status) {
    if (!roomData) return;
    try {
      await fetch(API_SIGNAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomData.room, adminStatus: status }),
      });
    } catch {}
  }

  /* ══════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════ */
  function boot() {
    injectFonts();
    injectStyles();
    injectHTML();

    // Restore session jika refresh di tengah ujian
    if (restoreSession()) {
      startSelfCamera().then(() => startMeet());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();