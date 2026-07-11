import { state } from '@/core/runtime-state.js';

const BINDING = 0;
const BLOCK_SIZE = 96;

export class FrameUBO {
  constructor() {
    this.buffer = null;
    this.data = new Float32Array(BLOCK_SIZE / 4);
    this.binding = BINDING;
  }

  init() {
    if (!state.isWebGL2 || this.buffer) return;
    const gl = state.gl;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, BLOCK_SIZE, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, BINDING, this.buffer);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }

  update(viewProj, sunDir, ambient, sunIntensity) {
    if (!state.isWebGL2) return;
    this.init();
    const d = this.data;
    d.set(viewProj, 0);
    d[16] = sunDir[0];
    d[17] = sunDir[1];
    d[18] = sunDir[2];
    d[19] = 0;
    d[20] = ambient != null ? ambient : 0.52;
    d[21] = sunIntensity != null ? sunIntensity : 0.38;
    d[22] = 0;
    d[23] = 0;
    const gl = state.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, d);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, BINDING, this.buffer);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }

  bind(program) {
    if (!state.isWebGL2 || !this.buffer) return;
    const gl = state.gl;
    const block = gl.getUniformBlockIndex(program, 'Frame');
    if (block === gl.INVALID_INDEX) return;
    gl.uniformBlockBinding(program, block, this.binding);
  }
}
