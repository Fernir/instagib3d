import { Texture } from '../engine/texture.js';
import { state } from '../runtime-state.js';
import { WEAPON, ITEM } from '../server/game/global.js';
import { Buffer } from '../server/libs/buffer.js';
import { Event } from '../server/libs/event.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent } from '../server/objects/dynent.js';

class Q2FX {}

Q2FX.particles = [];
Q2FX.tex_glow = null;
Q2FX.MAX_PARTICLES = 2000;

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

  // Мягкая «клубящаяся» текстура дыма: RGB=белый (тинт идёт из color частицы),
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
};

function is3D() {
  return !!(state.LevelRender && state.LevelRender.isFirstPerson3D);
}

function eyeH() {
  return (state.LevelRender && state.LevelRender.eye_height) || 1.6;
}

function fogFromPlayer(wx, wz) {
  if (!is3D()) return 0;
  const lr = state.LevelRender;
  const gc = state.gameClient;
  if (!lr || !lr.getWorldFog || !gc) return 0;
  const cam = gc.getCamera && gc.getCamera();
  if (!cam) return 0;
  return lr.getWorldFog(cam.dynent.pos, { x: wx, y: wz });
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
  return fogFromPlayer(wx, wz) < 0.88 && losFromPlayer(wx, wz);
}

Q2FX.spawn = function (opts) {
  if (Q2FX.particles.length >= Q2FX.MAX_PARTICLES) {
    Q2FX.particles.splice(0, 32);
  }
  Q2FX.particles.push({
    x: opts.x,
    y: opts.y,
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
    born: Date.now(),
    last: Date.now(),
  });
};

