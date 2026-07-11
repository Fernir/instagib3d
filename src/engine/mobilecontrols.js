import { state } from '@/core/runtime-state.js';

import {
  clientToNdc,
  hitConsoleToggleZone,
  hitMinimapZone,
  hitPlayButton,
  minimapCenter,
} from './minimap-layout.js';
import { viewportCssSize } from './viewport.js';

const JOY_FADE_SPEED = 9;
const LOOK_SENS_X = 2.4;
const LOOK_SENS_Y = 2.4;
const TAP_THRESHOLD = 14;
const SHOOT_PULSE_MS = 80;

let lastJoyTickMs = 0;

export function isMobileControls() {
  if (state.forceMobileControls != null) return !!state.forceMobileControls;
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && viewportCssSize().w < 1200);
}

function updateJoystick(touch, canvas) {
  const mc = state.mobileControls;
  if (!mc) return;
  const aspect = canvas.width / canvas.height;
  const c = minimapCenter(aspect);
  const ndc = clientToNdc(touch.clientX, touch.clientY, canvas);
  let dx = (ndc.x - c.x) / c.radiusX;
  let dy = (ndc.y - c.y) / c.radiusY;
  const len = Math.hypot(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }
  mc.joyX = dx;
  mc.joyY = dy;
  mc.joyFingerX = (ndc.x - c.x) / c.radiusX;
  mc.joyFingerY = (ndc.y - c.y) / c.radiusY;
  let tx = mc.joyFingerX;
  let ty = mc.joyFingerY;
  const thumbLen = Math.hypot(tx, ty);
  if (thumbLen > 1) {
    tx /= thumbLen;
    ty /= thumbLen;
  }
  mc.joyThumbX = tx;
  mc.joyThumbY = ty;
}

function tryStartGame(clientX, clientY, canvas) {
  if (!hitPlayButton(clientX, clientY, canvas)) return false;
  const gc = state.gameClient;
  if (!gc || !gc.handlePlayClick) return false;
  state.unlockAudio?.();
  state.startAssetLoads?.();
  return gc.handlePlayClick();
}

export function initMobileControls(canvas) {
  if (!isMobileControls()) return;
  state.mobileControls = {
    joyX: 0,
    joyY: 0,
    joyFingerX: 0,
    joyFingerY: 0,
    joyThumbX: 0,
    joyThumbY: 0,
    joyFade: 0,
    joyTouchId: null,
    lookTouchId: null,
    lookStartX: 0,
    lookStartY: 0,
    lookLastX: 0,
    lookLastY: 0,
    lookMoved: false,
    shootPulseUntil: 0,
    overlayTouchId: null,
    consoleTouchId: null,
  };

  const mc = state.mobileControls;
  const Console = state.Console;

  function onTouchStart(e) {
    state.startAssetLoads?.();
    state.unlockAudio?.();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (hitConsoleToggleZone(t.clientX, t.clientY, canvas)) {
        mc.consoleTouchId = t.identifier;
        e.preventDefault();
        continue;
      }

      if (!state.playing) {
        if (mc.overlayTouchId == null) mc.overlayTouchId = t.identifier;
        const ndc = clientToNdc(t.clientX, t.clientY, canvas);
        state.overlayMouse = { x: ndc.x, y: ndc.y };
        e.preventDefault();
        continue;
      }

      if (Console?.show) {
        Console.focusMobileInput?.();
        e.preventDefault();
        continue;
      }

      if (hitMinimapZone(t.clientX, t.clientY, canvas)) {
        mc.joyTouchId = t.identifier;
        updateJoystick(t, canvas);
      } else if (mc.lookTouchId == null) {
        mc.lookTouchId = t.identifier;
        mc.lookStartX = t.clientX;
        mc.lookStartY = t.clientY;
        mc.lookLastX = t.clientX;
        mc.lookLastY = t.clientY;
        mc.lookMoved = false;
      }
    }
    e.preventDefault();
  }

  function onTouchMove(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (t.identifier === mc.overlayTouchId && !state.playing) {
        const ndc = clientToNdc(t.clientX, t.clientY, canvas);
        state.overlayMouse = { x: ndc.x, y: ndc.y };
        continue;
      }

      if (!state.playing || Console?.show) continue;

      if (t.identifier === mc.joyTouchId) {
        updateJoystick(t, canvas);
      } else if (t.identifier === mc.lookTouchId) {
        if (
          Math.abs(t.clientX - mc.lookStartX) + Math.abs(t.clientY - mc.lookStartY) >
          TAP_THRESHOLD
        ) {
          mc.lookMoved = true;
        }
        const dx = t.clientX - mc.lookLastX;
        const dy = t.clientY - mc.lookLastY;
        state.input.mouse_angle += dx * LOOK_SENS_X;
        state.input.mouse_pitch += dy * LOOK_SENS_Y;
        mc.lookLastX = t.clientX;
        mc.lookLastY = t.clientY;
      }
    }
    e.preventDefault();
  }

  function onTouchEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (t.identifier === mc.consoleTouchId) {
        if (Console?.toggle) {
          Console.toggle();
        } else if (Console) {
          Console.show = !Console.show;
          Console.syncMobileInputVisibility?.();
          if (Console.show) Console.focusMobileInput?.();
          else Console.blurMobileInput?.();
        }
        mc.consoleTouchId = null;
        e.preventDefault();
        continue;
      }

      if (t.identifier === mc.overlayTouchId && !state.playing) {
        if (hitPlayButton(t.clientX, t.clientY, canvas)) tryStartGame(t.clientX, t.clientY, canvas);
        mc.overlayTouchId = null;
        e.preventDefault();
        continue;
      }

      if (t.identifier === mc.joyTouchId) {
        mc.joyTouchId = null;
        mc.joyX = 0;
        mc.joyY = 0;
        mc.joyFingerX = 0;
        mc.joyFingerY = 0;
      } else if (t.identifier === mc.lookTouchId) {
        if (!mc.lookMoved && state.playing && !Console?.show) {
          state.input.mouse_down = true;
          mc.shootPulseUntil = Date.now() + SHOOT_PULSE_MS;
        }
        mc.lookTouchId = null;
        mc.lookMoved = false;
      }
    }
    e.preventDefault();
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
}

export function tickMobileControls() {
  const mc = state.mobileControls;
  if (!mc || !state.input) return;

  const now = Date.now();
  const dt = lastJoyTickMs ? Math.min(0.05, (now - lastJoyTickMs) / 1000) : 1 / 60;
  lastJoyTickMs = now;

  const target = mc.joyTouchId != null ? 1 : 0;
  const fadeK = 1 - Math.exp(-JOY_FADE_SPEED * dt);
  mc.joyFade += (target - mc.joyFade) * fadeK;
  if (mc.joyFade < 0.004) mc.joyFade = 0;

  if (mc.shootPulseUntil && now > mc.shootPulseUntil) {
    state.input.mouse_down = false;
    mc.shootPulseUntil = 0;
  }
}

export function mobileJoyAxis() {
  const mc = state.mobileControls;
  if (!mc || mc.joyTouchId == null) return { x: 0, y: 0 };
  return { x: mc.joyX, y: -mc.joyY };
}

export function getMobileJoyVisual() {
  const mc = state.mobileControls;
  if (!mc || mc.joyFade < 0.004) {
    return { fade: 0, thumbX: 0, thumbY: 0 };
  }
  return { fade: mc.joyFade, thumbX: mc.joyThumbX, thumbY: mc.joyThumbY };
}
