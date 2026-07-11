import { Event } from '@/core/event.js';
import { state } from '@/core/runtime-state.js';

import { Shader } from '@/engine/shader.js';


const SPAWN_ANIM_MS = 2200;

const CIRCLE_IN_MS = 380;
const PILLAR_START_MS = 320;
const PILLAR_GROW_MS = 780;
const FADE_START_MS = PILLAR_START_MS + PILLAR_GROW_MS;
const FADE_OUT_MS = SPAWN_ANIM_MS - FADE_START_MS;
const BOT_IN_START_MS = PILLAR_START_MS + 80;
const BOT_IN_MS = 1300;

const RING_RADIUS = 0.82;
const RING_STROKE = 0.055;
const CYL_SEGMENTS = 48;

const spawns = [];
let cylinderMesh = null;

function easeInOut(t) {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function ringWorldScale(circleDraw) {
  return 1.05 + circleDraw * 0.12;
}

function ringWorldRadius(circleDraw) {
  return ringWorldScale(circleDraw) * RING_RADIUS;
}

function spawnTiming(t0) {
  const t = Date.now() - t0;
  if (t < 0 || t >= SPAWN_ANIM_MS) return null;

  const outFade = t >= FADE_START_MS ? 1 - easeInOut((t - FADE_START_MS) / FADE_OUT_MS) : 1;

  let circleDraw = 0;
  if (t < CIRCLE_IN_MS) {
    circleDraw = easeInOut(t / CIRCLE_IN_MS);
  } else {
    circleDraw = 1;
  }
  const circle = circleDraw * outFade;

  let pillarH = 0;
  let pillarA = 0;
  if (t >= PILLAR_START_MS) {
    if (t < FADE_START_MS) {
      const p = easeInOut((t - PILLAR_START_MS) / PILLAR_GROW_MS);
      pillarH = 0.12 + p * 3.65;
      pillarA = 0.2 + p * 0.35;
    } else {
      pillarH = 3.77;
      pillarA = 0.45 * outFade;
    }
  }

  let botA = 0;
  let botScale = 0.78;
  if (t >= BOT_IN_START_MS) {
    const p = easeInOut(Math.min(1, (t - BOT_IN_START_MS) / BOT_IN_MS));
    botA = p;
    botScale = 0.78 + 0.22 * p;
  }

  return { circle, circleDraw, pillarH, pillarA, botA, botScale, outFade };
}

function ensureRingShader() {
  if (SpawnFx.shader_ring) return SpawnFx.shader_ring;
  const vert = `
    attribute vec2 position;
    uniform mat4 mat_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = position;
      gl_Position = mat_pos * vec4(position, 0.0, 1.0);
    }`;
  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 ring_p;
    varying vec2 v_uv;

    void main() {
      float r = length(v_uv);
      float ringR = ring_p.x;
      float stroke = ring_p.y;
      float sweep = ring_p.z;
      float master = ring_p.w;

      float d = abs(r - ringR);
      float core = exp(-d * d / (stroke * stroke * 0.22));
      float mid = exp(-d * d / (stroke * stroke * 0.9));
      float halo = exp(-d * d / (stroke * stroke * 3.2));

      const float TAU = 6.2831853;
      float ang = atan(v_uv.y, v_uv.x);
      float head = mod(ang + 3.14159265, TAU);

      float arc = 1.0;
      if (sweep < 0.998) {
        float sweepAng = sweep * TAU;
        arc = 1.0 - smoothstep(sweepAng - 0.12, sweepAng + 0.04, head);
      }

      float pulse = 0.88 + 0.12 * sin(ang * 7.0 + sweep * 18.0);
      vec3 hotCore = vec3(1.0, 1.0, 0.72);
      vec3 midCol = vec3(1.0, 0.88, 0.22);
      vec3 outer = vec3(1.0, 0.62, 0.05);

      vec3 col = outer * halo * 0.55 + midCol * mid * 0.85 + hotCore * core * 1.35;
      float a = (core * 1.5 + mid * 0.9 + halo * 0.45) * arc * master * pulse;
      if (a < 0.004) discard;
      gl_FragColor = vec4(col * a, a);
    }`;
  SpawnFx.shader_ring = new Shader(vert, frag, ['mat_pos', 'ring_p']);
  return SpawnFx.shader_ring;
}

function ensurePillarShader() {
  if (SpawnFx.shader_pillar) return SpawnFx.shader_pillar;
  const vert = `
    attribute vec3 position;
    attribute vec2 texuv;
    uniform mat4 mat_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = texuv;
      gl_Position = mat_pos * vec4(position, 1.0);
    }`;
  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 pillar_p;
    varying vec2 v_uv;

    void main() {
      float t = pillar_p.x;
      float master = pillar_p.y;
      float grow = pillar_p.z;

      float u = v_uv.x;
      float h = v_uv.y;
      if (h > grow + 0.012) discard;

      float ang = u * 6.2831853;

      float vBand = fract(h * 4.5 - t * 2.2);
      float vertStripe = 1.0 - smoothstep(0.0, 0.07, abs(vBand - 0.5));

      float hBand = fract(h * 3.0 - t * 1.6 + ang * 0.9);
      float helix = 1.0 - smoothstep(0.0, 0.09, abs(hBand - 0.5));

      float ripple = sin(h * 20.0 - t * 8.0 + ang * 5.0) * 0.5 + 0.5;
      ripple = 1.0 - smoothstep(0.0, 0.12, abs(ripple - 0.82));

      float band = max(max(vertStripe, helix), ripple);
      if (band < 0.25) discard;

      vec3 col = mix(vec3(1.0, 0.72, 0.1), vec3(1.0, 0.98, 0.82), band);
      float topFade = 1.0 - smoothstep(grow * 0.9, grow, h);
      float baseFade = smoothstep(0.0, 0.04, h);
      float alpha = band * master * 0.72 * topFade * baseFade;
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(col, alpha);
    }`;
  SpawnFx.shader_pillar = new Shader(vert, frag, ['mat_pos', 'pillar_p']);
  return SpawnFx.shader_pillar;
}

