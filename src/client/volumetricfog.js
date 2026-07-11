import { state } from '@core/runtime-state.js';
import { DepthTarget } from '@engine/depthtarget.js';
import { GLSL } from '@engine/glsl.js';
import { Shader } from '@engine/shader.js';


// Объёмный туман: набор camera-facing слайсов с 3D fbm-шумом. Слайсы расставлены
// по глубине и проходят сквозь сцену; depth-prepass (DepthTarget) даёт глубину
// непрозрачной геометрии, по которой слайсы мягко гаснут у поверхностей
// (soft-particles) вместо жёсткого среза.
//
// Туман рендерится в буфер 1/4 разрешения (дёшево по фрагментам), затем одним
// проходом накладывается на экран. Камерный базис (fogCam) приходит снаружи —
// его же использует геометрия уровня для distance-fog.

const VERT_FOG = `
    attribute vec2 position; // unit quad -1..1
    uniform mat4 view_proj;
    uniform vec4 cam_eye;   // xyz = eye, w = dist
    uniform vec4 cam_fwd;   // xyz = forward, w = halfH
    uniform vec4 cam_right; // xyz = right, w = halfW
    uniform vec4 cam_up;    // xyz = up
    varying vec3 v_world_pos;
    void main()
    {
        vec3 center = cam_eye.xyz + cam_fwd.xyz * cam_eye.w;
        vec3 wp = center
                + cam_right.xyz * (position.x * cam_right.w)
                + cam_up.xyz    * (position.y * cam_fwd.w);
        v_world_pos = wp;
        gl_Position = view_proj * vec4(wp, 1.0);
    }`;

