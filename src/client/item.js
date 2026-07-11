import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';
import { Vector } from '@/core/vector.js';

import { buildWireLineBuffer, drawStaticDepth, drawWireFillInterleaved, drawWireLines, isWireframe } from '@/engine/mesh.js';
import { Shader } from '@/engine/shader.js';
import { Texture } from '@/engine/texture.js';

import { ITEM, WEAPON } from '@/global.js';

import { Dynent } from '@/sim/dynent.js';
import { Item } from '@/sim/item.js';

import { MD2Model } from './md2.js';
import { PICKUP_GLYPH_TRIANGLES } from './pickup-glyphs.js';
import { Sound } from './sound.js';

const POWERUP_ICONS = {
  [ITEM.LIFE]: { glyph: 'cross', color: [1.0, 0.25, 0.3] },
  [ITEM.SHIELD]: { glyph: 'shield', color: [0.4, 0.7, 1.0] },
  [ITEM.QUAD]: { glyph: 'Q', color: [0.65, 0.35, 1.0] },
  [ITEM.REGEN]: { glyph: 'R', color: [0.4, 1.0, 0.5] },
  [ITEM.SPEED]: { glyph: 'S', color: [1.0, 0.8, 0.25] },
};

const PICKUP_PATH = '/game/models/q2/pickups/';
const PICKUP_SPECS = {
  [WEAPON.PISTOL]: { model: 'blaster.md2', skin: 'blaster.png', color: [1.0, 0.85, 0.25] },
  [WEAPON.SHAFT]: { model: 'chaingun.md2', skin: 'chaingun.png', color: [0.4, 0.85, 1.0] },
  [WEAPON.RAIL]: { model: 'railgun.md2', skin: 'railgun.png', color: [1.0, 0.3, 0.3] },
  [WEAPON.PLASMA]: { model: 'hyperblaster.md2', skin: 'hyperblaster.png', color: [0.85, 0.4, 1.0] },
  [WEAPON.ZENIT]: { model: 'glauncher.md2', skin: 'glauncher.png', color: [0.3, 1.0, 0.4] },
  [WEAPON.ROCKET]: { model: 'rlauncher.md2', skin: 'rlauncher.png', color: [1.0, 0.55, 0.2] },
};

function pickupPhase(item) {
  return item.x * 0.71 + item.y * 0.93;
}

function pickupDistFog(lr, camera, item) {
  return lr && lr.getWorldFog && camera ? lr.getWorldFog(camera.pos, { x: item.x, y: item.y }) : 0;
}

function pickupFogRgb(lr, rgb, distFog) {
  return lr && lr.mixFogRgb ? lr.mixFogRgb(rgb, distFog) : rgb;
}

function startPickupModelLoads() {
  if (Item._pickupStarted) return;
  Item._pickupStarted = true;
  Item.pickupMd2 = {};
  Object.keys(PICKUP_SPECS).forEach(async (key) => {
    const spec = PICKUP_SPECS[key];
    try {
      const model = await MD2Model.load(PICKUP_PATH + spec.model, []);
      const skinIndex = model.addSkin(PICKUP_PATH + spec.skin);
      Item.pickupMd2[key] = { model, skinIndex, color: spec.color };
    } catch (err) {
      Console.warn('Pickup MD2 load failed: ' + spec.model + ': ' + err.message);
    }
  });
}

function weaponPickupMatrix(item) {
  const now = Date.now();
  const phase = pickupPhase(item);
  const bobY = 0.55 + Math.sin(now * 0.003 + phase) * 0.1;
  const yaw = ((now % 4000) / 4000) * Math.PI * 2 + phase;
  const mat4 = state.mat4;
  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [item.x, bobY, item.y]);
  mat4.rotateY(m, m, yaw);
  mat4.scale(m, m, [0.036, 0.036, 0.036]);
  return m;
}

