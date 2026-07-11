import { state } from '@/core/runtime-state.js';

export function bindMainFramebuffer() {
  const gl = state.gl;
  if (!gl) return null;
  const fbo = state.mainFramebuffer ?? null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, state.canvas.width, state.canvas.height);
  return fbo;
}
