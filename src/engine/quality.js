import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { Viewport } from './viewport.js';

export class QualityManager {
  static TARGET_FPS = 60;
  static RESTORE_FPS = 80;
  static RESTORE_SAMPLES = 4;
  static QUALITY_TIERS = ['high', 'medium', 'low', 'minimal', 'potato'];
  static MIN_DPR_SCALE = 0.32;
  static DPR_DOWNGRADE_STEP = 0.12;
  static MAX_QUALITY_STEPS_PER_TICK = 1;
  static PREVIEW_WARMUP_MS = 4000;

  static PRESETS = {
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

  static STABILIZE_AFTER_DOWNGRADE_MS = 3000;
  static STABILIZE_SEVERE_MS = 1800;
  static STABILIZE_AFTER_UPGRADE_MS = 8000;

  static isMobileLikeDevice(nav = typeof navigator !== 'undefined' ? navigator : null, win) {
    if (!nav) return false;
    const w = win || (typeof window !== 'undefined' ? window : null);
    const coarse = w?.matchMedia?.('(pointer: coarse)')?.matches;
    const touch = nav.maxTouchPoints > 1;
    const ua = nav.userAgent || '';
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
    const small = w ? w.innerWidth <= 1280 : false;
    return mobileUa || (coarse && touch) || (touch && small);
  }

  static isAndroidDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
    return /Android/i.test(nav?.userAgent || '');
  }

  static detectInitialQualityTier(nav = typeof navigator !== 'undefined' ? navigator : null, win) {
    const mobile = QualityManager.isMobileLikeDevice(nav, win);
    const mem = nav?.deviceMemory || 0;
    const cores = nav?.hardwareConcurrency || 4;
    const w = win || (typeof window !== 'undefined' ? window : null);
    const wide = w ? w.innerWidth >= 1024 : false;

    if (QualityManager.isAndroidDevice(nav)) {
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

  static clampShadowRes(res) {
    if (!res) return 0;
    const gl = state.gl;
    const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096 : 4096;
    return Math.max(256, Math.min(res | 0, maxTex));
  }

  static canMonitorQualityFps(previewReadyAt, nowMs = Date.now()) {
    if (!previewReadyAt) return false;
    return nowMs - previewReadyAt >= QualityManager.PREVIEW_WARMUP_MS;
  }

  static shouldRestoreQuality(avgFps, restoreFps = QualityManager.RESTORE_FPS) {
    return avgFps >= restoreFps;
  }

  static canDowngradeQuality(tierIndex, dprScale) {
    return tierIndex > 0 || dprScale > QualityManager.MIN_DPR_SCALE;
  }

  static shouldStopQualityDowngrade(avgFps, targetFps = QualityManager.TARGET_FPS) {
    return avgFps >= targetFps;
  }

  static downgradeStepsForFps(avgFps) {
    if (avgFps < 30) return 3;
    if (avgFps < 40) return 2;
    return 1;
  }

  static effectiveDowngradeSteps(avgFps) {
    return Math.min(QualityManager.MAX_QUALITY_STEPS_PER_TICK, QualityManager.downgradeStepsForFps(avgFps));
  }

  static samplesNeededForDowngrade(avgFps) {
    return avgFps < 45 ? 1 : 2;
  }

  static stabilizeMsForFps(avgFps) {
    return avgFps < 45 ? QualityManager.STABILIZE_SEVERE_MS : QualityManager.STABILIZE_AFTER_DOWNGRADE_MS;
  }

  constructor(userOptions = {}) {
    const forced = userOptions.quality;
    const auto = userOptions.qualityAuto !== false && !forced;
    const initial =
      forced && QualityManager.PRESETS[forced]
        ? forced
        : QualityManager.detectInitialQualityTier();
    const initialIndex = Math.max(0, QualityManager.QUALITY_TIERS.indexOf(initial));

    this.tier = QualityManager.QUALITY_TIERS[initialIndex];
    this.tierIndex = initialIndex;
    this.initialTier = QualityManager.QUALITY_TIERS[initialIndex];
    this.initialTierIndex = initialIndex;
    this.auto = auto;
    this.settings = null;
    this.fpsHistory = [];
    this.downgradeHold = 0;
    this.upgradeHold = 0;
    this.dprScale = 1;
    this.lastAutoDowngradeMs = 0;
    this.lastAutoUpgradeMs = 0;
    this.lastAvgFps = 0;
    this.previewReadyAt = 0;
  }

  markPreviewReady() {
    if (this.previewReadyAt) return;
    this.previewReadyAt = Date.now();
    this.fpsHistory = [];
    this.downgradeHold = 0;
  }

  apply() {
    const preset = QualityManager.PRESETS[this.tier];
    const dprMax = Math.max(QualityManager.MIN_DPR_SCALE, preset.dprMax * this.dprScale);
    this.settings = {
      ...preset,
      tier: this.tier,
      dprMax,
      shadowRes: preset.shadows ? QualityManager.clampShadowRes(preset.shadowRes) : 0,
    };
    state.quality = this.settings;
    if (state.canvas) Viewport.resizeCanvas(state.canvas, state.gl);
    if (state.msaa) state.msaa.dispose();
    if (state.LevelRender?.applyQuality) state.LevelRender.applyQuality(this.settings);
  }

  setTier(name, opts = {}) {
    const idx = QualityManager.QUALITY_TIERS.indexOf(name);
    if (idx < 0) return;
    this.tier = name;
    this.tierIndex = idx;
    if (opts.resetDpr !== false) this.dprScale = 1;
    this.apply();
    Console.info('Quality: ' + name);
  }

  setAuto(enabled) {
    this.auto = !!enabled;
    Console.info('Quality auto: ' + (this.auto ? 'on' : 'off'));
  }

  tryRestoreQuality(avg) {
    const now = Date.now();
    if (now - this.lastAutoUpgradeMs < QualityManager.STABILIZE_AFTER_UPGRADE_MS) return false;
    if (now - this.lastAutoDowngradeMs < QualityManager.STABILIZE_AFTER_UPGRADE_MS) return false;

    if (this.tierIndex < this.initialTierIndex) {
      this.upgradeHold += 1;
      if (this.upgradeHold < QualityManager.RESTORE_SAMPLES) return false;
      this.tierIndex += 1;
      this.tier = QualityManager.QUALITY_TIERS[this.tierIndex];
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
      if (this.upgradeHold < QualityManager.RESTORE_SAMPLES) return false;
      this.dprScale = Math.min(1, this.dprScale + QualityManager.DPR_DOWNGRADE_STEP);
      this.upgradeHold = 0;
      this.fpsHistory = [];
      this.downgradeHold = 0;
      this.lastAutoUpgradeMs = now;
      this.apply();
      Console.info(
        'Quality DPR restored to ×' + this.dprScale.toFixed(2) + ' — ' + Math.round(avg) + ' fps',
      );
      return true;
    }

    this.upgradeHold = 0;
    return false;
  }

  tick(fps) {
    if (!this.auto || !fps) return;
    if (!QualityManager.canMonitorQualityFps(this.previewReadyAt)) return;

    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 3) this.fpsHistory.shift();
    if (this.fpsHistory.length < 2) return;

    const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    this.lastAvgFps = avg;

    if (QualityManager.shouldRestoreQuality(avg)) {
      this.downgradeHold = 0;
      if (this.tryRestoreQuality(avg)) return;
      return;
    }

    this.upgradeHold = 0;

    if (QualityManager.shouldStopQualityDowngrade(avg)) {
      this.downgradeHold = 0;
      return;
    }

    if (Date.now() - this.lastAutoDowngradeMs < QualityManager.stabilizeMsForFps(avg)) return;

    this.downgradeHold += 1;
    if (this.downgradeHold < QualityManager.samplesNeededForDowngrade(avg)) return;

    if (!QualityManager.canDowngradeQuality(this.tierIndex, this.dprScale)) {
      this.downgradeHold = 0;
      return;
    }

    let steps = QualityManager.effectiveDowngradeSteps(avg);
    while (steps > 0 && QualityManager.canDowngradeQuality(this.tierIndex, this.dprScale)) {
      if (this.tierIndex > 0) {
        this.tierIndex -= 1;
        this.tier = QualityManager.QUALITY_TIERS[this.tierIndex];
        this.dprScale = 1;
      } else {
        this.dprScale = Math.max(QualityManager.MIN_DPR_SCALE, this.dprScale - QualityManager.DPR_DOWNGRADE_STEP);
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
        QualityManager.TARGET_FPS,
    );
  }
}

export function initQuality(userOptions = {}) {
  const mgr = new QualityManager(userOptions);
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
              (mgr.auto
                ? ' (auto, cap ' + mgr.initialTier + ', target ' + QualityManager.TARGET_FPS + ' fps)'
                : '') +
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
        if (QualityManager.PRESETS[v]) {
          mgr.setAuto(false);
          mgr.setTier(v);
        }
      },
    );
  }

  Console.info('Quality: ' + mgr.tier + (mgr.auto ? ' (auto, cap ' + mgr.initialTier + ')' : ''));
  return mgr;
}

