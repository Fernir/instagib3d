import { Buffer } from '@/core/buffer.js';
import { Event } from '@/core/event.js';
import { state } from '@/core/runtime-state.js';
import { Vector } from '@/core/vector.js';

import { GLSL } from '@/engine/glsl.js';
import { Shader } from '@/engine/shader.js';
import { Texture } from '@/engine/texture.js';

import { WEAPON, ITEM } from '@/global.js';

import { Dynent } from '@/sim/dynent.js';

class Q2FX {}

Q2FX.particles = [];
Q2FX.tex_glow = null;
Q2FX.MAX_PARTICLES = 1200;

function bulletWorldDir(bullet) {
  const vx = bullet.dynent.vel.x;
  const vz = bullet.dynent.vel.y;
  const vy = bullet.vz || 0;
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (len > 0.02) {
    return { fx: vx / len, fy: vy / len, fz: vz / len };
  }
  const cp = Math.cos(bullet.pitch || 0);
  const sp = Math.sin(bullet.pitch || 0);
  const a = bullet.dynent.angle;
  return { fx: -Math.sin(a) * cp, fy: sp, fz: -Math.cos(a) * cp };
}

function fireSphereBillboard(camera, wx, wz, wy, halfSize, color, panSpeed) {
  if (!Q2FX.shader_fire_sphere || !Q2FX.tex_noise || !Q2FX.tex_noise.ready || !Q2FX.tex_noise.ready()) {
    return fireCoreBillboard(camera, wx, wz, wy, halfSize, color);
  }
  const t = Date.now() * 0.001;
  const sh = Q2FX.shader_fire_sphere;
  _tmp_pos.x = wx;
  _tmp_pos.y = wz;
  const sz = halfSize * 2;
  Dynent.render(camera, Q2FX.tex_noise, sh, _tmp_pos, [sz, sz], 0, {
    vectors: [
      { location: sh.color, vec: color },
      { location: sh.pan, vec: [t * panSpeed * 0.35, t * panSpeed * 0.2, 0.92, 0] },
    ],
    y_anchor: 'floor',
    y_offset: wy,
  });
  return true;
}

function fireCoreBillboard(camera, wx, wz, wy, halfSize, color) {
  if (!Q2FX.shader_fire_core || !Q2FX.tex_glow) return false;
  const sh = Q2FX.shader_fire_core;
  _tmp_pos.x = wx;
  _tmp_pos.y = wz;
  const sz = halfSize * 2;
  Dynent.render(camera, Q2FX.tex_glow, sh, _tmp_pos, [sz, sz], 0, {
    vectors: [{ location: sh.color, vec: color }],
    y_anchor: 'floor',
    y_offset: wy,
  });
  return true;
}

function renderRocketTrailRibbon(camera, pts, isQuad) {
  if (!pts || pts.length < 2) return;
  const W = state.Weapon;
  const shaft = W && W.shader_shaft;
  const trailTex = Q2FX.tex_glow;
  if (!shaft || !trailTex) return;

  const scroll = -Date.now() * 0.003;
  const n = pts.length;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n - 1; i++) {
      const t = i / Math.max(1, n - 2);
      const fade = 0.35 + t * 0.65;
      const p0 = [pts[i].x, pts[i].y, pts[i].z];
      const p1 = [pts[i + 1].x, pts[i + 1].y, pts[i + 1].z];
      if (pass === 0) {
        const width = (0.2 + t * 0.34) * (isQuad ? 1.12 : 1);
        Dynent.renderSegmentBeam(camera, trailTex, shaft, p0, p1, width, {
          vectors: [{ location: shaft.color, vec: [2.6 * fade, 1.35 * fade, 0.32 * fade, 1] }],
          mat_tex: shaftMatTex(scroll + i * 0.11, 0.62),
        });
      } else {
        const width = (0.34 + t * 0.48) * (isQuad ? 1.1 : 1);
        Dynent.renderSegmentBeam(camera, trailTex, shaft, p0, p1, width, {
          vectors: [{ location: shaft.color, vec: [1.35 * fade, 0.62 * fade, 0.12 * fade, 0.55] }],
          mat_tex: shaftMatTex(scroll * 0.7 + i * 0.07, 0.72),
        });
      }
    }
  }
}

function renderRocketExhaustTrail(camera, pTail, dir, panTime, isQuad) {
  const W = state.Weapon;
  const shaft = W && W.shader_shaft;
  const trailTex = Q2FX.tex_glow;
  const flareTex = Q2FX.tex_flare;
  if (!shaft || !trailTex) return;

  const scroll = -panTime * 3.2;
  const x = pTail[0];
  const y = pTail[1];
  const z = pTail[2];
  const layers = [
    { len: isQuad ? 2.1 : 1.75, width: isQuad ? 0.46 : 0.4, color: [3.0, 1.45, 0.28, 1] },
    { len: isQuad ? 1.35 : 1.1, width: isQuad ? 0.3 : 0.26, color: [2.2, 0.85, 0.12, 1] },
    { len: 0.72, width: 0.16, color: [3.2, 1.65, 0.45, 1] },
  ];
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const p1 = [x, y, z];
    const p0 = [x - dir.fx * L.len, y - dir.fy * L.len, z - dir.fz * L.len];
    Dynent.renderSegmentBeam(camera, trailTex, shaft, p0, p1, L.width, {
      vectors: [{ location: shaft.color, vec: L.color }],
      mat_tex: shaftMatTex(scroll + i * 0.24, 0.58),
    });
  }
  if (flareTex && flareTex.getId && flareTex.getId()) {
    const p1 = [x, y, z];
    const p0 = [x - dir.fx * 0.95, y - dir.fy * 0.95, z - dir.fz * 0.95];
    Dynent.renderSegmentBeam(camera, flareTex, shaft, p0, p1, 0.22, {
      vectors: [{ location: shaft.color, vec: [3.0, 2.0, 0.65, 1] }],
      mat_tex: shaftMatTex(scroll * 0.5, 0.42),
    });
  }
}

function renderRocketFireball(camera, bullet) {
  const x = bullet.dynent.pos.x;
  const z = bullet.dynent.pos.y;
  const y = bullet.z !== undefined ? bullet.z : eyeH() - 0.35;
  const dir = bulletWorldDir(bullet);
  const panT = Date.now() * 0.001;
  const isQuad = bullet.power === ITEM.QUAD;
  const bodyLen = isQuad ? 0.64 : 0.58;
  const bodyW = isQuad ? 0.24 : 0.21;
  const half = bodyLen * 0.5;

  const pNose = [x + dir.fx * half, y + dir.fy * half, z + dir.fz * half];
  const pTail = [x - dir.fx * half, y - dir.fy * half, z - dir.fz * half];

  if (bullet.trailPts) renderRocketTrailRibbon(camera, bullet.trailPts, isQuad);
  renderRocketExhaustTrail(camera, pTail, dir, panT, isQuad);

  const W = state.Weapon;
  const rocketTex = W && W.skins && W.skins[WEAPON.ROCKET] && W.skins[WEAPON.ROCKET].bullet;
  const bodyShader = W && W.shader_noshadow;
  const gl = state.gl;
  if (rocketTex && bodyShader) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    Dynent.renderSegmentBeam(camera, rocketTex, bodyShader, pTail, pNose, bodyW);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  }

  const noz = 0.14;
  const ex = pTail[0] - dir.fx * noz;
  const ey = pTail[1] - dir.fy * noz;
  const ez = pTail[2] - dir.fz * noz;

  const exhaustCol = isQuad ? [1.6, 0.88, 0.38, 0.95] : [1.5, 0.75, 0.2, 0.92];
  fireSphereBillboard(camera, ex, ez, ey, 0.26, exhaustCol, 0.62);
  fireCoreBillboard(camera, ex, ez, ey, 0.12, [2.5, 1.1, 0.22, 0.88]);
  fireCoreBillboard(camera, ex, ez, ey - dir.fy * 0.05, 0.07, [3.6, 2.9, 1.3, 0.55]);
  return true;
}