function ensureCylinderMesh() {
  if (cylinderMesh && cylinderMesh.segments === CYL_SEGMENTS) return cylinderMesh;
  const gl = state.gl;
  const rings = CYL_SEGMENTS + 1;
  const verts = new Float32Array(rings * 2 * 5);
  let k = 0;
  for (let i = 0; i < rings; i++) {
    const u = i / CYL_SEGMENTS;
    const ang = u * Math.PI * 2;
    const cx = Math.cos(ang);
    const cz = Math.sin(ang);
    verts[k++] = cx;
    verts[k++] = 0;
    verts[k++] = cz;
    verts[k++] = u;
    verts[k++] = 0;
    verts[k++] = cx;
    verts[k++] = 1;
    verts[k++] = cz;
    verts[k++] = u;
    verts[k++] = 1;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  cylinderMesh = { buffer, count: rings * 2, stride: 5, segments: CYL_SEGMENTS };
  return cylinderMesh;
}

function drawFloorRing(x, z, timing) {
  const gl = state.gl;
  const mat4 = state.mat4;
  const sh = ensureRingShader();
  const scale = ringWorldScale(timing.circleDraw);
  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [x, 0.045, z]);
  mat4.rotateX(m, m, -Math.PI * 0.5);
  mat4.scale(m, m, [scale, scale, 1]);
  const matPos = mat4.create();
  mat4.multiply(matPos, state.viewProj3D, m);

  sh.use();
  sh.matrix(sh.mat_pos, matPos);
  sh.vector(sh.ring_p, [RING_RADIUS, RING_STROKE, timing.circleDraw, timing.circle]);

  gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawLightPillar(x, z, timing) {
  if (timing.pillarH <= 0.01 || timing.pillarA <= 0.01) return;
  const gl = state.gl;
  const mat4 = state.mat4;
  const sh = ensurePillarShader();
  const mesh = ensureCylinderMesh();
  const now = Date.now() * 0.001;
  const radius = ringWorldRadius(timing.circleDraw);
  const grow = Math.min(1, timing.pillarH / 3.77);

  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [x, 0.045, z]);
  mat4.scale(m, m, [radius, timing.pillarH, radius]);
  const matPos = mat4.create();
  mat4.multiply(matPos, state.viewProj3D, m);

  const posLoc = sh.attrib('position');
  const uvLoc = sh.attrib('texuv');
  const stride = mesh.stride * 4;

  sh.use();
  sh.matrix(sh.mat_pos, matPos);
  sh.vector(sh.pillar_p, [now, timing.pillarA, grow, 0]);

  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 3 * 4);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, mesh.count);

  gl.disableVertexAttribArray(uvLoc);
  if (posLoc !== 0) gl.disableVertexAttribArray(posLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

function drawSpawnEffect(x, z, timing, pass) {
  if (pass === 'floor' || pass === 'all') {
    if (timing.circle > 0.01) drawFloorRing(x, z, timing);
  }
  if (pass === 'pillar' || pass === 'all') {
    drawLightPillar(x, z, timing);
  }
}

function withFloorBlend(fn) {
  const gl = state.gl;
  const prevBlend = gl.isEnabled(gl.BLEND);
  const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  const prevCull = gl.isEnabled(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  fn();
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  if (!prevBlend) gl.disable(gl.BLEND);
  gl.depthMask(prevDepthMask);
  if (prevCull) gl.enable(gl.CULL_FACE);
}

function withPillarBlend(fn) {
  const gl = state.gl;
  const prevBlend = gl.isEnabled(gl.BLEND);
  const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  const prevCull = gl.isEnabled(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);
  fn();
  if (prevDepthTest) gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);
  if (!prevBlend) gl.disable(gl.BLEND);
  gl.depthMask(prevDepthMask);
  if (prevCull) gl.enable(gl.CULL_FACE);
}

function forEachSpawn(pass, drawFn) {
  for (let i = spawns.length - 1; i >= 0; i--) {
    const s = spawns[i];
    const timing = spawnTiming(s.t0);
    if (!timing) {
      spawns.splice(i, 1);
      continue;
    }
    drawFn(s.x, s.z, timing, pass);
  }
}

const SpawnFx = {
  shader_ring: null,
  shader_pillar: null,

  start(x, z) {
    spawns.push({ x, z, t0: Date.now() });
  },

  botAppearance(spawnStartTime) {
    if (!spawnStartTime) return { alpha: 1, scale: 1, spawning: false };
    const timing = spawnTiming(spawnStartTime);
    if (!timing) return { alpha: 1, scale: 1, spawning: false };
    return {
      alpha: timing.botA,
      scale: timing.botScale,
      spawning: true,
    };
  },

  renderAt(camera, x, z, spawnStartTime, pass = 'all') {
    if (!state.quadBuffer || !state.viewProj3D || !spawnStartTime) return false;
    const timing = spawnTiming(spawnStartTime);
    if (!timing) return false;
    if (pass === 'pillar') {
      withPillarBlend(function () {
        drawSpawnEffect(x, z, timing, 'pillar');
      });
    } else if (pass === 'floor') {
      withFloorBlend(function () {
        drawSpawnEffect(x, z, timing, 'floor');
      });
    } else {
      withFloorBlend(function () {
        drawSpawnEffect(x, z, timing, 'floor');
      });
      withPillarBlend(function () {
        drawSpawnEffect(x, z, timing, 'pillar');
      });
    }
    return true;
  },

  render(camera, pass = 'all') {
    if (!spawns.length || !state.quadBuffer || !state.viewProj3D) return;
    if (pass === 'floor' || pass === 'all') {
      withFloorBlend(function () {
        forEachSpawn(pass === 'all' ? 'floor' : pass, drawSpawnEffect);
      });
    }
    if (pass === 'pillar' || pass === 'all') {
      withPillarBlend(function () {
        forEachSpawn(pass === 'all' ? 'pillar' : pass, drawSpawnEffect);
      });
    }
  },
};

Event.on('cl_botrespawn', function (pos) {
  if (pos) SpawnFx.start(pos.x, pos.y);
});

export { SpawnFx };
