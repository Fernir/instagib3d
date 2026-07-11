import { state } from '@/core/runtime-state.js';

const SAMPLES = 4;

export class MsaaTarget {
  constructor() {
    this.msaaFbo = null;
    this.colorRb = null;
    this.depthRb = null;
    this.resolveFbo = null;
    this.resolveTex = null;
    this.width = 0;
    this.height = 0;
    this.enabled = false;
  }

  ensure() {
    if (!state.isWebGL2) return false;
    const gl = state.gl;
    const w = state.canvas.width;
    const h = state.canvas.height;
    if (this.msaaFbo && w === this.width && h === this.height) return true;

    this.dispose();
    this.width = w;
    this.height = h;

    this.colorRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, SAMPLES, gl.RGBA8, w, h);

    this.depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, SAMPLES, gl.DEPTH_COMPONENT24, w, h);

    this.msaaFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);

    this.resolveTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.resolveTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.resolveFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.resolveTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
    const msaaOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    const resolveOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    const ok = msaaOk && resolveOk;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.enabled = ok;
    return ok;
  }

  begin() {
    if (!this.ensure()) return false;
    const gl = state.gl;
    state.mainFramebuffer = this.enabled ? this.msaaFbo : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
    gl.viewport(0, 0, this.width, this.height);
    return true;
  }

  end() {
    if (!this.enabled || !this.msaaFbo || !this.resolveFbo) {
      state.mainFramebuffer = null;
      return;
    }
    const gl = state.gl;
    const w = this.width;
    const h = this.height;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.resolveFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    state.mainFramebuffer = null;
  }

  dispose() {
    if (!state.gl) return;
    const gl = state.gl;
    if (this.msaaFbo) gl.deleteFramebuffer(this.msaaFbo);
    if (this.resolveFbo) gl.deleteFramebuffer(this.resolveFbo);
    if (this.resolveTex) gl.deleteTexture(this.resolveTex);
    if (this.colorRb) gl.deleteRenderbuffer(this.colorRb);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
    this.msaaFbo = null;
    this.resolveFbo = null;
    this.resolveTex = null;
    this.colorRb = null;
    this.depthRb = null;
    this.enabled = false;
  }
}