Q2FX.load = function () {
  const SIZE = 64;
  const buf = new Buffer(SIZE);
  const half = (SIZE - 1) * 0.5;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const v = (1 - d) * (1 - d);
      buf.setData(y * SIZE + x, v);
    }
  }
  Q2FX.tex_glow = Buffer.create_texture(buf, buf, buf, buf, {
    wrap: state.gl.CLAMP_TO_EDGE,
  });

  // Мягкая «клубящаяся» текстура дыма:
  // alpha — облако из нескольких смещённых гауссовых клякс, сходящее к нулю у краёв
  // (чтобы квадрат текстуры не был виден). Даёт объёмный дым вместо ровных шариков.
  const smoke = new Buffer(SIZE);
  const white = new Buffer(SIZE);
  const puffN = 10;
  const puffs = [];
  for (let i = 0; i < puffN; i++) {
    puffs.push({
      cx: (0.3 + Math.random() * 0.4) * SIZE,
      cy: (0.3 + Math.random() * 0.4) * SIZE,
      r: (0.1 + Math.random() * 0.16) * SIZE,
    });
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0;
      for (let i = 0; i < puffN; i++) {
        const p = puffs[i];
        const dx = (x - p.cx) / p.r;
        const dy = (y - p.cy) / p.r;
        v += Math.exp(-(dx * dx + dy * dy));
      }
      v = Math.min(1, v * 0.85);
      const mx = (x - half) / half;
      const my = (y - half) / half;
      const md = Math.min(1, Math.sqrt(mx * mx + my * my));
      const mask = 1 - md; // 0 на краю
      v *= mask * mask;
      smoke.setData(y * SIZE + x, v);
      white.setData(y * SIZE + x, 1.0);
    }
  }
  Q2FX.tex_smoke = Buffer.create_texture(white, white, white, smoke, {
    wrap: state.gl.CLAMP_TO_EDGE,
  });

  // Острый 4-лучевой «искровой» спрайт (Godot-style spark).
  const sparkBuf = new Buffer(SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const d = Math.sqrt(dx * dx + dy * dy);
      const cross =
        Math.max(0, 1 - Math.abs(dx) * 9) * Math.max(0, 1 - Math.abs(dy) * 2.5) +
        Math.max(0, 1 - Math.abs(dy) * 9) * Math.max(0, 1 - Math.abs(dx) * 2.5);
      const core = Math.exp(-d * d * 10);
      sparkBuf.setData(y * SIZE + x, Math.min(1, cross * 0.75 + core * 0.9));
    }
  }
  Q2FX.tex_spark = Buffer.create_texture(sparkBuf, sparkBuf, sparkBuf, sparkBuf, {
    wrap: state.gl.CLAMP_TO_EDGE,
  });

  // Аутентичная текстура молнии из оригинального instagib.io
  // (weapons/shaft/bullet.png — вертикальная рваная молния на чёрном фоне).
  // wrap=REPEAT, чтобы тайлить и прокручивать её вдоль луча.
  Q2FX.tex_bolt = new Texture('/game/textures/weapons/shaft/bullet.png', {
    wrap: state.gl.REPEAT,
  });
  // Мягкая вспышка в точке попадания (weapons/shaft/fire.png).
  Q2FX.tex_flare = new Texture('/game/textures/weapons/shaft/fire.png', {
    wrap: state.gl.CLAMP_TO_EDGE,
  });

  const vert_billboard = Shader.vertexShader(true, false, 'gl_Position');

  // --- Soft-particle шейдер для частиц Q2FX (текстура + depth-fade у геометрии) -
  const vert_soft = Shader.vertexShader(true, false, 'gl_Position');
  const frag_soft = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex;
    uniform vec4 color;
    varying vec4 texcoord;
    ${GLSL.softDepth}
    void main() {
        vec4 col = texture2D(tex, texcoord.xy);
        if (col.a < 0.02) discard;
        col *= color;
        col *= soft_depth_fade(0.5);
        if (col.a < 0.004) discard;
        gl_FragColor = col;
    }`;
  Q2FX.shader_soft = new Shader(vert_soft, frag_soft, [
    'mat_pos',
    'tex',
    'color',
    'tex_depth',
    'screen_p',
  ]);

  const vert_particle_batch = `
    attribute vec3 position;
    attribute vec2 texuv;
    attribute vec4 vtx_color;
    uniform mat4 view_proj;
    varying vec2 v_uv;
    varying vec4 v_color;
    void main() {
        gl_Position = view_proj * vec4(position, 1.0);
        v_uv = texuv;
        v_color = vtx_color;
    }`;
  const frag_particle_batch = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex;
    varying vec2 v_uv;
    varying vec4 v_color;
    ${GLSL.softDepth}
    void main() {
        vec4 col = texture2D(tex, v_uv);
        if (col.a < 0.02) discard;
        col *= v_color;
        col *= soft_depth_fade(0.5);
        if (col.a < 0.004) discard;
        gl_FragColor = col;
    }`;
  Q2FX.shader_particle_batch = new Shader(vert_particle_batch, frag_particle_batch, [
    'view_proj',
    'tex',
    'tex_depth',
    'screen_p',
  ]);
  Q2FX._batchStride = 9;
  Q2FX._batchVertMax = Q2FX.MAX_PARTICLES * 6;
  Q2FX._batchData = new Float32Array(Q2FX._batchVertMax * Q2FX._batchStride);
  Q2FX._batchBuf = state.gl.createBuffer();
  state.gl.bindBuffer(state.gl.ARRAY_BUFFER, Q2FX._batchBuf);
  state.gl.bufferData(state.gl.ARRAY_BUFFER, Q2FX._batchData, state.gl.DYNAMIC_DRAW);
  Q2FX._batchLocs = {
    pos: Q2FX.shader_particle_batch.attrib('position'),
    uv: Q2FX.shader_particle_batch.attrib('texuv'),
    color: Q2FX.shader_particle_batch.attrib('vtx_color'),
  };

  // Panning noise fire head (Le Lu / Godot fireball head: noise − vertical gradient).
  Q2FX.tex_noise = new Texture('/game/textures/fx/noise.png', {
    wrap: state.gl.REPEAT,
    flipY: false,
  });
  const frag_fire_sphere = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex;
    uniform vec4 color;
    uniform vec4 pan;
    varying vec4 texcoord;
    void main() {
        vec2 uv = texcoord.xy;
        vec2 bc = uv * 2.0 - 1.0;
        float r2 = dot(bc, bc);
        if (r2 > 1.0) discard;

        float r = sqrt(r2);
        float z = sqrt(max(0.001, 1.0 - r2));
        vec3 n = normalize(vec3(bc.x, bc.y, z * 0.9));
        float su = atan(n.x, n.z) / 6.2831853 + 0.5;
        float sv = n.y * 0.5 + 0.5;
        vec2 suv = vec2(su, sv) + pan.xy;
        float n1 = texture2D(tex, suv * 4.2 + pan.xy).r;
        float n2 = texture2D(tex, suv * 6.8 + vec2(0.31, 0.14)).r;
        float n3 = texture2D(tex, vec2(su * 2.1 + pan.x, sv * 3.4 + pan.y)).r;
        float noise = n1 * 0.4 + n2 * 0.35 + n3 * 0.25;
        noise = smoothstep(0.15, 0.9, noise);

        float core = pow(max(0.0, 1.0 - r), 2.1);
        float rimMask = smoothstep(0.22, 0.84, r);
        float bite = (noise - 0.5) * 0.44 * rimMask * pan.z;
        float sdf = r - 0.53 - bite;
        float fire = 1.0 - smoothstep(-0.004, 0.016, sdf);
        float lick = smoothstep(0.6, 0.95, r) * step(0.5, noise) * step(r, 0.98);
        fire = max(fire, lick * 0.42);
        if (fire < 0.004) discard;

        vec3 hot = vec3(1.0, 0.88, 0.42);
        vec3 mid = vec3(1.0, 0.42, 0.06);
        vec3 edge = vec3(0.45, 0.06, 0.01);
        vec3 tint = mix(edge, mix(mid, hot, core), fire);
        vec3 rgb = tint * color.rgb * fire * 2.6;
        gl_FragColor = vec4(rgb, fire * color.a);
    }`;
  Q2FX.shader_fire_sphere = new Shader(vert_billboard, frag_fire_sphere, [
    'mat_pos',
    'tex',
    'color',
    'pan',
  ]);

  const frag_fire_core = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex;
    uniform vec4 color;
    varying vec4 texcoord;
    void main() {
        vec2 bc = texcoord.xy * 2.0 - 1.0;
        float d = dot(bc, bc);
        float core = pow(max(0.0, 1.0 - d), 3.8);
        core = smoothstep(0.0, 0.92, core);
        if (core < 0.004) discard;
        vec3 rgb = color.rgb * core * 3.0;
        gl_FragColor = vec4(rgb, core * color.a);
    }`;
  Q2FX.shader_fire_core = new Shader(vert_billboard, frag_fire_core, ['mat_pos', 'tex', 'color']);
};

// Текущая depth-инфа сцены (из level3d depth-prepass) для soft-particles/фаербола.
Q2FX.sceneDepth = function () {
  const lr = state.LevelRender;
  if (!lr || !lr.getSceneDepthInfo) return null;
  const info = lr.getSceneDepthInfo();
  return info && info.ready ? info : null;
};

function is3D() {
  return !!(state.LevelRender && state.LevelRender.isFirstPerson3D);
}

function eyeH() {
  return (state.LevelRender && state.LevelRender.eye_height) || 1.6;
}

// Кривые анимации частиц (как Curve в Godot CPUParticles).
function vfxEase(name, t) {
  t = Math.max(0, Math.min(1, t));
  switch (name) {
    case 'outQuad':
      return 1 - (1 - t) * (1 - t);
    case 'outCubic':
      return 1 - Math.pow(1 - t, 3);
    case 'outExpo':
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'inOutQuad':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'inQuad':
      return t * t;
    default:
      return t;
  }
}

function losFromPlayer(wx, wz) {
  if (!is3D()) return true;
  const lr = state.LevelRender;
  const gc = state.gameClient;
  if (!lr || !lr.hasLineOfSight || !gc) return true;
  const cam = gc.getCamera && gc.getCamera();
  if (!cam) return true;
  return lr.hasLineOfSight(cam.dynent.pos, { x: wx, y: wz });
}

function visibleFromPlayer(wx, wz) {
  return losFromPlayer(wx, wz);
}

const PARTICLE_CULL_DIST_SQ = 70 * 70;

function particleInRange(wx, wz) {
  const gc = state.gameClient;
  const cam = gc && gc.getCamera && gc.getCamera();
  if (!cam || !cam.dynent) return true;
  const dx = wx - cam.dynent.pos.x;
  const dz = wz - cam.dynent.pos.y;
  return dx * dx + dz * dz <= PARTICLE_CULL_DIST_SQ;
}

const _batchCorners = [
  [-1, -1, 0, 0],
  [1, -1, 1, 0],
  [-1, 1, 0, 1],
  [1, -1, 1, 0],
  [1, 1, 1, 1],
  [-1, 1, 0, 1],
];

function pushBillboardVerts(data, off, camera, wx, wy, wz, hw, hh, spin, rgba) {
  const yaw = camera.angle;
  let rx = Math.cos(yaw);
  let rz = -Math.sin(yaw);
  if (spin) {
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    const nrx = rx * cs - rz * sn;
    rz = rx * sn + rz * cs;
    rx = nrx;
  }
  const sx = rx * hw;
  const sz = rz * hw;
  const stride = Q2FX._batchStride;
  for (let i = 0; i < 6; i++) {
    const lx = _batchCorners[i][0];
    const ly = _batchCorners[i][1];
    const base = off + i * stride;
    data[base] = wx + sx * lx;
    data[base + 1] = wy + hh * ly;
    data[base + 2] = wz + sz * lx;
    data[base + 3] = _batchCorners[i][2];
    data[base + 4] = _batchCorners[i][3];
    data[base + 5] = rgba[0];
    data[base + 6] = rgba[1];
    data[base + 7] = rgba[2];
    data[base + 8] = rgba[3];
  }
  return off + 6 * stride;
}