function renderWeaponPickup3D(item, camera) {
  if (!Item.pickupMd2) return false;
  const spec = Item.pickupMd2[item.type];
  if (!spec || !spec.model || !spec.model.frameBuffers || !spec.model.frameBuffers.length) {
    return false;
  }

  const lr = state.LevelRender;
  const distFog = pickupDistFog(lr, camera, item);
  if (!spec.model.ready()) return false;

  const now = Date.now();
  const phase = pickupPhase(item);
  const m = weaponPickupMatrix(item);

  if (isWireframe()) {
    spec.model.render(m, 0, 0, 0, spec.skinIndex, [1, 1, 1, 1], { distFog });
    return true;
  }

  const gl = state.gl;
  const wasBlend = gl.isEnabled(gl.BLEND);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  spec.model.render(m, 0, 0, 0, spec.skinIndex, [1, 1, 1, 1], {
    sunDir: (lr && lr.sunDir) || [0.4, -0.85, 0.35],
    distFog,
  });

  const pulse = 0.65 + 0.35 * Math.sin(now * 0.005 + phase);
  const neon = pickupFogRgb(lr, [spec.color[0] * pulse, spec.color[1] * pulse, spec.color[2] * pulse], distFog);
  spec.model.renderOutline(m, 0, 0, 0, [neon[0], neon[1], neon[2], 1], 0.6);

  gl.disable(gl.CULL_FACE);
  if (wasBlend) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  return true;
}

// --- 3D powerup icons (extruded glyphs) ---

const ICON_VERT =
  'attribute vec4 position;\nattribute vec3 normal;\nuniform mat4 mat_pos;\nuniform mat4 mat_model;\n' +
  'varying vec3 v_normal;\nvarying vec3 v_world;\nvoid main() {\n' +
  '  gl_Position = mat_pos * position;\n  v_normal = mat3(mat_model) * normal;\n  v_world = (mat_model * position).xyz;\n}';

const ICON_FRAG =
  '#ifdef GL_ES\nprecision highp float;\n#endif\nuniform vec4 color;\nuniform vec4 light_dir;\n' +
  'uniform vec4 params;\nvarying vec3 v_normal;\nvarying vec3 v_world;\nvoid main() {\n' +
  '  vec3 N = normalize(v_normal);\n  vec3 L = normalize(-light_dir.xyz);\n' +
  '  float diff = max(dot(N, L), 0.0) * 0.55 + 0.45;\n' +
  '  vec3 V = normalize(vec3(params.y, params.z, params.w) - v_world);\n' +
  '  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);\n' +
  '  vec3 col = color.rgb * diff + color.rgb * fres * 1.4 + color.rgb * params.x;\n' +
  '  gl_FragColor = vec4(col, color.a);\n}';

const CROSS = ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'];
const GLYPH_MESH_VER = 5;

function gridTriangles(rows) {
  const h = rows.length;
  const tris = [];
  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      const x = c;
      const y = h - 1 - r;
      const bl = [x, y];
      const br = [x + 1, y];
      const tr = [x + 1, y + 1];
      const tl = [x, y + 1];
      tris.push([bl, br, tr], [bl, tr, tl]);
    }
  }
  return tris;
}

function ptKey(p) {
  return Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4);
}

function buildPrism(tris, depthFrac) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tris) {
    for (const p of t) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const s = 1 / span;
  const halfD = (depthFrac * span * s) / 2;
  const nx = (p) => (p[0] - cx) * s;
  const ny = (p) => (p[1] - cy) * s;
  const out = [];
  const push = (x, y, z, nrm) => out.push(x, y, z, nrm[0], nrm[1], nrm[2]);
  const front = [0, 0, 1];
  const back = [0, 0, -1];
  for (const t of tris) {
    const [a, b, c] = t;
    push(nx(a), ny(a), halfD, front);
    push(nx(b), ny(b), halfD, front);
    push(nx(c), ny(c), halfD, front);
    push(nx(a), ny(a), -halfD, back);
    push(nx(c), ny(c), -halfD, back);
    push(nx(b), ny(b), -halfD, back);
  }
  const edges = new Map();
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const p = t[i];
      const q = t[(i + 1) % 3];
      const r = t[(i + 2) % 3];
      const kp = ptKey(p);
      const kq = ptKey(q);
      const key = kp < kq ? kp + '|' + kq : kq + '|' + kp;
      const e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { p, q, r, count: 1 });
    }
  }
  for (const e of edges.values()) {
    if (e.count !== 1) continue;
    const { p, q, r } = e;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    let onx = dy;
    let ony = -dx;
    const mx = (p[0] + q[0]) / 2 - r[0];
    const my = (p[1] + q[1]) / 2 - r[1];
    if (onx * mx + ony * my < 0) {
      onx = -onx;
      ony = -ony;
    }
    const len = Math.hypot(onx, ony) || 1;
    const nrm = [onx / len, ony / len, 0];
    const px = nx(p);
    const py = ny(p);
    const qx = nx(q);
    const qy = ny(q);
    push(px, py, halfD, nrm);
    push(qx, qy, halfD, nrm);
    push(qx, qy, -halfD, nrm);
    push(px, py, halfD, nrm);
    push(qx, qy, -halfD, nrm);
    push(px, py, -halfD, nrm);
  }
  return out;
}

