import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { resizeGameCanvas } from './viewport.js';

export const TARGET_FPS = 60;
/** FPS headroom before stepping quality back toward the initial tier. */
export const RESTORE_FPS = 80;
export const RESTORE_SAMPLES = 4;
export const QUALITY_TIERS = ['high', 'medium', 'low', 'minimal', 'potato'];

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
    particles: true,
    q2fx: true,
    decals: true,
    maxDynLights: 8,
  },
  medium: {
    dprMax: 1.15,
    msaaSamples: 0,
    shadowRes: 1024,
    shadows: true,
    fog: true,
    fogSlices: 4,
    depthPrepass: true,
    visMapInterval: 8,
    fogResShift: 2,
    particles: true,
    q2fx: true,
    decals: true,
    maxDynLights: 6,
  },
  low: {
    dprMax: 0.9,
    msaaSamples: 0,
    shadowRes: 512,
    shadows: true,
    fog: false,
    fogSlices: 0,
    depthPrepass: false,
    visMapInterval: 14,
    fogResShift: 3,
    particles: true,
    q2fx: false,
    decals: true,
    maxDynLights: 4,
  },
  minimal: {
    dprMax: 0.72,
    msaaSamples: 0,
    shadowRes: 256,
    shadows: false,
    fog: false,
    fogSlices: 0,
    depthPrepass: false,
    visMapInterval: 24,
    fogResShift: 4,
    particles: false,
    q2fx: false,
    decals: false,
    maxDynLights: 3,
  },
  potato: {
    dprMax: 0.55,
    msaaSamples: 0,
    shadowRes: 0,
    shadows: false,
    fog: false,
    fogSlices: 0,
    depthPrepass: false,
    visMapInterval: 48,
    fogResShift: 4,
    particles: false,
    q2fx: false,
    decals: false,
    maxDynLights: 1,
  },
};