function flushParticleBatch(gl, shader, texId, depth, screen_p, vertCount) {
  if (!vertCount || texId === null) return;
  const stride = Q2FX._batchStride;
  shader.use();
  shader.matrix(shader.view_proj, state.viewProj3D);
  shader.texture(shader.tex, texId, 0);
  if (depth && screen_p) {
    shader.texture(shader.tex_depth, depth.tex, 2);
    shader.vector(shader.screen_p, screen_p);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, Q2FX._batchBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, Q2FX._batchData.subarray(0, vertCount * stride));
  const locs = Q2FX._batchLocs;
  gl.enableVertexAttribArray(locs.pos);
  gl.vertexAttribPointer(locs.pos, 3, gl.FLOAT, false, stride * 4, 0);
  gl.enableVertexAttribArray(locs.uv);
  gl.vertexAttribPointer(locs.uv, 2, gl.FLOAT, false, stride * 4, 12);
  gl.enableVertexAttribArray(locs.color);
  gl.vertexAttribPointer(locs.color, 4, gl.FLOAT, false, stride * 4, 20);
  gl.drawArrays(gl.TRIANGLES, 0, vertCount);
  state.stats.count_dynent_rendering += vertCount / 6;
  if (locs.pos !== 0) gl.disableVertexAttribArray(locs.pos);
  gl.disableVertexAttribArray(locs.uv);
  gl.disableVertexAttribArray(locs.color);
  if (state.quadBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
}

function renderParticleFallback(camera, p, shaderSoft, shaderBase, screen_p, depth, rgba, sx, sy) {
  _tmp_pos.x = p.x;
  _tmp_pos.y = p.z;
  const shader = shaderSoft;
  const vectors = [{ location: shader.color, vec: rgba }];
  if (screen_p) vectors.push({ location: shader.screen_p, vec: screen_p });
  const renderStates = {
    vectors: vectors,
    y_offset: p.y - sy * 0.5,
    force_billboard: (p.flat || 0) > 0,
  };
  if (screen_p) {
    renderStates.textures = [{ location: shader.tex_depth, id: depth.tex }];
  }
  const tex = p.tex || Q2FX.tex_glow;
  Dynent.render(camera, tex, shader, _tmp_pos, [sx, sy], p.spin || 0, renderStates);
}

Q2FX.spawn = function (opts) {
  if (Q2FX.particles.length >= Q2FX.MAX_PARTICLES) {
    const now = Date.now();
    let dropIdx = -1;
    for (let i = 0; i < Q2FX.particles.length; i++) {
      const p = Q2FX.particles[i];
      if (p.vfx === 'explosion') continue;
      const t = (now - p.born) / p.lifetime;
      if (t > 0.7) {
        dropIdx = i;
        break;
      }
    }
    if (dropIdx < 0) {
      for (let i = 0; i < Q2FX.particles.length; i++) {
        if (Q2FX.particles[i].vfx !== 'explosion') {
          dropIdx = i;
          break;
        }
      }
    }
    Q2FX.particles.splice(dropIdx >= 0 ? dropIdx : 0, 1);
  }
  const sz = opts.size !== undefined ? opts.size : 0.5;
  const y = opts.y !== undefined ? fxClampSpawnY(opts.y, sz * 0.5) : opts.y;
  Q2FX.particles.push({
    x: opts.x,
    y: y,
    z: opts.z,
    vx: opts.vx || 0,
    vy: opts.vy || 0,
    vz: opts.vz || 0,
    drag: opts.drag !== undefined ? opts.drag : 1.0,
    gravity: opts.gravity || 0,
    color: opts.color || [1, 1, 1, 1],
    color_end: opts.color_end || [0, 0, 0, 0],
    size: opts.size !== undefined ? opts.size : 0.5,
    size_end: opts.size_end !== undefined ? opts.size_end : opts.size || 0.5,
    lifetime: opts.lifetime || 400,
    blend: opts.blend || 'add',
    tex: opts.tex || null,
    // delay сдвигает «рождение» в будущее: частица невидима и не учитывается до
    // born (t<0 в render), но физика интегрируется от спавна. Нужно для дыма —
    // он появляется, когда фаербол уже разгорелся, а не тёмным пятном по центру.
    born: Date.now() + (opts.delay || 0),
    last: Date.now(),
    size_ease: opts.size_ease || 'linear',
    alpha_ease: opts.alpha_ease || 'linear',
    spin: opts.spin || 0,
    spin_rate: opts.spin_rate || 0,
    lock_y: opts.lock_y,
    flat: opts.flat || 0,
    vfx: opts.vfx || null,
  });
};

Q2FX.muzzleFlash = function (pos, angle, color) {
  if (!is3D()) return;
  const m = muzzleWorld(pos.x, pos.y, angle);
  const gx = m.x;
  const gy = m.y;
  const gz = m.z;
  const c = color || [1, 0.9, 0.55, 1.0];
  spawnFlashCore({ x: gx, y: gz }, gy, 0.55, c);
  Q2FX.spawn({
    x: gx,
    y: gy,
    z: gz,
    color: c,
    color_end: [c[0] * 0.4, c[1] * 0.2, 0.02, 0],
    size: 0.55,
    size_end: 1.6,
    size_ease: 'outExpo',
    alpha_ease: 'outQuad',
    lifetime: 95,
  });
  Q2FX.spawn({
    x: gx,
    y: gy,
    z: gz,
    color: [2.5, 2.2, 1.8, 1],
    color_end: [c[0], c[1], c[2], 0],
    size: 0.25,
    size_end: 0.7,
    size_ease: 'outExpo',
    alpha_ease: 'outExpo',
    lifetime: 55,
    tex: Q2FX.tex_spark,
  });
};

Q2FX.tracer = function (sx, sz, ex, ez, color, lifetime, size, sy, ey) {
  if (!is3D()) return;
  const dx = ex - sx;
  const dz = ez - sz;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.1) return;
  const step = 0.25;
  const count = Math.min(160, Math.max(6, Math.floor(len / step)));
  const y0 = sy !== undefined ? sy : eyeH() - 0.15;
  const y1 = ey !== undefined ? ey : y0;
  const dy = y1 - y0;
  const baseSize = size || 0.3;
  const lt = lifetime || 220;
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const px = sx + dx * t;
    const pz = sz + dz * t;
    if (!visibleFromPlayer(px, pz)) continue;
    Q2FX.spawn({
      x: px,
      y: y0 + dy * t,
      z: pz,
      color: color,
      color_end: [color[0] * 0.15, color[1] * 0.15, color[2] * 0.15, 0],
      size: baseSize,
      size_end: baseSize * 0.3,
      lifetime: lt + t * 40,
    });
  }
};

// ---- Lightning bolts (Shaft / laser) ------------------------------------
// A continuous, animated electric arc instead of a straight line. Each owner
// keeps one bolt entry; while firing it is refreshed every frame, and once
// firing stops it lingers and fades out instead of vanishing instantly.
Q2FX.bolts = [];
Q2FX.BOLT_LINGER = 200;

// World-space muzzle of the shooter's gun. For the local player it follows the
// on-screen weapon (camera basis with pitch + down/right offset); for remote
// players it sits at the gun tip in front of their body. Returns
// { x, y, z, fx, fy, fz } where y is height and (fx,fy,fz) the forward dir.
function muzzleWorld(ownerX, ownerZ, angle) {
  const gc = state.gameClient;
  const cam = gc && gc.getCamera && gc.getCamera();
  const eh = eyeH();
  let isLocal = false;
  if (cam && cam.dynent) {
    const ddx = ownerX - cam.dynent.pos.x;
    const ddz = ownerZ - cam.dynent.pos.y;
    isLocal = ddx * ddx + ddz * ddz < 1.0;
  }
  const sy = Math.sin(angle);
  const cy = Math.cos(angle);
  if (isLocal) {
    // Физический кончик ствола: bot.js публикует мировую точку дула из меша
    // вид-модели каждый кадр. Луч/вспышка/трассер стартуют ровно из ствола.
    const lm = state.localMuzzle;
    if (lm && Date.now() - lm.time < 200) {
      return { x: lm.x, y: lm.y, z: lm.z, fx: lm.fx, fy: lm.fy, fz: lm.fz };
    }
    // Фолбэк (если вид-модель ещё не отрисована): смещение в системе камеры.
    const pitch = state.getMousePitch ? state.getMousePitch() : 0;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const fx = -sy * cp;
    const fy = -sp;
    const fz = -cy * cp;
    const rx = cy;
    const rz = -sy;
    const ux = -sy * sp;
    const uy = cp;
    const uz = -cy * sp;
    const R = 0.18;
    const D = 0.3;
    const F = 0.5;
    return {
      x: ownerX + rx * R - ux * D + fx * F,
      y: eh - uy * D + fy * F,
      z: ownerZ + rz * R - uz * D + fz * F,
      fx,
      fy,
      fz,
    };
  }
  const R = 0.2;
  const F = 0.7;
  return {
    x: ownerX + -sy * F + cy * R,
    y: eh - 0.15,
    z: ownerZ + -cy * F + -sy * R,
    fx: -sy,
    fy: 0,
    fz: -cy,
  };
}
Q2FX.muzzleWorld = muzzleWorld;

// Refresh (or create) the bolt for an owner. p0/p1 are [x, height, z].
Q2FX.shaftUpdate = function (ownerid, p0, p1, color) {
  const now = Date.now();
  for (let i = 0; i < Q2FX.bolts.length; i++) {
    const b = Q2FX.bolts[i];
    if (b.ownerid === ownerid) {
      b.p0 = p0;
      b.p1 = p1;
      b.color = color;
      b.expire = now + Q2FX.BOLT_LINGER;
      return;
    }
  }
  Q2FX.bolts.push({
    ownerid,
    p0,
    p1,
    color,
    seed: Math.random() * 100,
    born: now,
    expire: now + Q2FX.BOLT_LINGER,
    pts: [],
  });
};

