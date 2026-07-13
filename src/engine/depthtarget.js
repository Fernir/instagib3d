import { state } from '@/core/runtime-state.js';

import { GLContext } from './glcontext.js';
import { MsaaTarget } from './msaa.js';
import { Shader } from './shader.js';

// Depth-prepass: рисует геометрию (только позиция → глубина) в FBO с depth-
// текстурой (WEBGL_depth_texture). Текстуру глубины потом читают эффекты
// (объёмный туман, soft-particles), которым нужна глубина непрозрачной сцены.
//
// Требует WEBGL_depth_texture; без расширения ensure()/prepass() вернут false и
// ready останется выключенным (вызывающий код уходит в фолбэк без soft-fade).

const VERT = `
    attribute vec4 position;
    uniform mat4 view_proj;
    void main() { gl_Position = view_proj * vec4(position.xyz, 1.0); }`;
const FRAG = `
    #ifdef GL_ES
    precision highp float;
    #endif
    void main() { gl_FragColor = vec4(1.0); }`;

function setNearestClamp(gl) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export class DepthTarget {
  constructor() {
    this.depthTexSupported = !!state.depthTexture;
    this.fbo = null;
    this.colorTex = null;
    this.depthTex = null;
    this.width = 0;
    this.height = 0;
    this.ready = false;
    this.shader = this.depthTexSupported ? new Shader(VERT, FRAG, ['view_proj']) : null;
  }

  // Пересоздаёт FBO под текущий размер канваса. false — depth-текстуры нет.
  ensure() {
    if (!this.depthTexSupported) return false;
    const gl = state.gl;
    const w = state.canvas.width;
    const h = state.canvas.height;
    if (this.fbo && w === this.width && h === this.height) return true;
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo);
      gl.deleteTexture(this.colorTex);
      gl.deleteTexture(this.depthTex);
    }
    this.width = w;
    this.height = h;

    this.colorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setNearestClamp(gl);

    this.depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    GLContext.uploadDepthTexture(gl, w, h);
    setNearestClamp(gl);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.canvas.width, state.canvas.height);
    return ok;
  }

  // Рисует меши (только в глубину) в FBO. meshes — массив объектов с полями
  // buffer/stride/count (engine Mesh). Возвращает готовность depth-текстуры.
  prepass(view_proj, meshes) {
    const gl = state.gl;
    this.ready = this.ensure();
    if (!this.ready) return false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    this.shader.use();
    this.shader.matrix(this.shader.view_proj, view_proj);

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (!mesh || !mesh.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, (mesh.stride || 8) * 4, 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    MsaaTarget.bindMain();
    return true;
  }
}
