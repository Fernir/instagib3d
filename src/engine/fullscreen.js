import { state } from '@/core/runtime-state.js';

import { isMobileControls } from './mobilecontrols.js';

const HINT_KEY = 'instagib3d_install_hint';

let installPrompt = null;
let hintEl = null;

function fullscreenElement(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}

export function isStandaloneDisplay(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  if (win.navigator?.standalone === true) return true;
  const mq = win.matchMedia?.bind(win) || win.matchMedia;
  if (!mq) return false;
  return mq('(display-mode: standalone)').matches || mq('(display-mode: fullscreen)').matches;
}

export function isFullscreenActive(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return false;
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export function isIOSDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
  return /iPhone|iPad|iPod/i.test(nav?.userAgent || '');
}

export function canRequestElementFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  const el = doc?.documentElement;
  if (!el) return false;
  return !!(
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    doc.documentElement?.webkitRequestFullScreen
  );
}

export async function enterFullscreen(element) {
  const el = element || state.canvas || document.documentElement;
  if (!el) return false;
  if (isStandaloneDisplay() || isFullscreenActive()) return true;

  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
      return true;
    }
    if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
      return true;
    }
    if (el.webkitEnterFullscreen) {
      el.webkitEnterFullscreen();
      return true;
    }
  } catch (_err) {
    return false;
  }
  return false;
}

export async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (_err) {
    /* ignore */
  }
}

export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try {
    if (state.wakeLock) {
      try {
        await state.wakeLock.release();
      } catch (_e) {
        /* ignore */
      }
      state.wakeLock = null;
    }
    state.wakeLock = await navigator.wakeLock.request('screen');
    return true;
  } catch (_err) {
    return false;
  }
}

export async function releaseWakeLock() {
  if (!state.wakeLock) return;
  try {
    await state.wakeLock.release();
  } catch (_err) {
    /* ignore */
  }
  state.wakeLock = null;
}

export async function enterMobileImmersiveMode() {
  if (!isMobileControls()) return { fullscreen: false, wakeLock: false };
  const fullscreen = await enterFullscreen(state.canvas || document.documentElement);
  const wakeLock = await requestWakeLock();
  hideInstallHint();
  return { fullscreen, wakeLock };
}

function installHintText() {
  if (isIOSDevice()) {
    return 'Режим как в приложении: Поделиться → «На экран Домой»';
  }
  if (installPrompt) {
    return 'Режим как в приложении: установите игру или нажмите Play для полного экрана';
  }
  return 'Режим как в приложении: нажмите Play — откроется полный экран';
}

function ensureInstallHint() {
  if (hintEl || isStandaloneDisplay()) return hintEl;
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HINT_KEY) === '1') {
    return null;
  }

  hintEl = document.createElement('div');
  hintEl.className = 'mobile-install-hint';
  hintEl.innerHTML =
    '<span class="mobile-install-hint__text"></span>' +
    (installPrompt ? '<button type="button" class="mobile-install-hint__install">Установить</button>' : '') +
    '<button type="button" class="mobile-install-hint__close" aria-label="Close">×</button>';
  document.body.appendChild(hintEl);

  const text = hintEl.querySelector('.mobile-install-hint__text');
  if (text) text.textContent = installHintText();

  const closeBtn = hintEl.querySelector('.mobile-install-hint__close');
  closeBtn?.addEventListener('click', hideInstallHint);

  const installBtn = hintEl.querySelector('.mobile-install-hint__install');
  installBtn?.addEventListener('click', () => {
    promptInstall().then((ok) => {
      if (ok) hideInstallHint();
    });
  });

  return hintEl;
}

export function showInstallHint() {
  if (!isMobileControls() || isStandaloneDisplay() || state.playing) return;
  ensureInstallHint();
}

export function hideInstallHint() {
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(HINT_KEY, '1');
  if (hintEl) {
    hintEl.remove();
    hintEl = null;
  }
}

export async function promptInstall() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const result = await installPrompt.userChoice;
  installPrompt = null;
  updateInstallHintText();
  return result.outcome === 'accepted';
}

function updateInstallHintText() {
  if (!hintEl) return;
  const text = hintEl.querySelector('.mobile-install-hint__text');
  if (text) text.textContent = installHintText();
}

function onVisibilityChange() {
  if (document.hidden) return;
  if (state.playing && isMobileControls()) {
    requestWakeLock();
    if (!isStandaloneDisplay() && !isFullscreenActive()) {
      enterFullscreen(state.canvas || document.documentElement);
    }
  }
}

export function initMobileDisplay(canvas) {
  if (!isMobileControls()) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallHintText();
    showInstallHint();
  });

  document.addEventListener('visibilitychange', onVisibilityChange);
  showInstallHint();

  if (state.Console?.addCommand) {
    state.Console.addCommand('fullscreen', 'toggle browser fullscreen (mobile)', async function () {
      if (isFullscreenActive()) await exitFullscreen();
      else await enterFullscreen(canvas || state.canvas || document.documentElement);
    });
  }
}
