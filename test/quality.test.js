import { describe, expect, it } from 'vitest';

import {
  DPR_DOWNGRADE_STEP,
  MIN_DPR_SCALE,
  PREVIEW_WARMUP_MS,
  QUALITY_TIERS,
  RESTORE_FPS,
  TARGET_FPS,
  canDowngradeQuality,
  canMonitorQualityFps,
  detectInitialQualityTier,
  downgradeStepsForFps,
  effectiveDowngradeSteps,
  MAX_QUALITY_STEPS_PER_TICK,
  isAndroidDevice,
  isMobileLikeDevice,
  samplesNeededForDowngrade,
  shouldRestoreQuality,
  shouldStopQualityDowngrade,
} from '@/engine/quality.js';

describe('quality', () => {
  it('detects powerful Android tablets as medium tier', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36',
      maxTouchPoints: 5,
      deviceMemory: 8,
      hardwareConcurrency: 8,
    };
    expect(isAndroidDevice(nav)).toBe(true);
    expect(detectInitialQualityTier(nav, { innerWidth: 1280 })).toBe('medium');
  });

  it('detects iPad as low tier', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
      deviceMemory: 4,
      hardwareConcurrency: 8,
    };
    expect(isMobileLikeDevice(nav, { innerWidth: 1024, matchMedia: () => ({ matches: true }) })).toBe(
      true,
    );
    expect(detectInitialQualityTier(nav, { innerWidth: 1024 })).toBe('medium');
  });

  it('starts desktop on high tier', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
      maxTouchPoints: 0,
      deviceMemory: 8,
      hardwareConcurrency: 8,
    };
    expect(detectInitialQualityTier(nav, { innerWidth: 1920 })).toBe('high');
  });

  it('uses minimal tier for very weak mobile memory', () => {
    const nav = {
      userAgent: 'iPhone',
      maxTouchPoints: 5,
      deviceMemory: 2,
      hardwareConcurrency: 4,
    };
    expect(detectInitialQualityTier(nav, { innerWidth: 390 })).toBe('minimal');
  });

  it('targets 60 fps and exposes ordered tiers including potato', () => {
    expect(TARGET_FPS).toBe(60);
    expect(QUALITY_TIERS).toEqual(['high', 'medium', 'low', 'minimal', 'potato']);
    expect(MIN_DPR_SCALE).toBeLessThan(0.4);
    expect(DPR_DOWNGRADE_STEP).toBeGreaterThan(0.1);
  });

  it('keeps downgrading until fps reaches target', () => {
    expect(shouldStopQualityDowngrade(59)).toBe(false);
    expect(shouldStopQualityDowngrade(60)).toBe(true);
    expect(shouldRestoreQuality(79)).toBe(false);
    expect(shouldRestoreQuality(RESTORE_FPS)).toBe(true);
    expect(canDowngradeQuality(2, 1)).toBe(true);
    expect(canDowngradeQuality(0, MIN_DPR_SCALE)).toBe(false);
  });

  it('reacts faster to severe fps drops', () => {
    expect(samplesNeededForDowngrade(44)).toBe(1);
    expect(samplesNeededForDowngrade(50)).toBe(2);
    expect(downgradeStepsForFps(28)).toBe(3);
    expect(downgradeStepsForFps(35)).toBe(2);
    expect(downgradeStepsForFps(52)).toBe(1);
    expect(MAX_QUALITY_STEPS_PER_TICK).toBe(1);
    expect(effectiveDowngradeSteps(28)).toBe(1);
    expect(effectiveDowngradeSteps(52)).toBe(1);
  });

  it('waits for preview warmup before monitoring fps', () => {
    expect(PREVIEW_WARMUP_MS).toBeGreaterThan(0);
    expect(canMonitorQualityFps(0)).toBe(false);
    expect(canMonitorQualityFps(1000, 1000)).toBe(false);
    expect(canMonitorQualityFps(1000, 1000 + PREVIEW_WARMUP_MS)).toBe(true);
  });
});
