import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { resizeGameCanvas } from './viewport.js';

export const TARGET_FPS = 60;
export const QUALITY_TIERS = ['high', 'medium', 'low', 'minimal'];

export const QUALITY_PRESETS = {
  high: {
    dprMax: 2,
    msaaSamples: 4,
    shadowRes: 2048,
    shadows: true,
    fog: true,
    fogSlices: 8,
    depthPrepass: true,
    visMapInterval: 4,
    fogResShift: 2,
  },
  medium: {
    dprMax: 1.25,
    msaaSamples: 0,
    shadowRes: 1024,
    shadows: true,
    fog: true,
    fogSlices: 4,
    depthPrepass: true,
    visMapInterval: 8,
    fogResShift: 2,
  },
  low: {
    dprMax: 1,
    msaaSamples: 0,
    shadowRes: 512,
    shadows: true,
    fog: false,
    fogSlices: 0,
    depthPrepass: false,
    visMapInterval: 12,
    fogResShift: 3,
  },
  minimal: {
    dprMax: 0.85,
    msaaSamples: 0,
    shadowRes: 256,
    shadows: false,
    fog: false,
    fogSlices: 0,
    depthPrepass: false,
    visMapInterval: 20,
    fogResShift: 3,
  },
};

export function isMobileLikeDevice(nav = typeof navigator !== 'undefined' ? navigator : null, win) {
  if (!nav) return false;
  const w = win || (typeof window !== 'undefined' ? window : null);
  const coarse = w?.matchMedia?.('(pointer: coarse)')?.matches;
  const touch = nav.maxTouchPoints > 1;
  const ua = nav.userAgent || '';
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
  const small = w ? w.innerWidth <= 1280 : false;
  return mobileUa || (coarse && touch) || (touch && small);
}

export function isAndroidDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
  return /Android/i.test(nav?.userAgent || '');
}

export function detectInitialQualityTier(nav = typeof navigator !== 'undefined' ? navigator : null, win) {
  const mobile = isMobileLikeDevice(nav, win);
  const mem = nav?.deviceMemory || 0;
  const cores = nav?.hardwareConcurrency || 4;
  if (isAndroidDevice(nav)) return 'low';
  if (mobile) {
    if (mem > 0 && mem <= 2) return 'minimal';
    return 'low';
  }
  if (cores <= 4 || (mem > 0 && mem <= 4)) return 'medium';
  return 'high';
}

function clampShadowRes(res) {
  if (!res) return 0;
  const gl = state.gl;
  const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096 : 4096;
  return Math.max(256, Math.min(res | 0, maxTex));
}

const STABILIZE_AFTER_DOWNGRADE_MS = 3500;

export function canDowngradeQuality(tierIndex, dprScale) {
  return tierIndex > 0 || dprScale > 0.55;
}

export function shouldStopQualityDowngrade(avgFps, targetFps = TARGET_FPS) {
  return avgFps >= targetFps;
}

export function initQuality(userOptions = {}) {
  const forced = userOptions.quality;
  const auto = userOptions.qualityAuto !== false && !forced;
  const initial =
    forced && QUALITY_PRESETS[forced] ? forced : detectInitialQualityTier();
  const initialIndex = Math.max(0, QUALITY_TIERS.indexOf(initial));

  const mgr = {
    tier: QUALITY_TIERS[initialIndex],
    tierIndex: initialIndex,
    auto,
    settings: null,
    fpsHistory: [],
    downgradeHold: 0,
    dprScale: 1,
    lastAutoDowngradeMs: 0,

    apply() {
      const preset = QUALITY_PRESETS[this.tier];
      const dprMax = Math.max(0.5, preset.dprMax * this.dprScale);
      this.settings = {
        ...preset,
        tier: this.tier,
        dprMax,
        shadowRes: preset.shadows ? clampShadowRes(preset.shadowRes) : 0,
      };
      state.quality = this.settings;
      if (state.canvas) resizeGameCanvas(state.canvas, state.gl);
      if (state.msaa) state.msaa.dispose();
      if (state.LevelRender?.applyQuality) state.LevelRender.applyQuality(this.settings);
    },

    setTier(name, opts = {}) {
      const idx = QUALITY_TIERS.indexOf(name);
      if (idx < 0) return;
      this.tier = name;
      this.tierIndex = idx;
      if (opts.resetDpr !== false) this.dprScale = 1;
      this.apply();
      Console.info('Quality: ' + name);
    },

    setAuto(enabled) {
      this.auto = !!enabled;
      Console.info('Quality auto: ' + (this.auto ? 'on (downgrade only)' : 'off'));
    },

    tick(fps) {
      if (!this.auto || !fps) return;
      if (Date.now() - this.lastAutoDowngradeMs < STABILIZE_AFTER_DOWNGRADE_MS) return;

      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > 3) this.fpsHistory.shift();
      if (this.fpsHistory.length < 2) return;

      const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
      if (shouldStopQualityDowngrade(avg)) {
        this.downgradeHold = 0;
        return;
      }

      this.downgradeHold += 1;
      if (this.downgradeHold < 2) return;

      if (!canDowngradeQuality(this.tierIndex, this.dprScale)) {
        this.downgradeHold = 0;
        return;
      }

      if (this.tierIndex > 0) {
        this.tierIndex -= 1;
        this.tier = QUALITY_TIERS[this.tierIndex];
        this.dprScale = 1;
      } else {
        this.dprScale = Math.max(0.55, this.dprScale - 0.08);
      }

      this.fpsHistory = [];
      this.downgradeHold = 0;
      this.lastAutoDowngradeMs = Date.now();
      this.apply();
      Console.info(
        'Quality lowered to ' +
          this.tier +
          (this.dprScale < 1 ? ' (dpr×' + this.dprScale.toFixed(2) + ')' : '') +
          ' — ' +
          Math.round(avg) +
          ' fps, target ' +
          TARGET_FPS,
      );
    },
  };

  mgr.apply();
  state.qualityMgr = mgr;

  if (state.Console?.addCommand) {
    state.Console.addCommand('quality', 'quality [high|medium|low|minimal|auto]', function (arg) {
      if (!arg) {
        Console.info(
          'Quality: ' +
            mgr.tier +
            (mgr.auto ? ' (auto downgrade, target ' + TARGET_FPS + ' fps)' : '') +
            ', dpr=' +
            mgr.settings.dprMax.toFixed(2),
        );
        return;
      }
      const v = String(arg).toLowerCase();
      if (v === 'auto') {
        mgr.setAuto(true);
        return;
      }
      if (QUALITY_PRESETS[v]) {
        mgr.setAuto(false);
        mgr.setTier(v);
      }
    });
  }

  Console.info('Quality: ' + mgr.tier + (mgr.auto ? ' (auto downgrade)' : ''));
  return mgr;
}
