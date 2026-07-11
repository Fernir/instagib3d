import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { resizeGameCanvas } from './viewport.js';

export const QUALITY_TIERS = ['high', 'medium', 'low'];

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
};

export function isMobileLikeDevice(nav = typeof navigator !== 'undefined' ? navigator : null, win) {
  if (!nav) return false;
  const w = win || (typeof window !== 'undefined' ? window : null);
  const coarse = w?.matchMedia?.('(pointer: coarse)')?.matches;
  const touch = nav.maxTouchPoints > 1;
  const ua = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(nav.userAgent || '');
  const small = w ? w.innerWidth <= 1280 : false;
  return ua || (coarse && touch) || (touch && small);
}

export function detectInitialQualityTier(nav = typeof navigator !== 'undefined' ? navigator : null, win) {
  const mobile = isMobileLikeDevice(nav, win);
  const mem = nav?.deviceMemory || 0;
  const cores = nav?.hardwareConcurrency || 4;
  if (mobile) {
    if (mem > 0 && mem <= 2) return 'low';
    return 'medium';
  }
  if (cores <= 4 || (mem > 0 && mem <= 4)) return 'medium';
  return 'high';
}

function clampShadowRes(res) {
  const gl = state.gl;
  const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096 : 4096;
  return Math.max(256, Math.min(res | 0, maxTex));
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
    maxTierIndex: initialIndex,
    auto,
    settings: null,
    fpsHistory: [],
    upgradeHold: 0,

    apply() {
      const preset = QUALITY_PRESETS[this.tier];
      this.settings = {
        ...preset,
        tier: this.tier,
        shadowRes: clampShadowRes(preset.shadowRes),
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
      if (opts.raiseCap) this.maxTierIndex = Math.max(this.maxTierIndex, idx);
      this.apply();
      Console.info('Quality: ' + name);
    },

    setAuto(enabled) {
      this.auto = !!enabled;
      Console.info('Quality auto: ' + (this.auto ? 'on' : 'off'));
    },

    tick(fps) {
      if (!this.auto || !fps) return;
      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > 3) this.fpsHistory.shift();
      if (this.fpsHistory.length < 3) return;

      const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
      if (avg < 26 && this.tierIndex > 0) {
        this.tierIndex -= 1;
        this.tier = QUALITY_TIERS[this.tierIndex];
        this.fpsHistory = [];
        this.upgradeHold = 0;
        this.apply();
        Console.info('Quality lowered to ' + this.tier + ' (' + Math.round(avg) + ' fps)');
        return;
      }
      if (avg > 54 && this.tierIndex < this.maxTierIndex) {
        this.upgradeHold += 1;
        if (this.upgradeHold >= 4) {
          this.tierIndex += 1;
          this.tier = QUALITY_TIERS[this.tierIndex];
          this.fpsHistory = [];
          this.upgradeHold = 0;
          this.apply();
          Console.info('Quality raised to ' + this.tier);
        }
        return;
      }
      this.upgradeHold = 0;
    },
  };

  mgr.apply();
  state.qualityMgr = mgr;

  if (state.Console?.addCommand) {
    state.Console.addCommand('quality', 'quality [high|medium|low|auto]', function (arg) {
      if (!arg) {
        Console.info('Quality: ' + mgr.tier + (mgr.auto ? ' (auto)' : ''));
        return;
      }
      const v = String(arg).toLowerCase();
      if (v === 'auto') {
        mgr.setAuto(true);
        return;
      }
      if (QUALITY_PRESETS[v]) {
        mgr.setAuto(false);
        mgr.setTier(v, { raiseCap: true });
      }
    });
  }

  Console.info('Quality: ' + mgr.tier + (mgr.auto ? ' (auto)' : ''));
  return mgr;
}
