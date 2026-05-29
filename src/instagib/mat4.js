import * as glm from 'gl-matrix';

export function createGlobalMat4() {
  const lib = glm.mat4;
  const m = {};
  for (const key of Object.getOwnPropertyNames(lib)) {
    const val = lib[key];
    m[key] = typeof val === 'function' ? val.bind(lib) : val;
  }
  m.trans = function trans(out, vec) {
    return m.translate(out, out, [vec[0], vec[1], 0, 0]);
  };
  m.scal = function scal(out, vec) {
    return m.scale(out, out, [vec[0], vec[1], 1, 1]);
  };
  m.rotate = function rotate(out, angle) {
    return m.rotateZ(out, out, angle);
  };
  return m;
}
