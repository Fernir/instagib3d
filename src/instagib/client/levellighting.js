import { Framebuffer } from '../engine/FBO.js';
import { Shader } from '../engine/shader.js';
import { state } from '../runtime-state.js';

const VERT_LIGHTMAP_PAINT = `
    attribute vec2 position;
    uniform vec4 quad;
    varying vec2 v_uv;
    void main()
    {
        v_uv = position;
        gl_Position = vec4(quad.x + position.x * quad.z,
                           quad.y + position.y * quad.w,
                           0.0, 1.0);
    }`;

const FRAG_LIGHTMAP_PAINT = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 color;
    varying vec2 v_uv;
    void main()
    {
        float d = length(v_uv);
        if (d > 1.0) discard;
        float att = 1.0 - d;
        att *= att;
        gl_FragColor = vec4(color.rgb * color.a * att, 1.0);
    }`;

function torchHash(ix, iy) {
  let h = ((ix | 0) * 73856093) ^ ((iy | 0) * 19349663);
  h = (h ^ (h >>> 13)) * 2654435761;
  return (h >>> 0) / 4294967295;
}

export class LevelLighting {
  static MAX_LIGHTS = 8;

  static dynamicGlsl = `
    uniform int  dyn_light_count;
    uniform vec4 dyn_light_pos[${LevelLighting.MAX_LIGHTS}];
    uniform vec4 dyn_light_col[${LevelLighting.MAX_LIGHTS}];

    vec3 accum_dyn_lights(vec3 wp, vec3 n)
    {
        vec3 sum = vec3(0.0);
        for (int i = 0; i < ${LevelLighting.MAX_LIGHTS}; i++) {
            if (i >= dyn_light_count) break;
            vec3 lp = dyn_light_pos[i].xyz;
            float r = dyn_light_pos[i].w;
            if (r <= 0.0) continue;
            vec3 dv = wp - lp;
            float d = length(dv);
            float att = max(0.0, 1.0 - d / r);
            att *= att;
            // Лёгкая зависимость от нормали (вклад слегка усиливается при «лицевом» направлении).
            float face = 1.0;
            if (length(n) > 0.001) {
                vec3 to_light = -dv / max(d, 0.0001);
                face = clamp(0.5 + 0.5 * dot(normalize(n), to_light), 0.4, 1.2);
            }
            sum += dyn_light_col[i].rgb * dyn_light_col[i].a * att * face;
        }
        return sum;
    }`;

  static staticLightmapGlsl = `
    uniform sampler2D tex_lightmap;
    vec3 sample_static_lightmap(vec2 uv_level)
    {
        return texture2D(tex_lightmap, uv_level).rgb;
    }`;

  constructor(size, wallHeight, isWall) {
    this.size = size;
    this.wallHeight = wallHeight;
    this.isWall = isWall;
    this.staticLights = this.makeStaticLights();
    this.dynamicLights = [];
    this.posBuf = new Float32Array(LevelLighting.MAX_LIGHTS * 4);
    this.colBuf = new Float32Array(LevelLighting.MAX_LIGHTS * 4);
    this.activeCount = 0;

    const lightmapRes = Math.min(1024, Math.max(256, size * 8));
    this.lightmap = new Framebuffer(lightmapRes, lightmapRes);
    this.shader = new Shader(VERT_LIGHTMAP_PAINT, FRAG_LIGHTMAP_PAINT, ['quad', 'color']);
    this.bakeStaticLightmap();
  }

  texture() {
    return this.lightmap.getTexture();
  }

  active() {
    return { pos: this.posBuf, col: this.colBuf, count: this.activeCount };
  }

  // Приблизительная яркость в точке (x,z) на CPU — для затемнения 2D-оверлеев
  // (имена, HP-бары) в тёмных углах. Формула повторяет lightmap bake.
  lightLevel(ambient, x, z) {
    let r = ambient;
    let g = ambient;
    let b = ambient;
    for (let i = 0; i < this.staticLights.length; i++) {
      const light = this.staticLights[i];
      const dx = x - light.pos[0];
      const dz = z - light.pos[2];
      const dd = dx * dx + dz * dz;
      const rad = light.radius;
      if (dd >= rad * rad) continue;
      let att = 1 - Math.sqrt(dd) / rad;
      att *= att;
      const k = light.intensity * att;
      r += light.color[0] * k;
      g += light.color[1] * k;
      b += light.color[2] * k;
    }
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  locs(shader) {
    return {
      pos: shader.getLocation('dyn_light_pos[0]'),
      col: shader.getLocation('dyn_light_col[0]'),
      count: shader.dyn_light_count,
    };
  }

  apply(locs) {
    const gl = state.gl;
    gl.uniform1i(locs.count, this.activeCount);
    gl.uniform4fv(locs.pos, this.posBuf);
    gl.uniform4fv(locs.col, this.colBuf);
  }

  clearDynamicLights() {
    this.dynamicLights.length = 0;
  }

  // priority=2 — живой снаряд; priority=1 — короткая вспышка; priority=0 — прочее.
  addDynamicLight(x, y, z, color, intensity, radius, priority) {
    this.dynamicLights.push([
      x,
      y,
      z,
      radius,
      color[0],
      color[1],
      color[2],
      intensity,
      priority !== undefined ? priority : 2,
    ]);
  }

  selectActive(camera) {
    const cx = camera.pos.x;
    const cz = camera.pos.y;
    // Все статические факелы уже в lightmap — здесь только динамические лайты.
    const sortedDyn = this.dynamicLights.slice();
    sortedDyn.sort(function (a, b) {
      if (a[8] !== b[8]) return b[8] - a[8];
      const ad = (a[0] - cx) * (a[0] - cx) + (a[2] - cz) * (a[2] - cz);
      const bd = (b[0] - cx) * (b[0] - cx) + (b[2] - cz) * (b[2] - cz);
      return ad - bd;
    });
    const n = Math.min(sortedDyn.length, LevelLighting.MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const d = sortedDyn[i];
      this.writeLight(i, d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
    }
    for (let i = n; i < LevelLighting.MAX_LIGHTS; i++) {
      this.posBuf[i * 4 + 3] = 0;
      this.colBuf[i * 4 + 3] = 0;
    }
    this.activeCount = n;
  }

  writeLight(slot, px, py, pz, r, cr, cg, cb, inten) {
    const k = slot * 4;
    this.posBuf[k + 0] = px;
    this.posBuf[k + 1] = py;
    this.posBuf[k + 2] = pz;
    this.posBuf[k + 3] = r;
    this.colBuf[k + 0] = cr;
    this.colBuf[k + 1] = cg;
    this.colBuf[k + 2] = cb;
    this.colBuf[k + 3] = inten;
  }

  buildTorch(x, z) {
    const r1 = torchHash(x * 31, z * 17);
    const r2 = torchHash(x * 53 + 7, z * 41 + 3);
    const r3 = torchHash(x * 11 + 5, z * 23 + 9);
    const palette = [
      [1.0, 0.55, 0.2],
      [1.0, 0.72, 0.28],
      [1.0, 0.92, 0.35],
      [1.0, 0.98, 0.55],
      [1.0, 0.62, 0.18],
    ];
    const idx = Math.min(palette.length - 1, Math.floor(r1 * palette.length));
    const color = palette[idx];
    const intensity = 0.55 + r2 * 0.65;
    const radius = 13.0 * (0.75 + r3 * 0.5);
    return { color, intensity, radius };
  }

  makeStaticLights() {
    const list = [];
    const step = 11;
    const torchY = this.wallHeight * 0.55;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isWall(x, y)) continue;
        if (!this.isWall(x, y - 1) && (x + y * 7) % step === 0) list.push([x + 0.5, torchY, y - 0.05]);
        if (!this.isWall(x, y + 1) && (x + y * 7) % step === 5) list.push([x + 0.5, torchY, y + 1.05]);
        if (!this.isWall(x - 1, y) && (y + x * 7) % step === 0) list.push([x - 0.05, torchY, y + 0.5]);
        if (!this.isWall(x + 1, y) && (y + x * 7) % step === 5) list.push([x + 1.05, torchY, y + 0.5]);
      }
    }
    return list.map((p) => {
      const t = this.buildTorch((p[0] * 16) | 0, (p[2] * 16) | 0);
      return { pos: p, color: t.color, intensity: t.intensity, radius: t.radius };
    });
  }

  bakeStaticLightmap() {
    const gl = state.gl;
    this.lightmap.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    this.shader.use();
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    for (let i = 0; i < this.staticLights.length; i++) {
      const item = this.staticLights[i];
      const p = item.pos;
      const ndcX = (p[0] / this.size) * 2 - 1;
      const ndcY = 1 - (p[2] / this.size) * 2;
      const halfNdc = item.radius / this.size;
      this.shader.vector(this.shader.quad, [ndcX, ndcY, halfNdc, halfNdc]);
      this.shader.vector(this.shader.color, [
        item.color[0],
        item.color[1],
        item.color[2],
        item.intensity,
      ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.lightmap.unbind();
  }
}