function perpBasis(dx, dy, dz) {
  let ux = 0,
    uy = 1;
  const uz = 0;
  if (Math.abs(dy) > 0.9) {
    ux = 1;
    uy = 0;
  }
  let rx = dy * uz - dz * uy;
  let ry = dz * ux - dx * uz;
  let rz = dx * uy - dy * ux;
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const bx = ry * dz - rz * dy;
  const by = rz * dx - rx * dz;
  const bz = rx * dy - ry * dx;
  return [rx, ry, rz, bx, by, bz];
}

function dist3(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Чуть удлиняем сегменты на стыках — закрывает щели на изломах луча.
function boltSegmentEndpoints(pts, i, n, overlap) {
  const a = pts[i];
  const b = pts[i + 1];
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  let dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const p0 =
    i > 0
      ? [a[0] - dx * overlap, a[1] - dy * overlap, a[2] - dz * overlap]
      : [a[0], a[1], a[2]];
  const p1 =
    i < n - 1
      ? [b[0] + dx * overlap, b[1] + dy * overlap, b[2] + dz * overlap]
      : [b[0], b[1], b[2]];
  return [p0, p1];
}

// mat_tex (column-major) для shaft-сегмента: position.y(ширина -1..1) -> U(0..1),
// position.x(длина -1..1) -> V в диапазоне [vmid-vhalf, vmid+vhalf]. Так текстура
// молнии непрерывно тянется и прокручивается вдоль всего луча.
function shaftMatTex(vmid, vhalf) {
  return new Float32Array([0, vhalf, 0, 0, 0.5, 0, 0, 0, 0, 0, 1, 0, 0.5, vmid, 0, 1]);
}

function drawBolt(camera, b, now, alpha) {
  const W = state.Weapon;
  const shaft = W.shader_shaft;
  const glow = W.shader_noshadow_color;
  if (!shaft || !glow) return;

  const p0 = b.p0;
  const p1 = b.p1;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.2) return;
  const idx = dx / len,
    idy = dy / len,
    idz = dz / len;
  const pb = perpBasis(idx, idy, idz);
  const rx = pb[0],
    ry = pb[1],
    rz = pb[2];
  const bx = pb[3],
    by = pb[4],
    bz = pb[5];

  // Почти прямой луч с едва заметным колыханием — всю рваность молнии даёт
  // прокручиваемая текстура (weapons/shaft/bullet.png), как в оригинале.
  const N = Math.max(3, Math.min(14, Math.round(len * 0.75)));
  const amp = Math.min(0.07, len * 0.012);
  const a = b.seed;
  const pts = b.pts;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const env = Math.sin(t * Math.PI);
    const o1 = Math.sin(t * Math.PI * 2.0 + now * 0.008 + a);
    const off = o1 * amp * env;
    const q1 = Math.cos(t * Math.PI * 2.0 - now * 0.011 + a * 3.3);
    const off2 = q1 * amp * 0.6 * env;
    pts[i] = [
      p0[0] + dx * t + rx * off + bx * off2,
      p0[1] + dy * t + ry * off + by * off2,
      p0[2] + dz * t + rz * off + bz * off2,
    ];
  }
  pts.length = N + 1;

  const segLens = new Array(N);
  let totalLen = 0;
  for (let i = 0; i < N; i++) {
    segLens[i] = dist3(pts[i], pts[i + 1]);
    totalLen += segLens[i];
  }
  if (totalLen < 0.001) return;

  const c = b.color;
  const tiles = Math.max(2, totalLen / 1.8);
  const scrollA = -(now * 0.0016);
  const scrollB = -(now * 0.0029) + a;
  const segOverlap = Math.min(0.08, totalLen * 0.025);

  // 1) Широкий мягкий неоновый ореол (bloom) — даёт «неоновое» свечение вокруг.
  const haloWide = {
    vectors: [
      {
        location: glow.color,
        vec: [c[0] * 0.5 * alpha, c[1] * 0.5 * alpha, c[2] * 0.6 * alpha, 1],
      },
    ],
  };
  const haloTight = {
    vectors: [
      {
        location: glow.color,
        vec: [c[0] * 0.9 * alpha, c[1] * 0.9 * alpha, c[2] * 1.0 * alpha, 1],
      },
    ],
  };
  for (let i = 0; i < N; i++) {
    const ep = boltSegmentEndpoints(pts, i, N, segOverlap);
    Dynent.renderSegmentBeam(camera, Q2FX.tex_glow, glow, ep[0], ep[1], 0.95, haloWide);
    Dynent.renderSegmentBeam(camera, Q2FX.tex_glow, glow, ep[0], ep[1], 0.42, haloTight);
  }

  // 2) Тело молнии — UV по реальной длине дуги, без разрывов текстуры на стыках.
  const boltCol = [c[0] * 1.3 * alpha, c[1] * 1.3 * alpha, c[2] * 1.4 * alpha, 1];
  const coreCol = [1.8 * alpha, 1.9 * alpha, 2.2 * alpha, 1];
  let accA = scrollA;
  let accB = scrollB;
  for (let i = 0; i < N; i++) {
    const ep = boltSegmentEndpoints(pts, i, N, segOverlap);
    const vSpanA = (segLens[i] / totalLen) * tiles;
    const vmidA = accA + vSpanA * 0.5;
    accA += vSpanA;
    Dynent.renderSegmentBeam(camera, Q2FX.tex_bolt, shaft, ep[0], ep[1], 0.42, {
      vectors: [{ location: shaft.color, vec: boltCol }],
      mat_tex: shaftMatTex(vmidA, vSpanA * 0.5),
    });

    const vSpanB = vSpanA * 1.37;
    const vmidB = accB + vSpanB * 0.5;
    accB += vSpanB;
    Dynent.renderSegmentBeam(camera, Q2FX.tex_bolt, shaft, ep[0], ep[1], 0.16, {
      vectors: [{ location: shaft.color, vec: coreCol }],
      mat_tex: shaftMatTex(vmidB, vSpanB * 0.5),
    });
  }

  // Вспышка в точке попадания (мягкая «искра» fire.png + неоновый ореол).
  _tmp_pos.x = p1[0];
  _tmp_pos.y = p1[2];
  const flareTex = Q2FX.tex_flare || Q2FX.tex_glow;
  const flare = (0.8 + Math.random() * 0.35) * alpha;
  Dynent.render(camera, flareTex, glow, _tmp_pos, [flare, flare], 0, {
    vectors: [
      {
        location: glow.color,
        vec: [c[0] * 1.4 * alpha, c[1] * 1.4 * alpha, c[2] * 1.5 * alpha, 1],
      },
    ],
    y_anchor: 'floor',
    y_offset: p1[1],
  });
}

Q2FX.renderBolts = function (camera) {
  if (!is3D() || !Q2FX.tex_glow || !Q2FX.tex_bolt || !camera || !Q2FX.bolts.length) return;
  if (!state.Weapon || !state.Weapon.shader_shaft) return;
  const now = Date.now();
  const gl = state.gl;
  let setup = false;
  for (let i = Q2FX.bolts.length - 1; i >= 0; i--) {
    const b = Q2FX.bolts[i];
    const life = (b.expire - now) / Q2FX.BOLT_LINGER;
    if (life <= 0) {
      Q2FX.bolts.splice(i, 1);
      continue;
    }
    if (!setup) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      setup = true;
    }
    drawBolt(camera, b, now, Math.min(1, life));
  }
  if (setup) {
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
};

Q2FX.railTrail = function (start_x, start_z, end_x, end_z, color, sy, ey) {
  if (!is3D()) return;
  const dx = end_x - start_x;
  const dz = end_z - start_z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.1) return;
  const fx = dx / len;
  const fz = dz / len;
  const rx = -fz;
  const rz = fx;
  const radius = 0.22;
  const step = 0.35;
  const count = Math.min(160, Math.max(8, Math.floor(len / step)));
  const turns = Math.max(3, Math.floor(len / 3));
  const y0 = sy !== undefined ? sy : eyeH() - 0.15;
  const y1 = ey !== undefined ? ey : y0;
  const dy = y1 - y0;
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const theta = t * turns * Math.PI * 2;
    const cos_t = Math.cos(theta);
    const sin_t = Math.sin(theta);
    const px = start_x + fx * t * len + rx * cos_t * radius;
    const pz = start_z + fz * t * len + rz * cos_t * radius;
    if (!visibleFromPlayer(px, pz)) continue;
    Q2FX.spawn({
      x: px,
      y: y0 + dy * t + sin_t * radius,
      z: pz,
      color: color || [0.5, 0.7, 1.0, 1.0],
      color_end: [0.05, 0.1, 0.35, 0],
      size: 0.22,
      size_end: 0.06,
      lifetime: 650 + t * 350,
    });
  }
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const cx = start_x + fx * t * len;
    const cz = start_z + fz * t * len;
    if (!visibleFromPlayer(cx, cz)) continue;
    Q2FX.spawn({
      x: cx,
      y: y0 + dy * t,
      z: cz,
      color: [1, 1, 1, 1],
      color_end: [0.3, 0.5, 1.0, 0],
      size: 0.18,
      size_end: 0.05,
      lifetime: 250,
    });
  }
};

