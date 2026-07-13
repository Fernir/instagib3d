import { state } from '@/core/runtime-state.js';

export class LoadingOverlay {
  constructor() {
    this.el = null;
  }

  query(className) {
    return this.el?.querySelector('.' + className);
  }

  ensure() {
    if (this.el) return this.el;
    this.el = document.createElement('div');
    this.el.className = 'loading-overlay';
    this.el.innerHTML =
      '<div class="loading-title">instagib3d</div>' +
      '<div class="loading-status">Starting...</div>' +
      '<div class="loading-track"><div class="loading-fill"></div></div>' +
      '<div class="loading-pct">0%</div>';
    document.body.appendChild(this.el);
    return this.el;
  }

  update(progress) {
    this.ensure();
    const pct = progress.total > 0 ? progress.done / progress.total : 0;
    const pctText = Math.round(pct * 100) + '%';
    const status = this.query('loading-status');
    const fill = this.query('loading-fill');
    const pctEl = this.query('loading-pct');
    if (status) status.textContent = progress.label || 'Loading...';
    if (fill) fill.style.width = pctText;
    if (pctEl) pctEl.textContent = pctText;
  }

  hide() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
  }

  static buildChecks(ctx) {
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

  static getProgress(checks) {
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
}

export const loadingOverlay = new LoadingOverlay();
