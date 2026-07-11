import { describe, expect, it } from 'vitest';

import {
  QUALITY_TIERS,
  TARGET_FPS,
  detectInitialQualityTier,
  isAndroidDevice,
  isMobileLikeDevice,
} from '@/engine/quality.js';

describe('quality', () => {
  it('detects Android tablets as low tier', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36',
      maxTouchPoints: 5,
      deviceMemory: 8,
      hardwareConcurrency: 8,
    };
    expect(isAndroidDevice(nav)).toBe(true);
    expect(detectInitialQualityTier(nav, { innerWidth: 1280 })).toBe('low');
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
    expect(detectInitialQualityTier(nav, { innerWidth: 1024 })).toBe('low');
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

  it('targets 60 fps and exposes ordered tiers', () => {
    expect(TARGET_FPS).toBe(60);
    expect(QUALITY_TIERS).toEqual(['high', 'medium', 'low', 'minimal']);
  });
});