Q2FX.blasterTrail = function (pos, isQuad, zh) {
  if (!is3D()) return;
  const y0 = zh !== undefined ? zh : eyeH() - 0.35;
  const base = isQuad ? [1.5, 0.6, 0.2, 1] : [1.4, 1.0, 0.25, 1];
  Q2FX.spawn({
    x: pos.x + (Math.random() - 0.5) * 0.08,
    y: y0 + (Math.random() - 0.5) * 0.08,
    z: pos.y + (Math.random() - 0.5) * 0.08,
    color: base,
    color_end: [base[0] * 0.4, base[1] * 0.3, 0, 0],
    size: isQuad ? 0.5 : 0.4,
    size_end: 0.08,
    lifetime: 220,
  });
  if (Math.random() < 0.5) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.5 + Math.random() * 0.8;
    Q2FX.spawn({
      x: pos.x,
      y: y0,
      z: pos.y,
      vx: Math.cos(a) * sp,
      vy: (Math.random() - 0.3) * sp * 0.5,
      vz: Math.sin(a) * sp,
      drag: 0.9,
      color: base,
      color_end: [base[0] * 0.1, base[1] * 0.05, 0, 0],
      size: 0.1,
      size_end: 0.02,
      lifetime: 260 + Math.random() * 120,
    });
  }
};

Q2FX.plasmaTrail = function (pos, isQuad, zh) {
  if (!is3D()) return;
  const y0 = zh !== undefined ? zh : eyeH() - 0.35;
  const base = isQuad ? [1, 0.45, 0.6, 1] : [0.35, 1.0, 0.45, 1];
  Q2FX.spawn({
    x: pos.x + (Math.random() - 0.5) * 0.1,
    y: y0 + (Math.random() - 0.5) * 0.1,
    z: pos.y + (Math.random() - 0.5) * 0.1,
    color: base,
    color_end: [0, 0, 0, 0],
    size: isQuad ? 0.62 : 0.5,
    size_end: 0.1,
    lifetime: 180,
  });
};

Q2FX.rocketTrail = function (pos, zh, vel) {
  if (!is3D()) return;
  const y0 = fxClampSpawnY(zh !== undefined ? zh : eyeH() - 0.4, 0.35);
  let bx = pos.x;
  let bz = pos.y;
  let fx = 0;
  let fz = 0;
  if (vel && vel.length2 && vel.length2() > 0.01) {
    const len = Math.sqrt(vel.length2());
    fx = vel.x / len;
    fz = vel.y / len;
    bx -= fx * 0.34;
    bz -= fz * 0.34;
  }
  Q2FX.spawn({
    x: bx + (Math.random() - 0.5) * 0.08,
    y: y0 + (Math.random() - 0.5) * 0.05,
    z: bz + (Math.random() - 0.5) * 0.08,
    lock_y: y0,
    color: [3.0, 1.85, 0.65, 1],
    color_end: [0.5, 0.12, 0, 0],
    size: 0.38 + Math.random() * 0.08,
    size_end: 0.16,
    size_ease: 'outQuad',
    alpha_ease: 'outQuad',
    lifetime: 180 + Math.random() * 50,
    vx: vel ? -vel.x * 0.05 : 0,
    vz: vel ? -vel.y * 0.05 : 0,
    vy: 0,
    drag: 0.84,
    blend: 'add',
  });
  if (fx !== 0 || fz !== 0) {
    const d = randomSphereDir();
    const er = 0.16;
    const sp = 3.2 + Math.random() * 4.5;
    Q2FX.spawn({
      x: bx + d[0] * er,
      y: y0 + d[1] * er * 0.45,
      z: bz + d[2] * er,
      vx: -fx * sp + d[0] * 0.45,
      vy: d[1] * 0.35,
      vz: -fz * sp + d[2] * 0.45,
      drag: 0.83,
      gravity: 0,
      color: [3.0, 1.65, 0.55, 1],
      color_end: [1.0, 0.22, 0.02, 0],
      size: 0.1 + Math.random() * 0.06,
      size_end: 0.018,
      size_ease: 'outExpo',
      alpha_ease: 'outQuad',
      lifetime: 220 + Math.random() * 140,
      blend: 'add',
      tex: Q2FX.tex_glow,
    });
  }
  if (Math.random() < 0.45) {
    Q2FX.spawn({
      x: bx - fx * 0.1,
      y: y0,
      z: bz - fz * 0.1,
      lock_y: y0,
      vx: vel ? -vel.x * 0.025 : 0,
      vz: vel ? -vel.y * 0.025 : 0,
      vy: 0,
      drag: 0.86,
      gravity: 0,
      color: [3.2, 2.5, 1.3, 0.95],
      color_end: [1.4, 0.45, 0.08, 0],
      size: 0.08,
      size_end: 0.025,
      size_ease: 'outExpo',
      alpha_ease: 'outExpo',
      lifetime: 90 + Math.random() * 40,
      blend: 'add',
      tex: Q2FX.tex_spark,
    });
  }
  if (Math.random() < 0.28) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.14;
    const grey = 0.22 + Math.random() * 0.1;
    Q2FX.spawn({
      x: bx + Math.cos(ang) * r,
      y: y0 - 0.05,
      z: bz + Math.sin(ang) * r,
      lock_y: y0 - 0.05,
      vx: vel ? -vel.x * 0.035 : 0,
      vz: vel ? -vel.y * 0.035 : 0,
      vy: 0,
      drag: 0.88,
      gravity: 0.35,
      color: [grey, grey * 0.9, grey * 0.75, 0.42],
      color_end: [0.06, 0.05, 0.045, 0],
      size: 0.22 + Math.random() * 0.12,
      size_end: 0.5 + Math.random() * 0.14,
      size_ease: 'outCubic',
      alpha_ease: 'inQuad',
      lifetime: 420 + Math.random() * 200,
      blend: 'alpha',
      tex: Q2FX.tex_smoke,
    });
  }
};

Q2FX.zenitTrail = function (pos, zh) {
  if (!is3D()) return;
  const y0 = zh !== undefined ? zh : eyeH() - 0.35;
  Q2FX.spawn({
    x: pos.x + (Math.random() - 0.5) * 0.1,
    y: y0 + (Math.random() - 0.5) * 0.1,
    z: pos.y + (Math.random() - 0.5) * 0.1,
    color: [0.6, 0.8, 1.0, 1],
    color_end: [0.1, 0.2, 0.5, 0],
    size: 0.35,
    size_end: 0.1,
    lifetime: 280,
  });
};

Q2FX.smokePuff = function (pos, amount, sizeMul) {
  if (!is3D()) return;
  const count = amount || 6;
  const scale = sizeMul || 1.0;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.45 * scale;
    const grey = 0.28 + Math.random() * 0.2;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * r,
      y: eyeH() - 0.55 + Math.random() * 0.45,
      z: pos.y + Math.sin(ang) * r,
      vx: Math.cos(ang) * (0.25 + Math.random() * 0.35) * scale,
      vy: 0.35 + Math.random() * 0.75,
      vz: Math.sin(ang) * (0.25 + Math.random() * 0.35) * scale,
      drag: 0.94,
      gravity: 0.2,
      color: [grey, grey * 0.9, grey * 0.76, 0.42],
      color_end: [0.05, 0.045, 0.04, 0],
      size: (0.55 + Math.random() * 0.25) * scale,
      size_end: (1.6 + Math.random() * 0.7) * scale,
      lifetime: 900 + Math.random() * 600,
      blend: 'alpha',
    });
  }
};

