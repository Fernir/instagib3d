import { state } from '@/core/runtime-state.js';

const LAYOUT_EPS = 0.5;
const BUFFER_EPS = 1;

export class Viewport {
  /** Effective DPR cap for render resolution (quality presets may limit this). */
  static effectiveDevicePixelRatio() {
    const raw = window.devicePixelRatio || 1;
    const cap = state.quality?.dprMax;
    if (cap == null) return raw;
    return Math.min(raw, cap);
  }

  static visualViewportKeyboardOpen() {
    const vv = window.visualViewport;
    if (!vv) return false;
    return vv.height < window.innerHeight * 0.82;
  }

  /** True when canvas should track visualViewport (console keyboard, IME, fullscreen crop). */
  static shouldTrackVisualViewport() {
    if (!state.mobileControls) return false;
    if (state.Console?.show) return true;
    if (typeof window === 'undefined') return false;
    const vv = window.visualViewport;
    if (!vv) return false;
    if (Viewport.visualViewportKeyboardOpen()) return true;

    const app = state.canvas?.parentElement;
    if (!app) return false;
    const appRect = app.getBoundingClientRect();
    if (Math.abs(vv.width - appRect.width) > 2 || Math.abs(vv.height - appRect.height) > 2) {
      return true;
    }
    if (Math.abs(vv.offsetLeft - appRect.left) > 1 || Math.abs(vv.offsetTop - appRect.top) > 1) {
      return true;
    }
    return false;
  }

  /**
   * Pin canvas to the visible viewport on mobile. Avoids crop in fullscreen/PWA
   * and shrinks above the software keyboard when the console is open.
   */
  static applyLayout(canvas) {
    if (!canvas || typeof window === 'undefined') return;

    const vv = window.visualViewport;
    const trackVv = Viewport.shouldTrackVisualViewport();

    if (trackVv && vv) {
      const w = Math.max(1, Math.round(vv.width));
      const h = Math.max(1, Math.round(vv.height));
      const left = Math.round(vv.offsetLeft);
      const top = Math.round(vv.offsetTop);
      canvas.style.position = 'fixed';
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      document.body.classList.add('viewport-keyboard');
      return;
    }

    document.body.classList.remove('viewport-keyboard');
    canvas.style.position = '';
    canvas.style.left = '';
    canvas.style.top = '';
    canvas.style.width = '';
    canvas.style.height = '';
  }

  /** CSS layout size — from canvas bounds after layout, else visualViewport. */
  static cssSize() {
    if (typeof window === 'undefined') return { w: 800, h: 600 };

    const canvas = state.canvas;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { w: rect.width, h: rect.height };
      }
    }

    const vv = window.visualViewport;
    return {
      w: vv?.width ?? document.documentElement.clientWidth,
      h: vv?.height ?? document.documentElement.clientHeight,
    };
  }

  static resizeCanvas(canvas, gl) {
    Viewport.applyLayout(canvas);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = Viewport.effectiveDevicePixelRatio();
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));

    const layoutChanged =
      canvas._layoutW == null ||
      Math.abs(canvas._layoutW - w) > LAYOUT_EPS ||
      Math.abs(canvas._layoutH - h) > LAYOUT_EPS;
    const bufferChanged =
      Math.abs(canvas.width - pw) > BUFFER_EPS || Math.abs(canvas.height - ph) > BUFFER_EPS;
    if (!layoutChanged && !bufferChanged) return;

    canvas._layoutW = w;
    canvas._layoutH = h;
    canvas.width = pw;
    canvas.height = ph;
    if (gl) gl.viewport(0, 0, pw, ph);
    if (bufferChanged && state.msaa) state.msaa.dispose();
    state.Console?.syncMobileInputLayout?.();
  }

  static bindResize(canvas, gl) {
    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        Viewport.resizeCanvas(canvas, gl);
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('fullscreenchange', onResize);
    document.addEventListener('webkitfullscreenchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);
    onResize();
    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('fullscreenchange', onResize);
      document.removeEventListener('webkitfullscreenchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
    };
  }
}
