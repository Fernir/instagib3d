import { state } from '@/core/runtime-state.js';

import { Framebuffer } from '@/engine/FBO.js';
import { Shader } from '@/engine/shader.js';


// Анимированная лава: финальный цвет считается в floor shader per-pixel, а этот
// класс рендерит только медленный wave-FBO (rg = смещение, b = шум маски).

const VERT = `
    attribute vec4 position;
    varying vec4 texcoord;
    void main()
    {
        gl_Position = vec4(position.xy, 0.0, 1.0);
        texcoord.xy = position.xy * 0.5 + 0.5;
        texcoord.zw = position.xy * 0.5 + 0.5;
    }`;

const FRAG = `
    #ifdef GL_ES
    precision highp float;
    #endif
    varying vec4 texcoord;
    uniform sampler2D noise;
    uniform vec4 scale_time;

    void main(void)
    {
        vec2 scale = scale_time.xy;
        vec2 time = scale_time.zw;
        vec4 n = texture2D(noise, 1.5 * texcoord.xy * scale.xy);
        vec4 d1 = texture2D(noise, (texcoord.xy * scale.xy + time.xy));
        vec4 d2 = texture2D(noise, (texcoord.xy * scale.xy + time.yx) * 2.0);
        vec4 d3 = texture2D(noise, (texcoord.xy * scale.xy + vec2(1.0 - time.x, 1.0)) * 4.0);
        vec4 d4 = texture2D(noise, (texcoord.xy * scale.xy + vec2(1.0, 1.0 - time.x)) * 8.0);
        vec2 d = (d1.rg + d2.gr + d3.rg + d4.gr) * 0.25;
        gl_FragColor = vec4(d.rg, n.g, 0.0);
    }`;

export class LavaFlow {
  constructor(size, noiseTexture) {
    this.size = size;
    this.noiseTexture = noiseTexture;
    this.fbo = new Framebuffer(512, 512);
    this.shader = new Shader(VERT, FRAG, ['noise', 'scale_time']);
  }

  texture() {
    return this.fbo.getTexture();
  }

  params() {
    const tile = (10 * this.size) / 64;
    const phase = (Date.now() % 1000) / 1000;
    return [tile, phase, 0, 0];
  }

  render() {
    if (!this.noiseTexture.ready()) return;

    const gl = state.gl;
    const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevCull = gl.isEnabled(gl.CULL_FACE);
    const prevMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);

    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tWave = ((Date.now() / 64) % 1000) / 1000;
    const scWave = (5 * this.size) / 64;

    this.fbo.bind();
    this.shader.use();
    this.shader.texture(this.shader.noise, this.noiseTexture.getId(), 0);
    this.shader.vector(this.shader.scale_time, [scWave, scWave, tWave, 0]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.fbo.unbind();

    if (prevDepth) gl.enable(gl.DEPTH_TEST);
    if (prevBlend) gl.enable(gl.BLEND);
    if (prevCull) gl.enable(gl.CULL_FACE);
    gl.depthMask(prevMask);
  }
}
