import { describe, expect, it } from 'vitest';

import { MobileDisplay } from '@/engine/fullscreen.js';

describe('fullscreen', () => {
  it('detects iOS user agents', () => {
    expect(MobileDisplay.isIOS({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(true);
    expect(MobileDisplay.isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 13)' })).toBe(false);
  });

  it('detects standalone display mode', () => {
    const win = {
      navigator: { standalone: true },
      matchMedia: () => ({ matches: false }),
    };
    expect(MobileDisplay.isStandalone(win)).toBe(true);
  });

  it('reports fullscreen capability from DOM APIs', () => {
    const doc = {
      documentElement: {
        requestFullscreen: () => {},
      },
    };
    expect(MobileDisplay.canRequestElementFullscreen(doc)).toBe(true);
  });
});