function glyphTriangles(glyph) {
  if (glyph === 'cross') return gridTriangles(CROSS);
  return PICKUP_GLYPH_TRIANGLES[glyph] || [];
}

class PickupIcon {
  constructor() {
    this.shader = null;
    this.normalLoc = -1;
    this.meshes = {};
  }

  init() {
    if (this.shader) return;
    this.shader = new Shader(ICON_VERT, ICON_FRAG, ['mat_pos', 'mat_model', 'color', 'light_dir', 'params']);
    this.normalLoc = this.shader.attrib('normal');
  }

  mesh(glyph) {
    let m = this.meshes[glyph];
    if (m && m.ver === GLYPH_MESH_VER) return m;
    const gl = state.gl;
    const depth = glyph === 'shield' ? 0.28 : 0.22;
    const verts = buildPrism(glyphTriangles(glyph), depth);
    const wire = buildWireLineBuffer(verts, 6);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    let wireBuffer = null;
    if (wire.count > 0) {
      wireBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, wireBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, wire.data, gl.STATIC_DRAW);
    }
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    m = { buffer, wireBuffer, wireCount: wire.count, count: verts.length / 6, ver: GLYPH_MESH_VER };
    this.meshes[glyph] = m;
    return m;
  }

  modelMatrix(item) {
    const now = Date.now();
    const phase = pickupPhase(item);
    const bobY = 0.85 + Math.sin(now * 0.003 + phase) * 0.12;
    const yaw = ((now % 4500) / 4500) * Math.PI * 2 + phase;
    const mat4 = state.mat4;
    const m = mat4.create();
    mat4.identity(m);
    mat4.translate(m, m, [item.x, bobY, item.y]);
    mat4.rotateY(m, m, yaw);
    mat4.scale(m, m, [0.7, 0.7, 0.7]);
    return m;
  }

  renderShadow(lightVP, item, glyph) {
    this.init();
    const mesh = this.mesh(glyph);
    if (!mesh.count || !state.LevelRender || !state.LevelRender.shadowDrawLocal) return;
    const mat4 = state.mat4;
    const mvp = mat4.create();
    mat4.multiply(mvp, lightVP, this.modelMatrix(item));
    state.LevelRender.shadowDrawLocal(mvp, mesh.buffer, 6, mesh.count);
  }

  renderWireDepth(item, glyph) {
    this.init();
    const mesh = this.mesh(glyph);
    if (!mesh.count) return false;
    const mat4 = state.mat4;
    const m = this.modelMatrix(item);
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, m);
    drawStaticDepth(mesh.buffer, mesh.count, 6, matPos);
    return true;
  }

  renderWireFill(item, glyph, color) {
    this.init();
    const mesh = this.mesh(glyph);
    if (!mesh.count) return false;
    const rgb = color || [0.7, 0.75, 0.85];
    const mat4 = state.mat4;
    const m = this.modelMatrix(item);
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, m);
    drawWireFillInterleaved(mesh.buffer, mesh.count, 6, 3, rgb, matPos);
    return true;
  }

  renderWireDraw(item, camera, glyph, color) {
    this.init();
    const mesh = this.mesh(glyph);
    if (!mesh.count) return false;
    const lr = state.LevelRender;
    const distFog = pickupDistFog(lr, camera, item);
    const mat4 = state.mat4;
    const m = this.modelMatrix(item);
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, m);
    const rgb = pickupFogRgb(lr, color, distFog);
    if (mesh.wireCount) drawWireLines(mesh.wireBuffer, mesh.wireCount, rgb, matPos, 0.0012);
    return true;
  }

  render(item, camera, glyph, color) {
    this.init();
    if (!this.shader) return false;

    const lr = state.LevelRender;
    const distFog = pickupDistFog(lr, camera, item);
    const mesh = this.mesh(glyph);
    if (!mesh.count) return true;

    const gl = state.gl;
    const now = Date.now();
    const pulse = 0.3 + 0.25 * Math.sin(now * 0.006 + pickupPhase(item));
    const mat4 = state.mat4;
    const m = this.modelMatrix(item);
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, m);
    const sun = (lr && lr.sunDir) || [0.4, -0.85, 0.35];
    const rgb = pickupFogRgb(lr, color, distFog);

    if (isWireframe()) {
      this.renderWireDepth(item, glyph);
      this.renderWireDraw(item, camera, glyph, color);
      return true;
    }

    const wasBlend = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    const sh = this.shader;
    sh.use();
    sh.matrix(sh.mat_pos, matPos);
    sh.matrix(sh.mat_model, m);
    sh.vector(sh.color, [rgb[0], rgb[1], rgb[2], 1]);
    sh.vector(sh.light_dir, [sun[0], sun[1], sun[2], 1]);
    sh.vector(sh.params, [pulse, camera.pos.x, (lr && lr.eye_height) || 1.6, camera.pos.y]);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.normalLoc);
    gl.vertexAttribPointer(this.normalLoc, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.disableVertexAttribArray(this.normalLoc);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    gl.depthMask(false);
    if (wasBlend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    return true;
  }
}