const FRAG_FOG = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex_depth;
    uniform vec4 fog_p;    // x = 1/level_size, y = slice_alpha, z = time, w = slice_eye_dist
    uniform vec4 screen_p; // x = 1/w, y = 1/h, z = near, w = far (>0 => soft particles on)
    varying vec3 v_world_pos;
    ${GLSL.fbm3}

    void main()
    {
        vec3 p = v_world_pos;

        // Высотный профиль: дым стелется снизу и редеет кверху.
        float h = clamp(p.y, 0.0, 5.0);
        float height = exp(-h * 0.4);

        // Живой 3D-дым: один слой fbm, но крупные клочья + высокий контраст,
        // чтобы рисунок дыма был хорошо заметен и переживал апсемпл с 1/4 буфера.
        float t = fog_p.z;
        vec3 q = vec3(p.x, p.y * 0.7, p.z) * 0.32;
        q += vec3(t * 0.10, t * 0.045, -t * 0.08);
        float n = fbm3(q);
        n = clamp(n * 2.2 - 0.55, 0.0, 1.0);

        // Чистая объёмная дымка: плотность одинакова по всей карте, а «туман»
        // на расстоянии набирается за счёт наслоения множества слайсов.
        float baseHaze = 0.22;
        float density = baseHaze * height * n;
        float alpha = clamp(density * fog_p.y, 0.0, 0.5);

        // Soft particles: гасим альфу там, где слайс почти упирается в геометрию
        // (мягкий стык с полом/стенами) и полностью — где он за геометрией. Это
        // убирает резкий шов на полу и мерцание от жёсткого depth-теста.
        if (screen_p.w > 0.0) {
            vec2 suv = gl_FragCoord.xy * screen_p.xy;
            float dz = texture2D(tex_depth, suv).r;
            float ndc = dz * 2.0 - 1.0;
            float nearZ = screen_p.z, farZ = screen_p.w;
            float sceneEye = (2.0 * nearZ * farZ) / (farZ + nearZ - ndc * (farZ - nearZ));
            float soft = clamp((sceneEye - fog_p.w) / 1.6, 0.0, 1.0);
            alpha *= soft;
        }
        if (alpha < 0.01) discard;

        vec3 col = mix(vec3(0.03, 0.038, 0.058), vec3(0.12, 0.14, 0.18), n);
        // Premultiplied alpha: накапливаем слайсы в буфере через blend ONE/1-SRC_ALPHA.
        gl_FragColor = vec4(col * alpha, alpha);
    }`;

const VERT_BLIT = `
    attribute vec2 position;
    varying vec2 v_uv;
    void main() { v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;
const FRAG_BLIT = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex_fog;
    varying vec2 v_uv;
    void main() { gl_FragColor = texture2D(tex_fog, v_uv); }`;

export class VolumetricFog {
  constructor(size) {
    const gl = state.gl;
    this.size = size;
    this.SLICES = 8;
    this.NEAR = 1.5;
    this.FAR = 28.0;

    this.depth = new DepthTarget();

    this.shader = new Shader(VERT_FOG, FRAG_FOG, [
      'view_proj',
      'tex_depth',
      'fog_p',
      'screen_p',
      'cam_eye',
      'cam_fwd',
      'cam_right',
      'cam_up',
    ]);
    this.blit = new Shader(VERT_BLIT, FRAG_BLIT, ['tex_fog']);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );

    this.fogFBO = null;
    this.fogColorTex = null;
    this.fogW = 0;
    this.fogH = 0;
  }

  // Глубина сцены для soft-particles/фаербола (Q2FX). near/far совпадают с
  // линеаризацией в шейдере (screen_p.zw).
  depthInfo() {
    return { ready: this.depth.ready, tex: this.depth.depthTex, near: 0.05, far: this.size * 2 };
  }

  // Depth-prepass непрозрачной геометрии — в начале кадра, до основного рендера.
  prepass(view_proj, meshes) {
    this.depth.prepass(view_proj, meshes);
  }

  // Цветовой буфер тумана 1/4 разрешения (premultiplied alpha).
  ensureFogFBO() {
    const gl = state.gl;
    const w = Math.max(1, state.canvas.width >> 2);
    const h = Math.max(1, state.canvas.height >> 2);
    if (this.fogFBO && w === this.fogW && h === this.fogH) return;
    if (this.fogFBO) {
      gl.deleteFramebuffer(this.fogFBO);
      gl.deleteTexture(this.fogColorTex);
    }
    this.fogW = w;
    this.fogH = h;
    this.fogColorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fogColorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fogFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fogFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fogColorTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  drawSlices(fogCam, inv, t) {
    const gl = state.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Задние слайсы рисуем первыми (back-to-front) для корректного alpha.
    for (let i = this.SLICES - 1; i >= 0; i--) {
      const f = i / (this.SLICES - 1);
      const dist = this.NEAR + (this.FAR - this.NEAR) * f;
      const halfH = dist * fogCam.tanY;
      const halfW = halfH * fogCam.aspect;
      // Гасим слайсы у самого «носа» камеры, чтобы туман не лип на объектив.
      const nearFade = Math.min(1, Math.max(0, (dist - this.NEAR) / 3.0));
      this.shader.vector(this.shader.cam_eye, [fogCam.eye[0], fogCam.eye[1], fogCam.eye[2], dist]);
      this.shader.vector(this.shader.cam_fwd, [fogCam.fwd[0], fogCam.fwd[1], fogCam.fwd[2], halfH]);
      this.shader.vector(this.shader.cam_right, [
        fogCam.right[0],
        fogCam.right[1],
        fogCam.right[2],
        halfW,
      ]);
      // fog_p.w = глубина слайса по оси взгляда — нужна для soft-particles.
      this.shader.vector(this.shader.fog_p, [inv, nearFade, t, dist]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  render(view_proj, fogCam) {
    const gl = state.gl;
    const cullWas = gl.isEnabled(gl.CULL_FACE);
    const blendWas = gl.isEnabled(gl.BLEND);
    const depthWas = gl.isEnabled(gl.DEPTH_TEST);
    const inv = 1 / this.size;
    const t = Date.now() * 0.001;

    gl.disable(gl.CULL_FACE);
    // Слайсы выводят premultiplied-цвет, поэтому везде blend = ONE / 1-SRC_ALPHA.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    this.shader.use();
    this.shader.matrix(this.shader.view_proj, view_proj);
    this.shader.vector(this.shader.cam_up, [fogCam.up[0], fogCam.up[1], fogCam.up[2], 0]);

    if (this.depth.ready) {
      // Туман в буфер половинного разрешения, soft-particles по depth-текстуре,
      // затем композит на экран.
      this.ensureFogFBO();
      this.shader.texture(this.shader.tex_depth, this.depth.depthTex, 1);
      this.shader.vector(this.shader.screen_p, [1 / this.fogW, 1 / this.fogH, 0.05, this.size * 2]);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fogFBO);
      gl.viewport(0, 0, this.fogW, this.fogH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      this.drawSlices(fogCam, inv, t);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, state.canvas.width, state.canvas.height);
      this.blit.use();
      this.blit.texture(this.blit.tex_fog, this.fogColorTex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.clearColor(0.08, 0.1, 0.13, 1);
    } else {
      // Фолбэк без depth-текстуры: прямо на экран, обычный depth-тест.
      this.shader.vector(this.shader.screen_p, [0, 0, 0, 0]);
      this.drawSlices(fogCam, inv, t);
    }

    // ВАЖНО: не отключаем attrib 0 (position) — последующий рендер оружия/мобов
    // (MD2) полагается, что он включён, иначе геометрия вырождается и моргает.
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    gl.depthMask(true);
    if (depthWas) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (!blendWas) gl.disable(gl.BLEND);
    if (cullWas) gl.enable(gl.CULL_FACE);
  }
}