export const MIN_DPR_SCALE = 0.32;
export const DPR_DOWNGRADE_STEP = 0.12;

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
  const w = win || (typeof window !== 'undefined' ? window : null);
  const wide = w ? w.innerWidth >= 1024 : false;

  if (isAndroidDevice(nav)) {
    if (mem > 0 && mem <= 3) return 'minimal';
    if (wide && ((mem >= 6) || (mem === 0 && cores >= 8))) return 'medium';
    if (mem >= 4 && cores >= 6) return 'medium';
    return 'low';
  }
  if (mobile) {
    if (mem > 0 && mem <= 2) return 'minimal';
    if (wide && mem >= 4) return 'medium';
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

const STABILIZE_AFTER_DOWNGRADE_MS = 3000;
const STABILIZE_SEVERE_MS = 1800;
const STABILIZE_AFTER_UPGRADE_MS = 5000;

/** Grace period after preview overlay before FPS-based downgrades begin. */
export const PREVIEW_WARMUP_MS = 4000;

export function canMonitorQualityFps(previewReadyAt, nowMs = Date.now()) {
  if (!previewReadyAt) return false;
  return nowMs - previewReadyAt >= PREVIEW_WARMUP_MS;
}

export function shouldRestoreQuality(avgFps, restoreFps = RESTORE_FPS) {
  return avgFps >= restoreFps;
}

export function canDowngradeQuality(tierIndex, dprScale) {
  return tierIndex > 0 || dprScale > MIN_DPR_SCALE;
}

export function shouldStopQualityDowngrade(avgFps, targetFps = TARGET_FPS) {
  return avgFps >= targetFps;
}

export function downgradeStepsForFps(avgFps) {
  if (avgFps < 30) return 3;
  if (avgFps < 40) return 2;
  return 1;
}

export function samplesNeededForDowngrade(avgFps) {
  return avgFps < 45 ? 1 : 2;
}

export function stabilizeMsForFps(avgFps) {
  return avgFps < 45 ? STABILIZE_SEVERE_MS : STABILIZE_AFTER_DOWNGRADE_MS;
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
    initialTier: QUALITY_TIERS[initialIndex],
    initialTierIndex: initialIndex,
    auto,
    settings: null,
    fpsHistory: [],
    downgradeHold: 0,
    upgradeHold: 0,
    dprScale: 1,
    lastAutoDowngradeMs: 0,
    lastAutoUpgradeMs: 0,
    lastAvgFps: 0,
    previewReadyAt: 0,

    markPreviewReady() {
      if (this.previewReadyAt) return;
      this.previewReadyAt = Date.now();
      this.fpsHistory = [];
      this.downgradeHold = 0;
    },

    apply() {
      const preset = QUALITY_PRESETS[this.tier];
      const dprMax = Math.max(MIN_DPR_SCALE, preset.dprMax * this.dprScale);
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
      Console.info('Quality auto: ' + (this.auto ? 'on' : 'off'));
    },

    tryRestoreQuality(avg) {
      const now = Date.now();
      if (now - this.lastAutoUpgradeMs < STABILIZE_AFTER_UPGRADE_MS) return false;
      if (now - this.lastAutoDowngradeMs < STABILIZE_AFTER_UPGRADE_MS) return false;

      if (this.tierIndex < this.initialTierIndex) {
        this.upgradeHold += 1;
        if (this.upgradeHold < RESTORE_SAMPLES) return false;
        this.tierIndex += 1;
        this.tier = QUALITY_TIERS[this.tierIndex];
        this.dprScale = 1;
        this.upgradeHold = 0;
        this.fpsHistory = [];
        this.downgradeHold = 0;
        this.lastAutoUpgradeMs = now;
        this.apply();
        Console.info(
          'Quality restored to ' +
            this.tier +
            ' — ' +
            Math.round(avg) +
            ' fps (cap ' +
            this.initialTier +
            ')',
        );
        return true;
      }

      if (this.dprScale < 1) {
        this.upgradeHold += 1;
        if (this.upgradeHold < RESTORE_SAMPLES) return false;
        this.dprScale = Math.min(1, this.dprScale + DPR_DOWNGRADE_STEP);
        this.upgradeHold = 0;
        this.fpsHistory = [];
        this.downgradeHold = 0;
        this.lastAutoUpgradeMs = now;
        this.apply();
        Console.info(
          'Quality DPR restored to ×' +
            this.dprScale.toFixed(2) +
            ' — ' +
            Math.round(avg) +
            ' fps',
        );
        return true;
      }

      this.upgradeHold = 0;
      return false;
    },

    tick(fps) {
      if (!this.auto || !fps) return;
      if (!canMonitorQualityFps(this.previewReadyAt)) return;

      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > 3) this.fpsHistory.shift();
      if (this.fpsHistory.length < 2) return;

      const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
      this.lastAvgFps = avg;

      if (shouldRestoreQuality(avg)) {
        this.downgradeHold = 0;
        if (this.tryRestoreQuality(avg)) return;
        return;
      }

      this.upgradeHold = 0;

      if (shouldStopQualityDowngrade(avg)) {
        this.downgradeHold = 0;
        return;
      }

      if (Date.now() - this.lastAutoDowngradeMs < stabilizeMsForFps(avg)) return;

      this.downgradeHold += 1;
      if (this.downgradeHold < samplesNeededForDowngrade(avg)) return;

      if (!canDowngradeQuality(this.tierIndex, this.dprScale)) {
        this.downgradeHold = 0;
        return;
      }

      let steps = downgradeStepsForFps(avg);
      while (steps > 0 && canDowngradeQuality(this.tierIndex, this.dprScale)) {
        if (this.tierIndex > 0) {
          this.tierIndex -= 1;
          this.tier = QUALITY_TIERS[this.tierIndex];
          this.dprScale = 1;
        } else {
          this.dprScale = Math.max(MIN_DPR_SCALE, this.dprScale - DPR_DOWNGRADE_STEP);
        }
        steps -= 1;
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
    state.Console.addCommand(
      'quality',
      'quality [high|medium|low|minimal|potato|auto]',
      function (arg) {
        if (!arg) {
          Console.info(
            'Quality: ' +
              mgr.tier +
              (mgr.auto ? ' (auto, cap ' + mgr.initialTier + ', target ' + TARGET_FPS + ' fps)' : '') +
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
      },
    );
  }

  Console.info(
    'Quality: ' +
      mgr.tier +
      (mgr.auto ? ' (auto, cap ' + mgr.initialTier + ')' : ''),
  );
  return mgr;
}
