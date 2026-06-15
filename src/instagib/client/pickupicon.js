import { Shader } from '../engine/shader.js';
import { state } from '../runtime-state.js';

// 3D-иконки подбираемых пауэрапов: медицинский крест (HP), объёмный щит и
// экструдированные 3D-буквы (Q/R/S) — вместо плоских билбордов.
//
// Любая иконка задаётся набором 2D-треугольников (грань), который buildPrism()
// выдавливает в объём: передняя/задняя крышки + боковые стенки по контуру.
// Контур вычисляется автоматически — рёбра, использованные одним треугольником,
// становятся стенкой; общие рёбра соседних ячеек/спиц сокращаются. Поэтому
// дырки в буквах (Q, R) и составные формы (крест из ячеек) получаются «из коробки».

const VERT =
  '\n\
  attribute vec4 position;\n\
  attribute vec3 normal;\n\
  uniform mat4 mat_pos;\n\
  uniform mat4 mat_model;\n\
  varying vec3 v_normal;\n\
  varying vec3 v_world;\n\
  void main() {\n\
    gl_Position = mat_pos * position;\n\
    v_normal = mat3(mat_model) * normal;\n\
    v_world = (mat_model * position).xyz;\n\
  }\n';

const FRAG =
  '\n\
  #ifdef GL_ES\n\
  precision highp float;\n\
  #endif\n\
  uniform vec4 color;\n\
  uniform vec4 light_dir;\n\
  uniform vec4 params;\n\
  varying vec3 v_normal;\n\
  varying vec3 v_world;\n\
  void main() {\n\
    vec3 N = normalize(v_normal);\n\
    vec3 L = normalize(-light_dir.xyz);\n\
    float diff = max(dot(N, L), 0.0) * 0.55 + 0.45;\n\
    vec3 V = normalize(vec3(params.y, params.z, params.w) - v_world);\n\
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);\n\
    vec3 col = color.rgb * diff + color.rgb * fres * 1.4 + color.rgb * params.x;\n\
    gl_FragColor = vec4(col, color.a);\n\
  }\n';

// 5×7 битмап-шрифт для букв пауэрапов. '#' — заполненная ячейка.
const FONT = {
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
};

// Контур медицинского креста (греческий крест с толстыми перекладинами) в ячейках.
const CROSS = ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'];

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

// Контур геральдического щита: широкий верх, скос к нижнему острию. Веер из центра.
function shieldTriangles() {
  const pts = [
    [-0.5, 1.0],
    [0.5, 1.0],
    [0.5, 0.25],
    [0.42, -0.15],
    [0.25, -0.55],
    [0.0, -1.0],
    [-0.25, -0.55],
    [-0.42, -0.15],
    [-0.5, 0.25],
  ];
  const center = [0, 0.15];
  const tris = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    tris.push([center, a, b]);
  }
  return tris;
}

function ptKey(p) {
  return Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4);
}

// Выдавливание набора 2D-треугольников в объёмную призму (pos3 + normal3).
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
  const w = maxX - minX;
  const h = maxY - minY;
  const span = Math.max(w, h) || 1;
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
    const a = t[0];
    const b = t[1];
    const c = t[2];
    push(nx(a), ny(a), halfD, front);
    push(nx(b), ny(b), halfD, front);
    push(nx(c), ny(c), halfD, front);
    push(nx(a), ny(a), -halfD, back);
    push(nx(c), ny(c), -halfD, back);
    push(nx(b), ny(b), -halfD, back);
  }

  // Контурные рёбра: использованные ровно одним треугольником.
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
    const p = e.p;
    const q = e.q;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    let onx = dy;
    let ony = -dx;
    const mx = (p[0] + q[0]) / 2 - e.r[0];
    const my = (p[1] + q[1]) / 2 - e.r[1];
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
  if (glyph === 'shield') return shieldTriangles();
  if (FONT[glyph]) return gridTriangles(FONT[glyph]);
  return [];
}

export class PickupIcon {
  constructor() {
    this.shader = null;
    this.normalLoc = -1;
    this.meshes = {};
  }

  init() {
    if (this.shader) return;
    this.shader = new Shader(VERT, FRAG, ['mat_pos', 'mat_model', 'color', 'light_dir', 'params']);
    this.normalLoc = this.shader.attrib('normal');
  }

  mesh(glyph) {
    let m = this.meshes[glyph];
    if (m) return m;
    const gl = state.gl;
    const depth = glyph === 'shield' ? 0.28 : 0.22;
    const verts = buildPrism(glyphTriangles(glyph), depth);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    m = { buffer, count: verts.length / 6 };
    this.meshes[glyph] = m;
    return m;
  }

  // Модельная матрица иконки (покачивание + вращение). Общая для рендера и тени.
  modelMatrix(item) {
    const now = Date.now();
    const phase = item.x * 0.71 + item.y * 0.93;
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

  // Глубина иконки в карту теней через общий depth-шейдер уровня.
  renderShadow(lightVP, item, glyph) {
    this.init();
    const mesh = this.mesh(glyph);
    if (!mesh.count || !state.LevelRender || !state.LevelRender.shadowDrawLocal) return;
    const mat4 = state.mat4;
    const mvp = mat4.create();
    mat4.multiply(mvp, lightVP, this.modelMatrix(item));
    state.LevelRender.shadowDrawLocal(mvp, mesh.buffer, 6, mesh.count);
  }

  // glyph — 'cross' | 'shield' | 'Q' | 'R' | 'S'; color — [r, g, b].
  render(item, camera, glyph, color) {
    this.init();
    if (!this.shader) return false;

    const lr = state.LevelRender;
    let distFog = 0;
    if (lr && lr.getWorldFog && camera) {
      distFog = lr.getWorldFog(camera.pos, { x: item.x, y: item.y });
      if (distFog > 0.99) return true;
    }

    const mesh = this.mesh(glyph);
    if (!mesh.count) return true;

    const gl = state.gl;
    const now = Date.now();
    const phase = item.x * 0.71 + item.y * 0.93;
    const pulse = 0.3 + 0.25 * Math.sin(now * 0.006 + phase);

    const mat4 = state.mat4;
    const m = this.modelMatrix(item);
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, m);

    const eyeH = (lr && lr.eye_height) || 1.6;
    const sun = (lr && lr.sunDir) || [0.4, -0.85, 0.35];
    const fade = 1.0 - distFog;

    const wasBlend = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    const sh = this.shader;
    sh.use();
    sh.matrix(sh.mat_pos, matPos);
    sh.matrix(sh.mat_model, m);
    sh.vector(sh.color, [color[0] * fade, color[1] * fade, color[2] * fade, 1]);
    sh.vector(sh.light_dir, [sun[0], sun[1], sun[2], 1]);
    sh.vector(sh.params, [pulse, camera.pos.x, eyeH, camera.pos.y]);

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
