import { state } from '@/core/runtime-state.js';

import { FrameUBO } from './frameubo.js';
import { MsaaTarget } from './msaa.js';

const CONTEXT_ATTRS = {
  alpha: false,
  antialias: false,
  depth: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  stencil: false,
};

export class GLContext {
  static uploadDepthTexture(gl, w, h) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      w,
      h,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
  }

  static init(canvas) {
    const gl = canvas.getContext('webgl2', CONTEXT_ATTRS);
    if (!gl) return false;

    state.gl = gl;
    state.isWebGL2 = true;
    state.depthTexture = true;

    const buffer = gl.createBuffer();
    state.quadBuffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.enableVertexAttribArray(0);

    state.frameUBO = new FrameUBO();
    state.frameUBO.init();
    state.msaa = new MsaaTarget();

    return true;
  }
}