Q2FX.projectileGlow = function (camera, bullet) {
  if (!is3D()) return false;
  const y = bullet.z !== undefined ? bullet.z : eyeH() - 0.35;
  const gl = state.gl;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  if (bullet.type === WEAPON.ROCKET) {
    renderRocketFireball(camera, bullet);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  if (bullet.type === WEAPON.PLASMA) {
    const isQuad = bullet.power === ITEM.QUAD;
    fireSphereBillboard(
      camera,
      bullet.dynent.pos.x,
      bullet.dynent.pos.y,
      y,
      isQuad ? 0.48 : 0.4,
      isQuad ? [1.2, 0.42, 0.58, 1] : [0.42, 1.2, 0.48, 1],
      0.32,
    );
    fireCoreBillboard(
      camera,
      bullet.dynent.pos.x,
      bullet.dynent.pos.y,
      y,
      isQuad ? 0.22 : 0.18,
      isQuad ? [2.2, 0.7, 1.0, 0.85] : [0.7, 2.2, 0.9, 0.85],
    );
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  const shader = state.Weapon.shader_noshadow_color;
  if (!shader || !Q2FX.tex_glow) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return false;
  }

  let color = [1.0, 0.75, 0.25, 1.0];
  let size = 0.65;
  if (bullet.type === WEAPON.ZENIT) {
    color = [0.65, 0.85, 1.45, 1.0];
    size = 0.7;
  } else if (bullet.type === WEAPON.PISTOL) {
    color = bullet.power === ITEM.QUAD ? [1.6, 0.6, 0.2, 1.0] : [1.5, 1.1, 0.3, 1.0];
    size = 0.6;
  } else {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return false;
  }

  Dynent.render(camera, Q2FX.tex_glow, shader, bullet.dynent.pos, [size, size], 0, {
    vectors: [{ location: shader.color, vec: color }],
    y_anchor: 'floor',
    y_offset: y,
  });
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return true;
};

Q2FX.impactSparks = function (pos, nx, nz, count) {
  if (!is3D()) return;
  count = count || 12;
  const eh = eyeH() - 0.35;
  for (let i = 0; i < count; i++) {
    const a = (Math.random() - 0.5) * Math.PI;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const dirX = nx * cosA - nz * sinA;
    const dirZ = nx * sinA + nz * cosA;
    const sp = 1.5 + Math.random() * 3.5;
    Q2FX.spawn({
      x: pos.x,
      y: eh + (Math.random() - 0.5) * 0.4,
      z: pos.y,
      vx: dirX * sp + (Math.random() - 0.5) * 1.0,
      vy: 1.0 + Math.random() * 3.0,
      vz: dirZ * sp + (Math.random() - 0.5) * 1.0,
      drag: 0.86,
      gravity: 10,
      color: [1.8, 1.5, 0.6, 1],
      color_end: [0.4, 0.15, 0.02, 0],
      size: 0.12 + Math.random() * 0.08,
      size_end: 0.02,
      size_ease: 'outQuad',
      alpha_ease: 'outQuad',
      lifetime: 280 + Math.random() * 320,
      tex: Q2FX.tex_spark,
      spin: Math.random() * Math.PI * 2,
      spin_rate: (Math.random() - 0.5) * 10,
    });
  }
};

Q2FX.bloodBurst = function (pos, nx, nz, isGreen) {
  if (!is3D()) return;
  const base = isGreen ? [0.3, 0.9, 0.25, 1] : [0.85, 0.12, 0.12, 1];
  const end = isGreen ? [0.05, 0.2, 0.05, 0] : [0.25, 0, 0, 0];
  const eh = eyeH() - 0.35;
  for (let i = 0; i < 18; i++) {
    const ang = Math.random() * Math.PI * 2;
    const elev = Math.random() * Math.PI * 0.7 - 0.1;
    const sp = 1.5 + Math.random() * 2.5;
    const nxL = nx + (Math.random() - 0.5) * 0.6;
    const nzL = nz + (Math.random() - 0.5) * 0.6;
    Q2FX.spawn({
      x: pos.x + (Math.random() - 0.5) * 0.2,
      y: eh + (Math.random() - 0.5) * 0.5,
      z: pos.y + (Math.random() - 0.5) * 0.2,
      vx: (nxL * 0.7 + Math.cos(ang) * 0.5) * sp,
      vy: Math.sin(elev) * sp + 1.0,
      vz: (nzL * 0.7 + Math.sin(ang) * 0.5) * sp,
      drag: 0.9,
      gravity: 12,
      color: base,
      color_end: end,
      size: 0.22 + Math.random() * 0.15,
      size_end: 0.06,
      lifetime: 500 + Math.random() * 400,
    });
  }
};

// Активные вспышки взрывов — отдаются в динамическое освещение уровня
// (Q2FX.collectLights) на пару кадров, как настоящая вспышка от взрыва.
Q2FX.explosionLights = [];

// Активные процедурные фаерболы — якоря для динамического освещения взрыва.
Q2FX.fireballs = [];

function explosionBaseY(zh) {
  return zh !== undefined ? zh : eyeH() - 0.5;
}

// В 3D высота ограничена wall_height=4.0 (см. level3d.js, bullet.js).
const FX_CEILING = 3.82;
const FX_FLOOR = 0.06;

function explosionCenterY(zh, scale) {
  const halfH = Math.min(0.32 + (scale || 1) * 0.14, 0.85);
  return fxClampSpawnY(explosionBaseY(zh), halfH);
}

function fxClampSpawnY(y, halfExtent) {
  const half = halfExtent || 0.15;
  return Math.max(FX_FLOOR + half, Math.min(y, FX_CEILING - half));
}

function fxStopVertical(obj, topExtent) {
  const top = obj.y + (topExtent || 0);
  if (top > FX_CEILING) {
    obj.y = FX_CEILING - (topExtent || 0);
    if (obj.vy > 0) obj.vy = 0;
  }
  if (obj.y < FX_FLOOR) {
    obj.y = FX_FLOOR;
    if (obj.vy < 0) obj.vy = 0;
  }
}

function fxLockHeight(obj) {
  if (obj.lock_y !== undefined) obj.y = obj.lock_y;
}

function spawnFlashCore(pos, baseY, scale, color) {
  const vfx = { vfx: 'explosion' };
  Q2FX.spawn({
    x: pos.x,
    y: baseY + 0.2,
    z: pos.y,
    color: [2.4, 1.55, 0.45, 1],
    color_end: [color[0] * 0.85, color[1] * 0.35, color[2] * 0.08, 0],
    size: 0.72 * scale,
    size_end: 2.35 * scale,
    size_ease: 'outExpo',
    alpha_ease: 'outExpo',
    lifetime: 180 + scale * 45,
    ...vfx,
  });
  Q2FX.spawn({
    x: pos.x,
    y: baseY + 0.25,
    z: pos.y,
    color: [2.2, 1.75, 1.05, 0.95],
    color_end: [color[0], color[1], color[2], 0],
    size: 0.58 * scale,
    size_end: 1.55 * scale,
    size_ease: 'outQuad',
    alpha_ease: 'inOutQuad',
    lifetime: 320 + scale * 60,
    ...vfx,
  });
  Q2FX.spawn({
    x: pos.x,
    y: baseY + 0.18,
    z: pos.y,
    color: [3.2, 2.6, 1.8, 0.75],
    color_end: [color[0] * 0.5, color[1] * 0.2, 0.04, 0],
    size: 0.28 * scale,
    size_end: 0.95 * scale,
    size_ease: 'outExpo',
    alpha_ease: 'outExpo',
    lifetime: 110 + scale * 25,
    ...vfx,
  });
}

function randomSphereDir() {
  const u = Math.random();
  const v = Math.random();
  const theta = Math.PI * 2 * u;
  const z = 2 * v - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(theta), z * 0.85, r * Math.sin(theta)];
}

// Godot GPUParticles3D-style: one-shot сферический burst мягких glow-частиц.
function spawnExplosionBurst(pos, baseY, scale, color) {
  const c = color || [1, 0.65, 0.2];
  const hot = [
    Math.min(3.8, c[0] * 3.2 + 0.9),
    Math.min(2.4, c[1] * 2.2 + 0.55),
    Math.min(0.9, c[2] * 1.6 + 0.12),
  ];
  const count = Math.min(160, Math.floor(52 + scale * 52));
  const emitR = 0.12 * scale + 0.08;
  const vfx = { vfx: 'explosion' };

  for (let i = 0; i < count; i++) {
    const d = randomSphereDir();
    const layer = Math.random();
    let velMin;
    let velMax;
    let ltMin;
    let ltMax;
    let sz0;
    let sz1;
    let drag;
    let grav;
    let col0;
    let col1;

    if (layer < 0.45) {
      velMin = 5;
      velMax = 11;
      ltMin = 520;
      ltMax = 920;
      sz0 = (0.28 + Math.random() * 0.18) * scale;
      sz1 = (0.06 + Math.random() * 0.05) * scale;
      drag = 0.88;
      grav = 4.2;
      col0 = [hot[0], hot[1], hot[2], 1];
      col1 = [c[0] * 0.35, c[1] * 0.06, 0.01, 0];
    } else if (layer < 0.78) {
      velMin = 2.5;
      velMax = 6.5;
      ltMin = 780;
      ltMax = 1400;
      sz0 = (0.32 + Math.random() * 0.2) * scale;
      sz1 = (0.1 + Math.random() * 0.06) * scale;
      drag = 0.91;
      grav = 2.8;
      col0 = [hot[0] * 0.7, hot[1] * 0.45, hot[2] * 0.18, 0.9];
      col1 = [0.08, 0.02, 0.005, 0];
    } else {
      velMin = 0.8;
      velMax = 3;
      ltMin = 900;
      ltMax = 1500;
      sz0 = (0.22 + Math.random() * 0.14) * scale;
      sz1 = (0.05 + Math.random() * 0.04) * scale;
      drag = 0.94;
      grav = 1.5;
      col0 = [hot[0] * 0.4, hot[1] * 0.22, hot[2] * 0.08, 0.65];
      col1 = [0.03, 0.008, 0.004, 0];
    }

    const sp = (velMin + Math.random() * (velMax - velMin)) * (0.85 + scale * 0.22);
    Q2FX.spawn({
      x: pos.x + d[0] * emitR,
      y: baseY + d[1] * emitR * 0.45,
      z: pos.y + d[2] * emitR,
      vx: d[0] * sp,
      vy: d[1] * sp * 0.9,
      vz: d[2] * sp,
      drag,
      gravity: grav,
      color: col0,
      color_end: col1,
      size: sz0,
      size_end: sz1,
      size_ease: 'outExpo',
      alpha_ease: layer < 0.45 ? 'inOutQuad' : 'inQuad',
      lifetime: ltMin + Math.random() * (ltMax - ltMin),
      ...vfx,
    });
  }
}

function spawnSparkShower(pos, baseY, scale, color, count) {
  const c = color || [1, 0.85, 0.35];
  const n = count || Math.floor(10 + scale * 6);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const elev = (Math.random() - 0.5) * 0.9;
    const sp = (2 + Math.random() * 5) * (0.65 + scale * 0.35);
    Q2FX.spawn({
      x: pos.x,
      y: baseY + 0.15,
      z: pos.y,
      vx: Math.cos(ang) * Math.cos(elev) * sp,
      vy: Math.sin(elev) * sp * 0.35,
      vz: Math.sin(ang) * Math.cos(elev) * sp,
      drag: 0.86,
      gravity: 12,
      color: [c[0] * 1.8, c[1] * 1.45, c[2] * 0.75, 1],
      color_end: [c[0] * 0.5, c[1] * 0.12, 0.02, 0],
      size: 0.1 + Math.random() * 0.08,
      size_end: 0.02,
      size_ease: 'outQuad',
      alpha_ease: 'outQuad',
      lifetime: 320 + Math.random() * 380,
      vfx: 'explosion',
    });
  }
}

Q2FX.spawnFireball = function (pos, color, scale, zh, lifetime) {
  if (!is3D()) return;
  const baseY = explosionCenterY(zh, scale);
  const c = color || [1.15, 0.62, 0.2];
  const lt = lifetime || Math.min(1800 + scale * 480, 3200);

  Q2FX.fireballs.push({
    x: pos.x,
    y: baseY,
    z: pos.y,
    color: c,
    scale: scale,
    born: Date.now(),
    lifetime: lt,
    seed: Math.random(),
  });

  spawnFlashCore(pos, baseY, scale * 1.15, c);
  spawnExplosionBurst(pos, baseY, scale, c);
};

