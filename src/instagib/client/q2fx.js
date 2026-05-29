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
};

function is3D() {
  return !!(state.LevelRender && state.LevelRender.isFirstPerson3D);
}

function eyeH() {
  return (state.LevelRender && state.LevelRender.eye_height) || 1.6;
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
    size_end: opts.size_end !== undefined ? opts.size_end : (opts.size || 0.5),
    lifetime: opts.lifetime || 400,
    blend: opts.blend || 'add',
    born: Date.now(),
    last: Date.now(),
  });
};

function gunMuzzlePos(pos, angle, fwd, side) {
  const sin_a = Math.sin(angle);
  const cos_a = Math.cos(angle);
  if (fwd === undefined) fwd = 0.9;
  if (side === undefined) side = 0.25;
  return {
    x: pos.x + (-sin_a * fwd) + (cos_a * side),
    y: pos.y + (-cos_a * fwd) + (-sin_a * side),
  };
}

Q2FX.muzzleFlash = function (pos, angle, color) {
  if (!is3D()) return;
  const m = gunMuzzlePos(pos, angle);
  const gx = m.x;
  const gz = m.y;
  Q2FX.spawn({
    x: gx,
    y: eyeH() - 0.15,
    z: gz,
    color: color || [1, 0.9, 0.55, 1.0],
    color_end: [1, 0.4, 0.05, 0],
    size: 0.6,
    size_end: 1.8,
    lifetime: 110,
  });
  Q2FX.spawn({
    x: gx,
    y: eyeH() - 0.15,
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
    Q2FX.spawn({
      x: sx + dx * t,
      y: y0 + dy * t,
      z: sz + dz * t,
      color: color,
      color_end: [color[0] * 0.15, color[1] * 0.15, color[2] * 0.15, 0],
      size: baseSize,
      size_end: baseSize * 0.3,
      lifetime: lt + t * 40,
    });
  }
};

Q2FX.shaftBeam = function (sx, sz, ex, ez, color, sy, ey) {
  if (!is3D()) return;
  const dx = ex - sx;
  const dz = ez - sz;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.1) return;
  const fx = dx / len;
  const fz = dz / len;
  const rx = -fz;
  const rz = fx;
  const step = 0.4;
  const count = Math.min(80, Math.max(4, Math.floor(len / step)));
  const y0 = sy !== undefined ? sy : eyeH() - 0.15;
  const y1 = ey !== undefined ? ey : y0;
  const dy = y1 - y0;
  const c = color || [0.5, 0.75, 1.4, 1];
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const wave = Math.sin(t * len * 4 + Date.now() * 0.012) * 0.12;
    Q2FX.spawn({
      x: sx + fx * t * len + rx * wave,
      y: y0 + dy * t + Math.abs(wave) * 0.5,
      z: sz + fz * t * len + rz * wave,
      color: c,
      color_end: [c[0] * 0.1, c[1] * 0.15, c[2] * 0.3, 0],
      size: 0.2 + Math.random() * 0.08,
      size_end: 0.06,
      lifetime: 120 + Math.random() * 60,
    });
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
    Q2FX.spawn({
      x: start_x + fx * t * len + rx * cos_t * radius,
      y: y0 + dy * t + sin_t * radius,
      z: start_z + fz * t * len + rz * cos_t * radius,
      color: color || [0.5, 0.7, 1.0, 1.0],
      color_end: [0.05, 0.1, 0.35, 0],
      size: 0.22,
      size_end: 0.06,
      lifetime: 650 + t * 350,
    });
  }
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    Q2FX.spawn({
      x: start_x + fx * t * len,
      y: y0 + dy * t,
      z: start_z + fz * t * len,
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
  Dynent.render(
    camera,
    Q2FX.tex_glow,
    shader,
    bullet.dynent.pos,
    [size, size],
    0,
    {
      vectors: [{ location: shader.color, vec: color }],
      y_anchor: 'floor',
      y_offset: z,
    },
  );
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

Q2FX.explodeFlash = function (pos, color, bigness) {
  if (!is3D()) return;
  const eh = eyeH() - 0.5;
  const scale = bigness || 1.2;
  Q2FX.spawn({
    x: pos.x,
    y: eh,
    z: pos.y,
    color: color || [1, 0.85, 0.4, 1],
    color_end: [1, 0.2, 0.05, 0],
    size: scale,
    size_end: scale * 2.5,
    lifetime: 240,
  });
  const count = Math.floor(14 + scale * 5);
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const elev = Math.random() * 1.0 - 0.1;
    const sp = 2 + Math.random() * 5;
    Q2FX.spawn({
      x: pos.x,
      y: eh + 0.3,
      z: pos.y,
      vx: Math.cos(ang) * Math.cos(elev) * sp,
      vy: Math.sin(elev) * sp + 1.0,
      vz: Math.sin(ang) * Math.cos(elev) * sp,
      drag: 0.85,
      gravity: 9,
      color: [1, 0.85, 0.3, 1],
      color_end: [0.4, 0.05, 0, 0],
      size: 0.18 + Math.random() * 0.1,
      size_end: 0.04,
      lifetime: 600 + Math.random() * 500,
    });
  }
  if (scale >= 1.0) {
    Q2FX.smokePuff(pos, Math.floor(5 + scale * 5), Math.max(0.8, scale * 0.8));
  }
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
  if (!Q2FX.tex_glow || !Q2FX.particles.length) return;
  const gl = state.gl;
  const shader = state.Weapon.shader_noshadow_color;
  if (!shader) return;
  gl.enable(gl.BLEND);
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
    const nextBlend = p.blend === 'alpha' ? 'alpha' : 'add';
    if (activeBlend !== nextBlend) {
      if (nextBlend === 'alpha') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE);
      activeBlend = nextBlend;
    }
    _tmp_pos.x = p.x;
    _tmp_pos.y = p.z;
    Dynent.render(
      camera,
      Q2FX.tex_glow,
      shader,
      _tmp_pos,
      [sz, sz],
      0,
      {
        vectors: [{ location: shader.color, vec: [r, g, b, a] }],
        y_offset: p.y - sz * 0.5,
      },
    );
  }
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
};

