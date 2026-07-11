import { state } from '@/core/runtime-state.js';

let overlay = null;

function el(className) {
  return overlay?.querySelector('.' + className);
}

export function ensureLoadingOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML =
    '<div class="loading-title">instagib3d</div>' +
    '<div class="loading-status">Starting...</div>' +
    '<div class="loading-track"><div class="loading-fill"></div></div>' +
    '<div class="loading-pct">0%</div>';
  document.body.appendChild(overlay);
  return overlay;
}

export function updateLoadingOverlay(progress) {
  ensureLoadingOverlay();
  const pct = progress.total > 0 ? progress.done / progress.total : 0;
  const pctText = Math.round(pct * 100) + '%';
  const status = el('loading-status');
  const fill = el('loading-fill');
  const pctEl = el('loading-pct');
  if (status) status.textContent = progress.label || 'Loading...';
  if (fill) fill.style.width = pctText;
  if (pctEl) pctEl.textContent = pctText;
}

export function hideLoadingOverlay() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
}

export function buildLoadingChecks(ctx) {
  const checks = [
    { label: 'Fonts', ready: () => ctx.textReady() },
    { label: 'Items', ready: () => state.Item?.ready?.() },
    { label: 'Weapons', ready: () => state.Weapon?.ready?.() },
    { label: 'HUD', ready: () => state.HUD?.ready?.() },
    { label: 'Models', ready: () => state.Bot?.ready?.() },
    { label: 'Effects', ready: () => state.Particle?.ready?.() },
    { label: 'Level', ready: () => ctx.gameClient?.ready?.() },
  ];
  return checks;
}

export function getLoadingProgress(checks) {
  let done = 0;
  let label = 'Ready';
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    let ok = false;
    try {
      ok = !!check.ready();
    } catch (_e) {
      ok = false;
    }
    if (ok) {
      done += 1;
    } else if (label === 'Ready') {
      label = check.label;
    }
  }
  return { done, total: checks.length, label };
}