Q2FX.explodeFlash = function (pos, color, bigness, zh, opts) {
  if (!is3D()) return;
  const scale = bigness || 1.2;
  const baseY = explosionCenterY(zh, scale);
  const baseColor = color || [1, 0.85, 0.4, 1];
  const heavy = scale >= 1.5;
  const skipSmoke = opts && opts.skipSmoke;

  Q2FX.spawnFireball(pos, baseColor, scale, zh, heavy ? 1400 + scale * 350 : undefined);
  spawnSparkShower(pos, baseY, scale, baseColor, Math.floor(12 + scale * 7));

  const embers = Math.floor(4 + scale * 2);
  for (let i = 0; i < embers; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 2.5;
    Q2FX.spawn({
      x: pos.x,
      y: baseY + 0.15,
      z: pos.y,
      vx: Math.cos(ang) * sp,
      vy: (Math.random() - 0.5) * 0.25,
      vz: Math.sin(ang) * sp,
      drag: 0.9,
      gravity: 6,
      color: [1.4, 0.55, 0.12, 1],
      color_end: [0.35, 0.04, 0.01, 0],
      size: 0.08 + Math.random() * 0.05,
      size_end: 0.015,
      alpha_ease: 'inQuad',
      lifetime: 600 + Math.random() * 500,
      vfx: 'explosion',
    });
  }
  if (!skipSmoke) {
    Q2FX.explodeSmoke(pos, baseY, scale, heavy, heavy ? 320 : 180);
  }

  Q2FX.explosionLights.push({
    x: pos.x,
    y: baseY + 0.35,
    z: pos.y,
    color: [baseColor[0] * 0.9 + 0.25, baseColor[1] * 0.7 + 0.15, baseColor[2] * 0.45 + 0.05],
    intensity: (0.95 + scale * 0.38) * (heavy ? 1.25 : 1),
    radius: 3.8 + scale * 1.8 + (heavy ? 2.2 : 0),
    born: Date.now(),
    lifetime: 180 + scale * 45 + (heavy ? 100 : 0),
  });
  if (Q2FX.explosionLights.length > 32) {
    Q2FX.explosionLights.splice(0, Q2FX.explosionLights.length - 32);
  }
};

// Объёмный клубящийся дым взрыва (alpha-блендинг, текстура-облако tex_smoke).
// heavy=true — плотный долгий столб дыма (для ракеты).
// extraDelay — базовая задержка появления (дым идёт после огненной вспышки).
Q2FX.explodeSmoke = function (pos, eh, scale, heavy, extraDelay) {
  const baseDelay = extraDelay || 0;
  const puffs = Math.floor((heavy ? 8 : 4) + scale * (heavy ? 5 : 3));
  for (let i = 0; i < puffs; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = (0.15 + Math.random() * 0.35) * scale;
    const inner = i < puffs * 0.35;
    const grey = inner ? 0.14 + Math.random() * 0.1 : 0.2 + Math.random() * 0.14;
    const a0 = heavy ? (inner ? 0.28 : 0.22) : 0.3;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * r,
      y: eh + 0.2 * scale + Math.random() * 0.35 * scale,
      z: pos.y + Math.sin(ang) * r,
      vx: Math.cos(ang) * (0.12 + Math.random() * 0.22) * scale,
      vy: -0.02 + Math.random() * 0.04,
      vz: Math.sin(ang) * (0.12 + Math.random() * 0.22) * scale,
      drag: 0.92,
      gravity: 0.15,
      color: [grey, grey * 0.92, grey * 0.85, a0],
      color_end: [0.03, 0.028, 0.025, 0],
      size: (0.35 + Math.random() * 0.3) * scale,
      size_end: (2.4 + Math.random() * 1.6) * scale * (heavy ? 1.2 : 1),
      lifetime: (heavy ? 2000 : 1400) + Math.random() * (heavy ? 1200 : 800),
      delay: baseDelay + (heavy ? 480 : 220) + Math.random() * (heavy ? 420 : 180),
      blend: 'alpha',
      tex: Q2FX.tex_smoke,
    });
  }
};

Q2FX.rocketExplosion = function (pos, zh) {
  if (!is3D()) return;
  const baseY = explosionCenterY(zh, 3.2);
  const fireColor = [1, 0.65, 0.18];

  Q2FX.explodeFlash(pos, [fireColor[0], fireColor[1], fireColor[2], 1], 3.2, zh, {
    skipSmoke: true,
  });

  const ringN = 16;
  for (let i = 0; i < ringN; i++) {
    const ang = (i / ringN) * Math.PI * 2 + Math.random() * 0.2;
    const sp = 5 + Math.random() * 3;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * 0.12,
      y: baseY + 0.1 + Math.random() * 0.12,
      z: pos.y + Math.sin(ang) * 0.12,
      vx: Math.cos(ang) * sp,
      vy: (Math.random() - 0.5) * 0.2,
      vz: Math.sin(ang) * sp,
      drag: 0.84,
      gravity: 12,
      color: [1.8, 1.0, 0.35, 1],
      color_end: [0.6, 0.1, 0.02, 0],
      size: 0.14 + Math.random() * 0.08,
      size_end: 0.02,
      size_ease: 'outExpo',
      alpha_ease: 'outQuad',
      lifetime: 280 + Math.random() * 200,
      vfx: 'explosion',
    });
  }

  Q2FX.explodeSmoke(pos, baseY, 2.1, true, 680);

  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.35;
    const sp = 2.8 + Math.random() * 2.2;
    const grey = 0.16 + Math.random() * 0.12;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * 0.12,
      y: baseY - 0.22 + Math.random() * 0.12,
      z: pos.y + Math.sin(ang) * 0.12,
      vx: Math.cos(ang) * sp,
      vy: -0.01 + Math.random() * 0.03,
      vz: Math.sin(ang) * sp,
      drag: 0.88,
      gravity: 0.1,
      color: [grey, grey * 0.9, grey * 0.8, 0.32],
      color_end: [0.04, 0.035, 0.03, 0],
      size: 0.32 + Math.random() * 0.22,
      size_end: 2.2 + Math.random() * 0.9,
      size_ease: 'outCubic',
      alpha_ease: 'inQuad',
      lifetime: 1200 + Math.random() * 650,
      delay: 820 + Math.random() * 350,
      blend: 'alpha',
      tex: Q2FX.tex_smoke,
    });
  }
};

// Вклад вспышек взрывов в динамическое освещение уровня. Вызывается из game.js
// перед рендером уровня (как BulletClient.collectLights).
Q2FX.collectLights = function (levelRender) {
  if (!levelRender || !levelRender.addDynamicLight) return;
  const now = Date.now();

  // Убираем протухшие fireball'ы до подсчёта лайтов.
  if (Q2FX.fireballs.length) {
    const liveFb = [];
    for (let i = 0; i < Q2FX.fireballs.length; i++) {
      const fb = Q2FX.fireballs[i];
      if ((now - fb.born) / fb.lifetime < 1) liveFb.push(fb);
    }
    Q2FX.fireballs = liveFb;
  }

  const out = [];
  for (let i = 0; i < Q2FX.explosionLights.length; i++) {
    const L = Q2FX.explosionLights[i];
    const age = now - L.born;
    if (age >= L.lifetime) continue;
    out.push(L);
    const k = 1 - age / L.lifetime;
    const fade = k * k;
    levelRender.addDynamicLight(L.x, L.y, L.z, L.color, L.intensity * fade, L.radius, 3);
  }
  Q2FX.explosionLights = out;

  if (!Q2FX.fireballs.length) return;

  const cam = state.gameClient && state.gameClient.getCamera && state.gameClient.getCamera();
  const cx = cam && cam.dynent ? cam.dynent.pos.x : 0;
  const cz = cam && cam.dynent ? cam.dynent.pos.y : 0;
  const fbLights = [];
  for (let i = 0; i < Q2FX.fireballs.length; i++) {
    const fb = Q2FX.fireballs[i];
    const age = (now - fb.born) / fb.lifetime;
    if (age >= 1) continue;
    const grow = 1 - (1 - age) * (1 - age);
    const fadeIn = Math.min(1, age / 0.14);
    const fadeOut = 1 - age;
    const master = fadeIn * fadeOut;
    if (master <= 0.02) continue;
    const fade = master * master;
    const dx = fb.x - cx;
    const dz = fb.z - cz;
    const lightScale = Math.min(fb.scale, 2.2);
    fbLights.push({
      fb,
      fade,
      lightScale,
      radius: lightScale * (1.6 + 2.4 * grow),
      dist2: dx * dx + dz * dz,
    });
  }
  fbLights.sort(function (a, b) {
    return a.dist2 - b.dist2;
  });
  const fbCap = 6;
  for (let i = 0; i < fbLights.length && i < fbCap; i++) {
    const entry = fbLights[i];
    const fb = entry.fb;
    levelRender.addDynamicLight(
      fb.x,
      fb.y + fb.scale * 1.2,
      fb.z,
      [fb.color[0] * 0.55, fb.color[1] * 0.42, fb.color[2] * 0.22],
      1.15 * entry.fade * entry.lightScale,
      entry.radius,
      3,
    );
  }
};

Q2FX.update = function () {
  if (!is3D()) {
    Q2FX.particles.length = 0;
    Q2FX.fireballs.length = 0;
    return;
  }
  const now = Date.now();
  const out = [];
  for (let i = 0; i < Q2FX.particles.length; i++) {
    const p = Q2FX.particles[i];
    if (now - p.born >= p.lifetime) continue;
    const dt_s = Math.min(0.05, Math.max(0, (now - p.last) * 0.001));
    p.last = now;
    p.x += p.vx * dt_s;
    p.y += p.vy * dt_s;
    p.z += p.vz * dt_s;
    if (p.drag !== 1.0 && dt_s > 0) {
      const k = Math.pow(p.drag, dt_s * 60);
      p.vx *= k;
      p.vy *= k;
      p.vz *= k;
    }
    if (p.gravity) p.vy -= p.gravity * dt_s;
    if (p.spin_rate) p.spin = (p.spin || 0) + p.spin_rate * dt_s;
    fxLockHeight(p);
    const halfH = p.size !== undefined ? p.size * 0.5 : 0.25;
    fxStopVertical(p, halfH);
    out.push(p);
  }
  Q2FX.particles = out;

  if (Q2FX.fireballs.length) {
    const liveFb = [];
    for (let i = 0; i < Q2FX.fireballs.length; i++) {
      const fb = Q2FX.fireballs[i];
      if ((now - fb.born) / fb.lifetime < 1) liveFb.push(fb);
    }
    Q2FX.fireballs = liveFb;
  }
};