Item.renderWireDepth = function (camera, item) {
  const icon = POWERUP_ICONS[item.type];
  if (icon) return Item.icon.renderWireDepth(item, icon.glyph);
  if (!Item.pickupMd2) return false;
  const spec = Item.pickupMd2[item.type];
  if (!spec || !spec.model || !spec.model.frameBuffers || !spec.model.frameBuffers.length) return false;
  if (!spec.model.ready()) return false;
  spec.model.renderWireDepth(weaponPickupMatrix(item), 0, 0, 0);
  return true;
};

Item.renderWireFill = function (camera, item) {
  const icon = POWERUP_ICONS[item.type];
  if (icon) return Item.icon.renderWireFill(item, icon.glyph, icon.color);
  if (!Item.pickupMd2) return false;
  const spec = Item.pickupMd2[item.type];
  if (!spec || !spec.model || !spec.model.frameBuffers || !spec.model.frameBuffers.length) return false;
  if (!spec.model.ready()) return false;
  const c = spec.color || [1, 1, 1, 1];
  spec.model.renderWireFill(weaponPickupMatrix(item), 0, 0, 0, [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6]);
  return true;
};

Item.renderWireDraw = function (camera, item) {
  const icon = POWERUP_ICONS[item.type];
  if (icon) return Item.icon.renderWireDraw(item, camera, icon.glyph, icon.color);
  if (!Item.pickupMd2) return false;
  const spec = Item.pickupMd2[item.type];
  if (!spec || !spec.model || !spec.model.frameBuffers || !spec.model.frameBuffers.length) return false;
  if (!spec.model.ready()) return false;
  spec.model.renderWireDraw(weaponPickupMatrix(item), 0, 0, 0, spec.color || [1, 1, 1, 1]);
  return true;
};

Item.render = function (camera, item) {
  const icon = POWERUP_ICONS[item.type];
  if (icon) {
    Item.icon.render(item, camera, icon.glyph, icon.color);
    return;
  }
  if (renderWeaponPickup3D(item, camera)) return;

  const states = { y_anchor: 'feet', y_offset: 0.6 + Math.sin(Date.now() * 0.003) * 0.1 };
  Dynent.render(
    camera,
    state.Weapon.skins[item.type].gun,
    state.Weapon.shader_noshadow,
    new Vector(item.x, item.y),
    [1.2, 1.2],
    camera.angle,
    states,
  );
};

Item.renderShadow = function (lightVP, item) {
  const icon = POWERUP_ICONS[item.type];
  if (icon) {
    Item.icon.renderShadow(lightVP, item, icon.glyph);
    return;
  }
  if (!Item.pickupMd2) return;
  const spec = Item.pickupMd2[item.type];
  if (!spec || !spec.model || !spec.model.ready()) return;
  spec.model.renderDepth(weaponPickupMatrix(item), 0, 0, 0, lightVP);
};

Item.load = function () {
  Item.icon = new PickupIcon();
  Item.tex_powerup = [new Texture('/game/textures/fx/life.png')];
  Item.snd_health = new Sound('health');
  Item.snd_weapon = new Sound('pkup');
  Item.snd_power = new Sound('power');
  Item.snd_respawn = new Sound('resp_b');
  startPickupModelLoads();
};

Item.ready = function () {
  return Item.tex_powerup[0].ready();
};

state.Item = Item;
export { Item };
