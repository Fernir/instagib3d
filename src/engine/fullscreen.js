import { state } from '@/core/runtime-state.js';

import { MobileControls } from './mobilecontrols.js';

const HINT_KEY = 'instagib3d_install_hint';

export class MobileDisplay {
  static installPrompt = null;
  static hintEl = null;

  static isStandalone(win = typeof window !== 'undefined' ? window : null) {
    if (!win) return false;
    if (win.navigator?.standalone === true) return true;
    const mq = win.matchMedia?.bind(win) || win.matchMedia;
    if (!mq) return false;
    return mq('(display-mode: standalone)').matches || mq('(display-mode: fullscreen)').matches;
  }

  static isFullscreenActive(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return false;
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  }

  static isIOS(nav = typeof navigator !== 'undefined' ? navigator : null) {
    return /iPhone|iPad|iPod/i.test(nav?.userAgent || '');
  }

  static canRequestElementFullscreen(doc = typeof document !== 'undefined' ? document : null) {
    const el = doc?.documentElement;
    if (!el) return false;
    return !!(
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      doc.documentElement?.webkitRequestFullScreen
    );
  }

  static async enterFullscreen(element) {
    const el = element || document.documentElement;
    if (!el) return false;
    if (MobileDisplay.isStandalone() || MobileDisplay.isFullscreenActive()) return true;

    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
        return true;
      }
      if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
        return true;
      }
    } catch (_err) {
      return false;
    }
    return false;
  }

  static async exitFullscreen() {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (_err) {
      /* ignore */
    }
  }

  static async requestWakeLock() {
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

  static async releaseWakeLock() {
    if (!state.wakeLock) return;
    try {
      await state.wakeLock.release();
    } catch (_err) {
      /* ignore */
    }
    state.wakeLock = null;
  }

  static async enterImmersiveMode() {
    if (!MobileControls.isActive()) return { fullscreen: false, wakeLock: false };
    const fullscreen = await MobileDisplay.enterFullscreen(document.documentElement);
    const wakeLock = await MobileDisplay.requestWakeLock();
    MobileDisplay.hideInstallHint();
    return { fullscreen, wakeLock };
  }

  static installHintText() {
    if (MobileDisplay.isIOS()) {
      return 'Режим как в приложении: Поделиться → «На экран Домой»';
    }
    if (MobileDisplay.installPrompt) {
      return 'Режим как в приложении: установите игру или коснитесь экрана для полного экрана';
    }
    return 'Режим как в приложении: коснитесь экрана — откроется полный экран';
  }

  static ensureInstallHint() {
    if (MobileDisplay.hintEl || MobileDisplay.isStandalone()) return MobileDisplay.hintEl;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HINT_KEY) === '1') {
      return null;
    }

    MobileDisplay.hintEl = document.createElement('div');
    MobileDisplay.hintEl.className = 'mobile-install-hint';
    MobileDisplay.hintEl.innerHTML =
      '<span class="mobile-install-hint__text"></span>' +
      (MobileDisplay.installPrompt
        ? '<button type="button" class="mobile-install-hint__install">Установить</button>'
        : '') +
      '<button type="button" class="mobile-install-hint__close" aria-label="Close">×</button>';
    document.body.appendChild(MobileDisplay.hintEl);

    const text = MobileDisplay.hintEl.querySelector('.mobile-install-hint__text');
    if (text) text.textContent = MobileDisplay.installHintText();

    const closeBtn = MobileDisplay.hintEl.querySelector('.mobile-install-hint__close');
    closeBtn?.addEventListener('click', MobileDisplay.hideInstallHint);

    const installBtn = MobileDisplay.hintEl.querySelector('.mobile-install-hint__install');
    installBtn?.addEventListener('click', () => {
      MobileDisplay.promptInstall().then((ok) => {
        if (ok) MobileDisplay.hideInstallHint();
      });
    });

    return MobileDisplay.hintEl;
  }

  static showInstallHint() {
    if (!MobileControls.isActive() || MobileDisplay.isStandalone() || state.playing) return;
    MobileDisplay.ensureInstallHint();
  }

  static hideInstallHint() {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(HINT_KEY, '1');
    if (MobileDisplay.hintEl) {
      MobileDisplay.hintEl.remove();
      MobileDisplay.hintEl = null;
    }
  }

  static async promptInstall() {
    if (!MobileDisplay.installPrompt) return false;
    MobileDisplay.installPrompt.prompt();
    const result = await MobileDisplay.installPrompt.userChoice;
    MobileDisplay.installPrompt = null;
    MobileDisplay.updateInstallHintText();
    return result.outcome === 'accepted';
  }

  static updateInstallHintText() {
    if (!MobileDisplay.hintEl) return;
    const text = MobileDisplay.hintEl.querySelector('.mobile-install-hint__text');
    if (text) text.textContent = MobileDisplay.installHintText();
  }

  static onVisibilityChange() {
    if (document.hidden) return;
    if (state.playing && MobileControls.isActive()) {
      MobileDisplay.requestWakeLock();
      if (!MobileDisplay.isStandalone() && !MobileDisplay.isFullscreenActive()) {
        MobileDisplay.enterFullscreen(document.documentElement);
      }
    }
  }

  static init(_canvas) {
    if (!MobileControls.isActive()) return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      MobileDisplay.installPrompt = event;
      MobileDisplay.updateInstallHintText();
      MobileDisplay.showInstallHint();
    });

    document.addEventListener('visibilitychange', MobileDisplay.onVisibilityChange);
    MobileDisplay.showInstallHint();
    MobileDisplay.enterImmersiveMode();

    if (state.Console?.addCommand) {
      state.Console.addCommand('fullscreen', 'toggle browser fullscreen (mobile)', async function () {
        if (MobileDisplay.isFullscreenActive()) await MobileDisplay.exitFullscreen();
        else await MobileDisplay.enterFullscreen(document.documentElement);
      });
    }
  }
}
