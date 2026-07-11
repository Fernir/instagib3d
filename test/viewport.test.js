import { describe, expect, it } from 'vitest';

import { shouldTrackVisualViewport } from '@/engine/viewport.js';
import { state } from '@/core/runtime-state.js';

describe('viewport', () => {
  it('tracks visual viewport when console is open on mobile', () => {
    state.mobileControls = {};
    state.Console = { show: true };
    expect(shouldTrackVisualViewport()).toBe(true);
    state.Console = { show: false };
    state.mobileControls = null;
  });

  it('does not track visual viewport on desktop', () => {
    state.mobileControls = null;
    state.Console = { show: true };
    expect(shouldTrackVisualViewport()).toBe(false);
  });
});