Q2FX.muzzleFlash = function (pos, angle, color) {
  if (!is3D()) return;
  const m = muzzleWorld(pos.x, pos.y, angle);
  const gx = m.x;
  const gy = m.y;
  const gz = m.z;
  Q2FX.spawn({
    x: gx,
    y: gy,
    z: gz,
    color: color || [1, 0.9, 0.55, 1.0],
    color_end: [1, 0.4, 0.05, 0],
    size: 0.6,
    size_end: 1.8,
    lifetime: 110,
  });
  Q2FX.spawn({
    x: gx,
    y: gy,
    z: gz,
    color: [1, 1, 0.9, 1],
    color_end: [1, 0.6, 0.1, 0],
    size: 0.3,
    size_end: 0.8,
    lifetime: 80,
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
  const N = Math.max(2, Math.min(8, Math.round(len * 0.6)));
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

  const c = b.color;
  const tiles = Math.max(2, len / 1.8);
  const vhalf = tiles / (2 * N);
  const scrollA = -(now * 0.0016);
  const scrollB = -(now * 0.0029) + a;

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
    Dynent.renderSegmentBeam(camera, Q2FX.tex_glow, glow, pts[i], pts[i + 1], 0.95, haloWide);
    Dynent.renderSegmentBeam(camera, Q2FX.tex_glow, glow, pts[i], pts[i + 1], 0.42, haloTight);
  }

  // 2) Тело молнии — текстура, прокручиваемая вдоль луча (неоновый оттенок).
  const boltCol = [c[0] * 1.3 * alpha, c[1] * 1.3 * alpha, c[2] * 1.4 * alpha, 1];
  // 3) Яркое бело-горячее ядро — та же текстура другой частоты для мерцания.
  const coreCol = [1.8 * alpha, 1.9 * alpha, 2.2 * alpha, 1];
  for (let i = 0; i < N; i++) {
    const vmidA = ((i + 0.5) / N) * tiles + scrollA;
    Dynent.renderSegmentBeam(camera, Q2FX.tex_bolt, shaft, pts[i], pts[i + 1], 0.42, {
      vectors: [{ location: shaft.color, vec: boltCol }],
      mat_tex: shaftMatTex(vmidA, vhalf),
    });
    const vmidB = ((i + 0.5) / N) * tiles * 1.37 + scrollB;
    Dynent.renderSegmentBeam(camera, Q2FX.tex_bolt, shaft, pts[i], pts[i + 1], 0.16, {
      vectors: [{ location: shaft.color, vec: coreCol }],
      mat_tex: shaftMatTex(vmidB, vhalf * 1.37),
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
  if (Math.random() < 0.65) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.8 + Math.random() * 1.4;
    Q2FX.spawn({
      x: pos.x,
      y: y0,
      z: pos.y,
      vx: Math.cos(a) * sp,
      vy: (Math.random() - 0.2) * sp,
      vz: Math.sin(a) * sp,
      drag: 0.88,
      color: base,
      color_end: [base[0] * 0.08, base[1] * 0.08, base[2] * 0.08, 0],
      size: 0.14,
      size_end: 0.03,
      lifetime: 220 + Math.random() * 120,
    });
  }
};

Q2FX.rocketTrail = function (pos, zh) {
  if (!is3D()) return;
  const y0 = zh !== undefined ? zh : eyeH() - 0.4;
  Q2FX.spawn({
    x: pos.x + (Math.random() - 0.5) * 0.1,
    y: y0 + (Math.random() - 0.5) * 0.15,
    z: pos.y + (Math.random() - 0.5) * 0.1,
    color: [1, 0.95, 0.5, 1],
    color_end: [0.6, 0.1, 0, 0],
    size: 0.5,
    size_end: 0.2,
    lifetime: 240,
  });
  for (let i = 0; i < 2; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.25;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * r,
      y: y0 + Math.random() * 0.3,
      z: pos.y + Math.sin(ang) * r,
      vx: Math.cos(ang) * 0.3,
      vy: 0.2 + Math.random() * 0.3,
      vz: Math.sin(ang) * 0.3,
      drag: 0.92,
      color: [1, 0.6, 0.2, 1],
      color_end: [0.2, 0.05, 0, 0],
      size: 0.15,
      size_end: 0.04,
      lifetime: 500 + Math.random() * 300,
    });
  }
  for (let i = 0; i < 2; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.22;
    const grey = 0.32 + Math.random() * 0.18;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * r,
      y: y0 - 0.05 + Math.random() * 0.25,
      z: pos.y + Math.sin(ang) * r,
      vx: Math.cos(ang) * 0.22,
      vy: 0.25 + Math.random() * 0.35,
      vz: Math.sin(ang) * 0.22,
      drag: 0.95,
      gravity: -0.6,
      color: [grey, grey * 0.9, grey * 0.75, 0.45],
      color_end: [0.06, 0.05, 0.045, 0],
      size: 0.45 + Math.random() * 0.18,
      size_end: 1.25 + Math.random() * 0.35,
      lifetime: 900 + Math.random() * 350,
      blend: 'alpha',
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
      gravity: -0.35,
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
  if (!is3D() || !Q2FX.tex_glow) return false;
  const shader = state.Weapon.shader_noshadow_color;
  if (!shader) return false;

  let color = [1.0, 0.75, 0.25, 1.0];
  let size = 0.65;
  if (bullet.type === WEAPON.PLASMA) {
    color = bullet.power === ITEM.QUAD ? [1.5, 0.55, 0.7, 1.0] : [0.35, 1.25, 0.5, 1.0];
    size = bullet.power === ITEM.QUAD ? 0.95 : 0.72;
  } else if (bullet.type === WEAPON.ZENIT) {
    color = [0.65, 0.85, 1.45, 1.0];
    size = 0.7;
  } else if (bullet.type === WEAPON.ROCKET) {
    color = [1.5, 0.8, 0.25, 1.0];
    size = 0.8;
  } else if (bullet.type === WEAPON.PISTOL) {
    color = bullet.power === ITEM.QUAD ? [1.6, 0.6, 0.2, 1.0] : [1.5, 1.1, 0.3, 1.0];
    size = 0.6;
  } else {
    return false;
  }

  const gl = state.gl;
  gl.blendFunc(gl.ONE, gl.ONE);
  const z = bullet.z !== undefined ? bullet.z : eyeH() - 0.35;
  Dynent.render(camera, Q2FX.tex_glow, shader, bullet.dynent.pos, [size, size], 0, {
    vectors: [{ location: shader.color, vec: color }],
    y_anchor: 'floor',
    y_offset: z,
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
      color: [1, 0.9, 0.4, 1],
      color_end: [1, 0.25, 0.05, 0],
      size: 0.12,
      size_end: 0.04,
      lifetime: 500 + Math.random() * 400,
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

Q2FX.explodeFlash = function (pos, color, bigness) {
  if (!is3D()) return;
  const eh = eyeH() - 0.5;
  const scale = bigness || 1.2;
  const baseColor = color || [1, 0.85, 0.4, 1];

  // 1) Бело-горячее ядро — очень короткая яркая вспышка в центре.
  Q2FX.spawn({
    x: pos.x,
    y: eh,
    z: pos.y,
    color: [1.6, 1.5, 1.2, 1],
    color_end: [1.4, 0.5, 0.12, 0],
    size: scale * 0.9,
    size_end: scale * 2.2,
    lifetime: 140,
  });
  // 2) Огненный шар — несколько слоёв клубящегося пламени.
  const fireballs = Math.floor(4 + scale * 3);
  for (let i = 0; i < fireballs; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.35 * scale;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * r,
      y: eh + (Math.random() - 0.3) * 0.4 * scale,
      z: pos.y + Math.sin(ang) * r,
      vx: Math.cos(ang) * (0.6 + Math.random()) * scale,
      vy: 0.6 + Math.random() * 1.2,
      vz: Math.sin(ang) * (0.6 + Math.random()) * scale,
      drag: 0.8,
      gravity: -0.5,
      color: [1.5, 0.9 + Math.random() * 0.3, 0.35, 1],
      color_end: [0.6, 0.12, 0.03, 0],
      size: (0.6 + Math.random() * 0.4) * scale,
      size_end: (1.3 + Math.random() * 0.6) * scale,
      lifetime: 350 + Math.random() * 300,
    });
  }
  // 3) Раскалённые осколки/искры — быстрые стримеры с гравитацией.
  const sparks = Math.floor(18 + scale * 12);
  for (let i = 0; i < sparks; i++) {
    const ang = Math.random() * Math.PI * 2;
    const elev = Math.random() * 1.1 - 0.1;
    const sp = (3 + Math.random() * 7) * (0.7 + scale * 0.3);
    Q2FX.spawn({
      x: pos.x,
      y: eh + 0.3,
      z: pos.y,
      vx: Math.cos(ang) * Math.cos(elev) * sp,
      vy: Math.sin(elev) * sp + 1.5,
      vz: Math.sin(ang) * Math.cos(elev) * sp,
      drag: 0.86,
      gravity: 11,
      color: [1, 0.85, 0.35, 1],
      color_end: [1, 0.25, 0.04, 0],
      size: 0.14 + Math.random() * 0.1,
      size_end: 0.03,
      lifetime: 500 + Math.random() * 500,
    });
  }
  // 4) Тлеющие угли — медленно гаснущие точки, долетают и тухнут.
  const embers = Math.floor(6 + scale * 4);
  for (let i = 0; i < embers; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 2.5;
    Q2FX.spawn({
      x: pos.x,
      y: eh + 0.2,
      z: pos.y,
      vx: Math.cos(ang) * sp,
      vy: 1.5 + Math.random() * 2.0,
      vz: Math.sin(ang) * sp,
      drag: 0.9,
      gravity: 3.5,
      color: [1.4, 0.55, 0.15, 1],
      color_end: [0.5, 0.06, 0.02, 0],
      size: 0.1 + Math.random() * 0.06,
      size_end: 0.02,
      lifetime: 900 + Math.random() * 700,
    });
  }
  // 5) Клубы дыма — поднимаются, разрастаются, висят дольше всего.
  Q2FX.explodeSmoke(pos, eh, scale);

  // 6) Вспышка света от взрыва.
  Q2FX.explosionLights.push({
    x: pos.x,
    y: eh + 0.4,
    z: pos.y,
    color: [baseColor[0] * 1.6 + 0.6, baseColor[1] * 1.2 + 0.3, baseColor[2] * 0.8 + 0.1],
    intensity: 2.2 + scale * 1.2,
    radius: 5.5 + scale * 3.5,
    born: Date.now(),
    lifetime: 260 + scale * 60,
  });
};

// Объёмный клубящийся дым взрыва (alpha-блендинг, текстура-облако tex_smoke).
// heavy=true — плотный долгий столб дыма (для ракеты).
Q2FX.explodeSmoke = function (pos, eh, scale, heavy) {
  const puffs = Math.floor((heavy ? 10 : 5) + scale * (heavy ? 7 : 4));
  for (let i = 0; i < puffs; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.5 * scale;
    // тёмное ядро дыма + более светлые внешние клубы
    const inner = i < puffs * 0.45;
    const grey = inner ? 0.1 + Math.random() * 0.1 : 0.2 + Math.random() * 0.18;
    const a0 = heavy ? (inner ? 0.72 : 0.5) : 0.5;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * r,
      y: eh + 0.1 + Math.random() * 0.5 * scale,
      z: pos.y + Math.sin(ang) * r,
      vx: Math.cos(ang) * (0.3 + Math.random() * 0.6) * scale,
      vy: (heavy ? 0.8 : 0.5) + Math.random() * (heavy ? 1.5 : 0.9),
      vz: Math.sin(ang) * (0.3 + Math.random() * 0.6) * scale,
      drag: 0.9,
      gravity: -0.45,
      color: [grey, grey * 0.92, grey * 0.85, a0],
      color_end: [0.03, 0.028, 0.025, 0],
      size: (0.7 + Math.random() * 0.5) * scale,
      size_end: (2.2 + Math.random() * 1.4) * scale * (heavy ? 1.25 : 1),
      lifetime: (heavy ? 1800 : 1300) + Math.random() * (heavy ? 1400 : 900),
      blend: 'alpha',
      tex: Q2FX.tex_smoke,
    });
  }
};

// Большой взрыв ракеты: пламя/искры/угли/вспышка света + плотный объёмный дым
// и стелющееся по полу пыльно-дымное кольцо. Заметно «жирнее» обычной вспышки.
Q2FX.rocketExplosion = function (pos) {
  if (!is3D()) return;
  const eh = eyeH() - 0.5;

  // Базовая огненная вспышка (ядро, файерболы, искры, угли, свет, дым).
  Q2FX.explodeFlash(pos, [1, 0.7, 0.25, 1], 1.8);
  // Дополнительный плотный столб дыма поверх базового — даёт объём.
  Q2FX.explodeSmoke(pos, eh, 2.0, true);

  // Стелющееся по земле дымно-пыльное кольцо (ударная волна).
  const ringN = 16;
  for (let i = 0; i < ringN; i++) {
    const ang = (i / ringN) * Math.PI * 2 + Math.random() * 0.3;
    const sp = 4.5 + Math.random() * 2.5;
    const grey = 0.22 + Math.random() * 0.16;
    Q2FX.spawn({
      x: pos.x + Math.cos(ang) * 0.2,
      y: eh - 0.35 + Math.random() * 0.2,
      z: pos.y + Math.sin(ang) * 0.2,
      vx: Math.cos(ang) * sp,
      vy: 0.2 + Math.random() * 0.4,
      vz: Math.sin(ang) * sp,
      drag: 0.82,
      gravity: -0.2,
      color: [grey, grey * 0.9, grey * 0.8, 0.55],
      color_end: [0.04, 0.035, 0.03, 0],
      size: 0.5 + Math.random() * 0.4,
      size_end: 2.4 + Math.random() * 1.2,
      lifetime: 900 + Math.random() * 700,
      blend: 'alpha',
      tex: Q2FX.tex_smoke,
    });
  }

  // Яркое раскалённое ядро-вспышка (быстро гаснет) — «бабах».
  Q2FX.spawn({
    x: pos.x,
    y: eh + 0.2,
    z: pos.y,
    color: [1.8, 1.5, 1.0, 1],
    color_end: [1.5, 0.5, 0.1, 0],
    size: 1.4,
    size_end: 3.6,
    lifetime: 170,
  });
};

// Вклад вспышек взрывов в динамическое освещение уровня. Вызывается из game.js
// перед рендером уровня (как BulletClient.collectLights).
Q2FX.collectLights = function (levelRender) {
  if (!levelRender || !levelRender.addDynamicLight) return;
  const now = Date.now();
  const out = [];
  for (let i = 0; i < Q2FX.explosionLights.length; i++) {
    const L = Q2FX.explosionLights[i];
    const age = now - L.born;
    if (age >= L.lifetime) continue;
    out.push(L);
    // Резкая вспышка с быстрым затуханием.
    const k = 1 - age / L.lifetime;
    const fade = k * k;
    levelRender.addDynamicLight(L.x, L.y, L.z, L.color, L.intensity * fade, L.radius, 2);
  }
  Q2FX.explosionLights = out;
};

Q2FX.update = function () {
  if (!is3D()) {
    Q2FX.particles.length = 0;
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
    out.push(p);
  }
  Q2FX.particles = out;
};

const _tmp_pos = new Vector(0, 0);

Q2FX.render = function (camera) {
  if (!is3D()) return;
  if (!Q2FX.tex_glow) return;
  const gl = state.gl;
  const shader = state.Weapon.shader_noshadow_color;
  if (!shader) return;
  gl.enable(gl.BLEND);
  Q2FX.renderBolts(camera);
  if (!Q2FX.particles.length) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return;
  }
  let activeBlend = null;
  const now = Date.now();
  for (let i = 0; i < Q2FX.particles.length; i++) {
    const p = Q2FX.particles[i];
    const t = (now - p.born) / p.lifetime;
    if (t < 0 || t > 1) continue;
    const inv_t = 1 - t;
    const r = p.color[0] * inv_t + p.color_end[0] * t;
    const g = p.color[1] * inv_t + p.color_end[1] * t;
    const b = p.color[2] * inv_t + p.color_end[2] * t;
    const a = p.color[3] * inv_t + p.color_end[3] * t;
    const sz = p.size * inv_t + p.size_end * t;
    if (!visibleFromPlayer(p.x, p.z)) continue;
    const nextBlend = p.blend === 'alpha' ? 'alpha' : 'add';
    if (activeBlend !== nextBlend) {
      if (nextBlend === 'alpha') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE);
      activeBlend = nextBlend;
    }
    _tmp_pos.x = p.x;
    _tmp_pos.y = p.z;
    Dynent.render(camera, p.tex || Q2FX.tex_glow, shader, _tmp_pos, [sz, sz], 0, {
      vectors: [{ location: shader.color, vec: [r, g, b, a] }],
      y_offset: p.y - sz * 0.5,
    });
  }
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
      isQuad ? 1.0 : 0.7,
    );
  } else if (bullet.type === WEAPON.ROCKET) {
    Q2FX.rocketExplosion(bullet.dynent.pos);
  } else if (bullet.type === WEAPON.PISTOL) {
    const isQuad = bullet.power === ITEM.QUAD;
    Q2FX.explodeFlash(bullet.dynent.pos, isQuad ? [1.6, 0.6, 0.2, 1] : [1.4, 1.05, 0.3, 1], 0.45);
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
