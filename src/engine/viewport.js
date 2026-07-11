import { state } from '@/core/runtime-state.js';

/** Effective DPR cap for render resolution (quality presets may limit this). */
export function effectiveDevicePixelRatio() {
  const raw = window.devicePixelRatio || 1;
  const cap = state.quality?.dprMax;
  if (cap == null) return raw;
  return Math.min(raw, cap);
}

/** CSS layout size — matches 100dvw × 100dvh (visualViewport when available). */
export function viewportCssSize() {
  if (typeof window === 'undefined') return { w: 800, h: 600 };
  const vv = window.visualViewport;
  return {
    w: vv?.width ?? document.documentElement.clientWidth,
    h: vv?.height ?? document.documentElement.clientHeight,
  };
}

export function resizeGameCanvas(canvas, gl) {
  const dpr = effectiveDevicePixelRatio();
  const { w, h } = viewportCssSize();
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width === pw && canvas.height === ph) return;
  canvas.width = pw;
  canvas.height = ph;
  if (gl) gl.viewport(0, 0, pw, ph);
}

export function bindViewportResize(canvas, gl) {
  const onResize = () => resizeGameCanvas(canvas, gl);
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('scroll', onResize);
  onResize();
  return () => {
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('scroll', onResize);
  };
}
