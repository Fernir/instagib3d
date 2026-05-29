// Mutable bag of runtime singletons populated by `runtime.js`.
// Modules import from here instead of reading `globalThis`.

export const state = {
  gl: null,
  canvas: null,
  mat4: null,
  text: null,
  gameClient: null,
  input: null,
  stats: null,
  options: null,
  sun_direction: null,
  Howler: null,
  Howl: null,
  godMode: false,
  godNick: null,
  localRoom: null,
};

export function getMouseAngle() {
  return state.getMouseAngle ? state.getMouseAngle() : 0;
}

export const VK = {
  W: () => false,
  A: () => false,
  S: () => false,
  D: () => false,
};
