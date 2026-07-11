import { describe, expect, it } from 'vitest';

import {
  QUALITY_TIERS,
  detectInitialQualityTier,
  isMobileLikeDevice,
} from '@/engine/quality.js';

describe('quality', () => {
  it('detects mobile-like tablets as medium or low', () => {
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

  it('lowers tier for weak mobile memory', () => {
    const nav = {
      userAgent: 'Android',
      maxTouchPoints: 5,
      deviceMemory: 2,
      hardwareConcurrency: 4,
    };
    expect(detectInitialQualityTier(nav, { innerWidth: 800 })).toBe('low');
  });

  it('exports ordered tiers', () => {
    expect(QUALITY_TIERS).toEqual(['high', 'medium', 'low']);
  });
});