// Named exports for tests and external callers.
export const TARGET_FPS = QualityManager.TARGET_FPS;
export const RESTORE_FPS = QualityManager.RESTORE_FPS;
export const RESTORE_SAMPLES = QualityManager.RESTORE_SAMPLES;
export const QUALITY_TIERS = QualityManager.QUALITY_TIERS;
export const QUALITY_PRESETS = QualityManager.PRESETS;
export const MIN_DPR_SCALE = QualityManager.MIN_DPR_SCALE;
export const DPR_DOWNGRADE_STEP = QualityManager.DPR_DOWNGRADE_STEP;
export const MAX_QUALITY_STEPS_PER_TICK = QualityManager.MAX_QUALITY_STEPS_PER_TICK;
export const PREVIEW_WARMUP_MS = QualityManager.PREVIEW_WARMUP_MS;
export const isMobileLikeDevice = QualityManager.isMobileLikeDevice.bind(QualityManager);
export const isAndroidDevice = QualityManager.isAndroidDevice.bind(QualityManager);
export const detectInitialQualityTier = QualityManager.detectInitialQualityTier.bind(QualityManager);
export const canMonitorQualityFps = QualityManager.canMonitorQualityFps.bind(QualityManager);
export const shouldRestoreQuality = QualityManager.shouldRestoreQuality.bind(QualityManager);
export const canDowngradeQuality = QualityManager.canDowngradeQuality.bind(QualityManager);
export const shouldStopQualityDowngrade = QualityManager.shouldStopQualityDowngrade.bind(QualityManager);
export const downgradeStepsForFps = QualityManager.downgradeStepsForFps.bind(QualityManager);
export const effectiveDowngradeSteps = QualityManager.effectiveDowngradeSteps.bind(QualityManager);
export const samplesNeededForDowngrade = QualityManager.samplesNeededForDowngrade.bind(QualityManager);
