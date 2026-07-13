import { state } from '@/core/runtime-state.js';

import { MsaaTarget } from './msaa.js';
import { GLContext } from './glcontext.js';
import { Shader } from './shader.js';

// Карта теней от «солнца»: глубина сцены рендерится из ортографической камеры,
// направленной вдоль sunDir, в depth-текстуру. Поверхности/персонажи потом
// сэмплят её и затемняются там, куда свет не доходит (см. SHADOW_GLSL в level3d).
//
// Требует WEBGL_depth_texture; без него ok=false и вызывающий код пропускает тени.

const VERT = `
    attribute vec3 position;
    uniform mat4 u_mvp;
    void main() { gl_Position = u_mvp * vec4(position, 1.0); }`;
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

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export class ShadowMap {
  constructor(resolution = 2048) {
    this.depthTexSupported = !!state.depthTexture;
    this.res = resolution;
    this.fbo = null;
    this.colorTex = null;
    this.depthTex = null;
    this.lightVP = null;
    this.shader = this.depthTexSupported ? new Shader(VERT, FRAG, ['u_mvp']) : null;
    this.ok = this.depthTexSupported;
  }

  dispose() {
    if (!state.gl) return;
    const gl = state.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.colorTex) gl.deleteTexture(this.colorTex);
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    this.fbo = null;
    this.colorTex = null;
    this.depthTex = null;
  }

  setResolution(res) {
    const r = res | 0;
    if (r <= 0) {
      this.dispose();
      this.res = 0;
      this.ok = false;
      return;
    }
    if (r === this.res && this.fbo) return;
    this.dispose();
    this.res = r;
    this.ok = this.depthTexSupported;
  }

  ensure() {
    if (!this.depthTexSupported || this.res <= 0) return false;
    if (this.fbo) return true;
    const gl = state.gl;
    const r = this.res;

    this.colorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, r, r, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setNearestClamp(gl);

    this.depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    GLContext.uploadDepthTexture(gl, r, r);
    setNearestClamp(gl);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.canvas.width, state.canvas.height);
    this.ok = ok;
    return ok;
  }

  // Ортографический light-space view-proj, сфокусированный на квадрате radius
  // вокруг center. Малая площадь → высокая плотность текселей рядом с игроком.
  // Центр привязывается к сетке текселей, чтобы тени не «ползали» при движении.
  computeLightVP(sunDir, center, radius) {
    const mat4 = state.mat4;
    const dir = normalize3(sunDir);
    const dist = radius * 2 + 10;
    const eye = [
      center[0] - dir[0] * dist,
      center[1] - dir[1] * dist,
      center[2] - dir[2] * dist,
    ];
    const up = Math.abs(dir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    const view = mat4.create();
    mat4.lookAt(view, eye, center, up);

    const near = dist - radius - 5;
    const far = dist + radius + 5;
    const proj = mat4.create();
    mat4.ortho(proj, -radius, radius, -radius, radius, near, far);
    const vp = mat4.create();
    mat4.multiply(vp, proj, view);

    // Texel-snap: проецируем center в clip (ortho w=1) и доводим до целого текселя.
    const cx = vp[0] * center[0] + vp[4] * center[1] + vp[8] * center[2] + vp[12];
    const cy = vp[1] * center[0] + vp[5] * center[1] + vp[9] * center[2] + vp[13];
    const half = this.res * 0.5;
    const dx = (Math.round(cx * half) / half - cx);
    const dy = (Math.round(cy * half) / half - cy);
    vp[12] += dx;
    vp[13] += dy;

    this.lightVP = vp;
    return vp;
  }

  // Привязывает FBO и состояние depth-pass. Возвращает lightVP (или null).
  // center — мировая точка фокуса (игрок), radius — половина стороны области.
  begin(sunDir, center, radius) {
    if (!this.ensure()) return null;
    const gl = state.gl;
    const vp = this.computeLightVP(sunDir, center, radius);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.res, this.res);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.2, 2.5);

    this.shader.use();
    return vp;
  }

  // Глубина статических мешей уровня (engine Mesh: buffer/stride/count), позиции в мире.
  drawWorld(lightVP, meshes) {
    const gl = state.gl;
    this.shader.use();
    this.shader.matrix(this.shader.u_mvp, lightVP);
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (!mesh || !mesh.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, (mesh.stride || 8) * 4, 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
  }

  // Глубина произвольного буфера (локальные координаты): mvp = lightVP * model.
  drawLocal(mvp, buffer, stride, count, offset = 0) {
    if (!buffer || !count) return;
    const gl = state.gl;
    this.shader.use();
    this.shader.matrix(this.shader.u_mvp, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride * 4, offset * 4);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  end() {
    const gl = state.gl;
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(0, 0);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    MsaaTarget.bindMain();
  }

  texture() {
    return this.depthTex;
  }

  texelSize() {
    return 1 / this.res;
  }
}