Event.on('cl_lineshoot', function (bullet) {
  if (!is3D()) return;
  const owner_x = bullet.dynent.pos.x * 2 - bullet.dest.x;
  const owner_z = bullet.dynent.pos.y * 2 - bullet.dest.y;
  const muz = gunMuzzlePos({ x: owner_x, y: owner_z }, bullet.dynent.angle);
  const start_x = muz.x;
  const start_z = muz.y;
  const isRail = bullet.type === WEAPON.RAIL;
  const flashColor = isRail ? [0.55, 0.75, 1.0, 1] : [1, 0.9, 0.55, 1];
  Q2FX.muzzleFlash({ x: owner_x, y: owner_z }, bullet.dynent.angle, flashColor);
  const muz_y = eyeH() - 0.15;
  const dest_y = bullet.dest_z !== undefined && bullet.dest_z > 0
    ? bullet.dest_z
    : muz_y;
  if (isRail) {
    const color = bullet.power === ITEM.QUAD
      ? [1, 0.4, 0.45, 1]
      : [0.5, 0.7, 1.0, 1];
    Q2FX.railTrail(start_x, start_z, bullet.dest.x, bullet.dest.y, color, muz_y, dest_y);
  } else if (bullet.type === WEAPON.PISTOL) {
    const c = bullet.power === ITEM.QUAD
      ? [1.4, 0.7, 0.3, 1]
      : [1.4, 1.1, 0.5, 1];
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
  if (bullet.type === WEAPON.PLASMA) {
    const isQuad = bullet.power === ITEM.QUAD;
    Q2FX.explodeFlash(
      bullet.dynent.pos,
      isQuad ? [1, 0.5, 0.6, 1] : [0.5, 1.0, 0.5, 1],
      isQuad ? 1.0 : 0.7,
    );
  } else if (bullet.type === WEAPON.ROCKET) {
    Q2FX.explodeFlash(bullet.dynent.pos, [1, 0.7, 0.25, 1], 1.6);
  } else if (bullet.type === WEAPON.PISTOL) {
    const isQuad = bullet.power === ITEM.QUAD;
    Q2FX.explodeFlash(
      bullet.dynent.pos,
      isQuad ? [1.6, 0.6, 0.2, 1] : [1.4, 1.05, 0.3, 1],
      0.45,
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