const _tmp_pos = new Vector(0, 0);

Q2FX.renderFireballs = function (camera) {
  if (!is3D() || !camera || !Q2FX.fireballs.length) return;
  const gl = state.gl;
  const now = Date.now();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  for (let i = 0; i < Q2FX.fireballs.length; i++) {
    const fb = Q2FX.fireballs[i];
    const age = (now - fb.born) / fb.lifetime;
    if (age >= 1) continue;
    if (!visibleFromPlayer(fb.x, fb.z)) continue;

    const growT = Math.min(1, age / 0.14);
    const shrinkT = age > 0.28 ? (age - 0.28) / 0.72 : 0;
    const sizeMul = fb.scale * (0.65 + growT * 2.45) * (1 - shrinkT * 0.65);
    const fadeIn = age < 0.05 ? age / 0.05 : 1;
    const fadeOut = 1 - age;
    const alpha = fadeIn * fadeOut * fadeOut;
    if (alpha < 0.02) continue;

    const panCol = [1.55 * alpha, 0.78 * alpha, 0.18 * alpha, alpha * 1.05];
    fireSphereBillboard(camera, fb.x, fb.z, fb.y, sizeMul, panCol, 0.24 + fb.seed * 0.1);
    fireCoreBillboard(camera, fb.x, fb.z, fb.y, sizeMul * 0.34, [2.0, 0.72, 0.12, alpha * 0.72]);
    fireCoreBillboard(camera, fb.x, fb.z, fb.y + sizeMul * 0.08, sizeMul * 0.14, [
      3.2,
      2.4,
      1.2,
      alpha * 0.45,
    ]);
  }
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
};

Q2FX.render = function (camera) {
  if (!is3D()) return;
  if (!Q2FX.tex_glow) return;
  const gl = state.gl;
  const shaderBase = state.Weapon.shader_noshadow_color;
  if (!shaderBase) return;
  gl.enable(gl.BLEND);
  Q2FX.renderBolts(camera);
  Q2FX.renderFireballs(camera);
  if (!Q2FX.particles.length) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return;
  }

  const depth = Q2FX.sceneDepth();
  const screen_p = depth
    ? [1 / state.canvas.width, 1 / state.canvas.height, depth.near, depth.far]
    : null;
  const shaderSoft = depth && Q2FX.shader_soft ? Q2FX.shader_soft : shaderBase;
  const canBatch = !!(depth && Q2FX.shader_particle_batch && Q2FX._batchData);
  const batchShader = canBatch ? Q2FX.shader_particle_batch : null;

  let activeBlend = null;
  let batchVert = 0;
  let batchTex = null;
  let batchOff = 0;
  const now = Date.now();

  const flushBatch = () => {
    if (!batchVert) return;
    flushParticleBatch(gl, batchShader, batchTex, depth, screen_p, batchVert);
    batchVert = 0;
    batchOff = 0;
  };

  for (let i = 0; i < Q2FX.particles.length; i++) {
    const p = Q2FX.particles[i];
    const t = (now - p.born) / p.lifetime;
    if (t < 0 || t > 1) continue;
    if (!p.vfx && p.blend !== 'add' && !particleInRange(p.x, p.z)) continue;
    const sizeT = vfxEase(p.size_ease || 'linear', t);
    const alphaT = vfxEase(p.alpha_ease || 'linear', t);
    const sz = p.size + (p.size_end - p.size) * sizeT;
    const flat = p.flat || 0;
    const sx = flat > 0 ? sz * flat : sz;
    const sy = flat > 0 ? sz / flat : sz;
    const rgba = [
      p.color[0] + (p.color_end[0] - p.color[0]) * alphaT,
      p.color[1] + (p.color_end[1] - p.color[1]) * alphaT,
      p.color[2] + (p.color_end[2] - p.color[2]) * alphaT,
      p.color[3] + (p.color_end[3] - p.color[3]) * alphaT,
    ];
    if (!visibleFromPlayer(p.x, p.z)) continue;

    const nextBlend = p.blend === 'alpha' ? 'alpha' : 'add';
    if (activeBlend !== nextBlend) {
      flushBatch();
      if (nextBlend === 'alpha') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE);
      activeBlend = nextBlend;
    }

    const tex = p.tex || Q2FX.tex_glow;
    const texId = tex instanceof Object && tex.getId ? tex.getId() : tex;
    if (texId === null) continue;

    if (canBatch && shaderSoft === Q2FX.shader_soft && p.blend !== 'add' && !p.vfx) {
      if (batchVert > 0 && batchTex !== texId) flushBatch();
      batchTex = texId;
      batchOff = pushBillboardVerts(
        Q2FX._batchData,
        batchOff,
        camera,
        p.x,
        p.y,
        p.z,
        sx * 0.5,
        sy * 0.5,
        p.spin || 0,
        rgba,
      );
      batchVert += 6;
      if (batchVert >= Q2FX._batchVertMax) flushBatch();
      continue;
    }

    renderParticleFallback(camera, p, shaderSoft, shaderBase, screen_p, depth, rgba, sx, sy);
  }
  flushBatch();
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
};

Event.on('cl_lineshoot', function (bullet) {
  if (!is3D()) return;
  const owner_x = bullet.dynent.pos.x * 2 - bullet.dest.x;
  const owner_z = bullet.dynent.pos.y * 2 - bullet.dest.y;
  const muz = muzzleWorld(owner_x, owner_z, bullet.dynent.angle);
  const start_x = muz.x;
  const start_z = muz.z;
  const isRail = bullet.type === WEAPON.RAIL;
  const flashColor = isRail ? [0.55, 0.75, 1.0, 1] : [1, 0.9, 0.55, 1];
  Q2FX.muzzleFlash({ x: owner_x, y: owner_z }, bullet.dynent.angle, flashColor);
  const muz_y = muz.y;
  const dest_y = bullet.dest_z !== undefined && bullet.dest_z > 0 ? bullet.dest_z : muz_y;
  if (isRail) {
    const color = bullet.power === ITEM.QUAD ? [1, 0.4, 0.45, 1] : [0.5, 0.7, 1.0, 1];
    Q2FX.railTrail(start_x, start_z, bullet.dest.x, bullet.dest.y, color, muz_y, dest_y);
  } else if (bullet.type === WEAPON.PISTOL) {
    const c = bullet.power === ITEM.QUAD ? [1.4, 0.7, 0.3, 1] : [1.4, 1.1, 0.5, 1];
    Q2FX.tracer(start_x, start_z, bullet.dest.x, bullet.dest.y, c, 180, 0.25, muz_y, dest_y);
  }
});

Event.on('cl_bulletshoot', function (bullet) {
  if (!is3D()) return;
  let color = [1, 0.9, 0.55, 1];
  if (bullet.type === WEAPON.PLASMA) color = [0.5, 1.0, 0.5, 1];
  else if (bullet.type === WEAPON.ROCKET) color = [1, 0.6, 0.2, 1];
  else if (bullet.type === WEAPON.ZENIT) color = [0.7, 0.8, 1.0, 1];
  Q2FX.muzzleFlash(bullet.dynent.pos, bullet.dynent.angle, color);
});

Event.on('cl_bulletlinecollide', function (bullet, dest, norm_dir) {
  if (!is3D()) return;
  if (!visibleFromPlayer(dest.x, dest.y)) return;
  const lvl = state.gameClient.getLevelRender().getLevel();
  if (lvl.collideLava(dest) && !lvl.getCollideBridges(dest)) return;
  if (bullet.type === WEAPON.PISTOL) {
    Q2FX.impactSparks({ x: dest.x, y: dest.y }, norm_dir.x, norm_dir.y, 10);
  } else if (bullet.type === WEAPON.RAIL) {
    Q2FX.impactSparks({ x: dest.x, y: dest.y }, norm_dir.x, norm_dir.y, 22);
    Q2FX.explodeFlash({ x: dest.x, y: dest.y }, [0.55, 0.75, 1.0, 1], 0.7);
  }
});

Event.on('cl_bulletdead', function (bullet) {
  if (!is3D()) return;
  // Не показываем взрыв, если точка гибели снаряда за стеной/в тумане от игрока.
  const dp = bullet.dynent && bullet.dynent.pos;
  if (dp && !visibleFromPlayer(dp.x, dp.y)) return;
  if (bullet.type === WEAPON.PLASMA) {
    const isQuad = bullet.power === ITEM.QUAD;
    Q2FX.explodeFlash(
      bullet.dynent.pos,
      isQuad ? [1, 0.5, 0.6, 1] : [0.5, 1.0, 0.5, 1],
      isQuad ? 1.35 : 1.05,
      bullet.z,
    );
  } else if (bullet.type === WEAPON.ROCKET) {
    Q2FX.rocketExplosion(bullet.dynent.pos, bullet.z);
  } else if (bullet.type === WEAPON.PISTOL) {
    const isQuad = bullet.power === ITEM.QUAD;
    Q2FX.explodeFlash(
      bullet.dynent.pos,
      isQuad ? [1.6, 0.6, 0.2, 1] : [1.4, 1.05, 0.3, 1],
      0.65,
      bullet.z,
    );
  }
});

Event.on('cl_botpain', function (pos, dir, id) {
  if (!is3D()) return;
  const isMutant = state.Bot && state.Bot.isMutant && state.Bot.isMutant(id);
  Q2FX.bloodBurst({ x: pos.x, y: pos.y }, dir.x, dir.y, isMutant);
});

Event.on('cl_botdead', function (pos, dir, id) {
  if (!is3D()) return;
  const isMutant = state.Bot && state.Bot.isMutant && state.Bot.isMutant(id);
  for (let i = 0; i < 3; i++) {
    Q2FX.bloodBurst({ x: pos.x, y: pos.y }, dir.x, dir.y, isMutant);
  }
});

state.Q2FX = Q2FX;

export { Q2FX };
