// Mutable bag of runtime singletons populated by `runtime.js`.
// Modules import from here instead of reading `globalThis`.

export const state = {
  gl: null,
  isWebGL2: false,
  depthTexture: false,
  frameUBO: null,
  mainFramebuffer: null,
  canvas: null,
  quadBuffer: null,
  mat4: null,
  text: null,
  gameClient: null,
  input: null,
  stats: null,
  options: null,
  sun_direction: null,
  Howler: null,
  Howl: null,
  soundEnabled: true,
  audioUnlocked: false,
  godMode: false,
  godNick: null,
  wireframe: false,
  wireframePass: false,
  localRoom: null,
  playing: false,
  wakeLock: null,
  // Нормализованные координаты курсора в overlay-режиме (когда state.playing=false
  // и pointer lock не активен). Используется для hover-эффектов кнопок в HUD.
  overlayMouse: null,
};

export function getMouseAngle() {
  return state.getMouseAngle ? state.getMouseAngle() : 0;
}

export function getMousePitch() {
  return state.getMousePitch ? state.getMousePitch() : 0;
}

export const VK = {
  W: () => false,
  A: () => false,
  S: () => false,
  D: () => false,
};
