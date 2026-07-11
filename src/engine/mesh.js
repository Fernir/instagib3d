import { state } from '@core/runtime-state.js';

import { Shader } from './shader.js';

let wireShader = null;

function ensureWireShader() {
  if (wireShader) return wireShader;
  const vert =
    'attribute vec4 position;\nuniform mat4 mat_pos;\nuniform vec4 u_bias;\nvoid main(){ vec4 c = mat_pos * vec4(position.xyz, 1.0); c.z -= u_bias.x * c.w; gl_Position = c; }';
  const frag =
    '#ifdef GL_ES\nprecision highp float;\n#endif\nuniform vec4 u_color;\nvoid main(){ gl_FragColor = u_color; }';
  wireShader = new Shader(vert, frag, ['mat_pos', 'u_color', 'u_bias']);
  return wireShader;
}

function isWireframe() {
  return !!(state.wireframe && state.wireframePass);
}

function buildWireLineBuffer(vertices, stride) {
  const edges = new Set();
  const lines = [];
  const vertCount = vertices.length / stride;
  const posKey = (idx) => {
    const o = idx * stride;
    return (
      vertices[o].toFixed(4) +
      ',' +
      vertices[o + 1].toFixed(4) +
      ',' +
      vertices[o + 2].toFixed(4)
    );
  };
  const pushEdge = (ia, ib) => {
    const ka = posKey(ia);
    const kb = posKey(ib);
    const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (edges.has(k)) return;
    edges.add(k);
    const oa = ia * stride;
    const ob = ib * stride;
    lines.push(vertices[oa], vertices[oa + 1], vertices[oa + 2]);
    lines.push(vertices[ob], vertices[ob + 1], vertices[ob + 2]);
  };
  for (let i = 0; i + 2 < vertCount; i += 3) {
    pushEdge(i, i + 1);
    pushEdge(i + 1, i + 2);
    pushEdge(i + 2, i);
  }
  return { data: new Float32Array(lines), count: lines.length / 3 };
}

function drawDepthPrepass(drawFn, forceWrite) {
  const gl = state.gl;
  const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  if (forceWrite) gl.disable(gl.DEPTH_TEST);
  else {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }
  gl.depthMask(true);
  gl.colorMask(false, false, false, false);
  drawFn();
  gl.colorMask(true, true, true, true);
  gl.depthMask(prevDepthMask);
  if (prevDepthTest) gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
}

function drawWireLines(lineBuffer, lineVertCount, color, mvp, depthBias, depthTest) {
  if (!lineBuffer || !lineVertCount) return;
  const gl = state.gl;
  const sh = ensureWireShader();
  sh.use();
  sh.matrix(sh.mat_pos, mvp || state.viewProj3D);
  sh.vector(sh.u_color, color || [0.85, 0.95, 1.0, 1]);
  sh.vector(sh.u_bias, [depthBias || 0, 0, 0, 0]);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  if (depthTest !== false) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  } else gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.drawArrays(gl.LINES, 0, lineVertCount);
}

//
// Раскладка вершины (во float):
//   позиция(3) | uv(2) | нормаль(3) | [атлас-uv стены(2)]
// Обычный меш — stride 8, меш стены (с атлас-координатами декалей) — stride 10.
//
// MeshBuilder накапливает вершины (quad/box/vertex), .build() отдаёт Mesh.
// Mesh владеет GPU-буфером и умеет bind/unbind/draw. bind принимает локации
// атрибутов конкретного шейдера: { uv, normal, wallAtlas }.

export class MeshBuilder {
  constructor() {
    this.vertices = [];
  }

  vertex(x, y, z, u, v, nx, ny, nz) {
    this.vertices.push(x, y, z, u, v, nx, ny, nz);
    return this;
  }

  wallVertex(x, y, z, u, v, nx, ny, nz, au, av) {
    this.vertices.push(x, y, z, u, v, nx, ny, nz, au, av);
    return this;
  }

  quad(a, b, c, d, n, uv) {
    const tri = [a, b, c, a, c, d];
    const uvs = [
      [0, 0],
      [uv[0], 0],
      [uv[0], uv[1]],
      [0, 0],
      [uv[0], uv[1]],
      [0, uv[1]],
    ];
    for (let i = 0; i < 6; i++) {
      this.vertex(tri[i][0], tri[i][1], tri[i][2], uvs[i][0], uvs[i][1], n[0], n[1], n[2]);
    }
    return this;
  }

  box(center, halfSize, angle, uvScale) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const hx = halfSize[0];
    const hy = halfSize[1];
    const hz = halfSize[2];

    const rot = (x, y, z) => [
      center[0] + x * cosA - z * sinA,
      center[1] + y,
      center[2] + x * sinA + z * cosA,
    ];

    const p000 = rot(-hx, -hy, -hz);
    const p100 = rot(hx, -hy, -hz);
    const p010 = rot(-hx, hy, -hz);
    const p110 = rot(hx, hy, -hz);
    const p001 = rot(-hx, -hy, hz);
    const p101 = rot(hx, -hy, hz);
    const p011 = rot(-hx, hy, hz);
    const p111 = rot(hx, hy, hz);

    const nx = [cosA, 0, sinA];
    const nz = [-sinA, 0, cosA];

    this.quad(p011, p111, p110, p010, [0, 1, 0], uvScale);
    this.quad(p000, p100, p101, p001, [0, -1, 0], uvScale);
    this.quad(p001, p011, p010, p000, [-nx[0], 0, -nx[2]], [uvScale[0], hy * 2]);
    this.quad(p100, p110, p111, p101, [nx[0], 0, nx[2]], [uvScale[0], hy * 2]);
    this.quad(p000, p010, p110, p100, [-nz[0], 0, -nz[2]], [uvScale[0], hy * 2]);
    this.quad(p101, p111, p011, p001, [nz[0], 0, nz[2]], [uvScale[0], hy * 2]);
    return this;
  }

  build(stride = 8) {
    return new Mesh(this.vertices, stride);
  }
}

class Mesh {
  constructor(vertices, stride = 8) {
    this.stride = stride;
    if (!vertices || vertices.length === 0) {
      this.buffer = null;
      this.count = 0;
      return;
    }
    const gl = state.gl;
    const wire = buildWireLineBuffer(vertices, stride);
    if (wire.count > 0) {
      this.wireBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wireBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, wire.data, gl.STATIC_DRAW);
      this.wireCount = wire.count;
    } else {
      this.wireBuffer = null;
      this.wireCount = 0;
    }

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    this.count = vertices.length / stride;
  }

  // Привязка атрибутов; для stride 10 дополнительно цепляет атлас-uv стены.
  bind(locs) {
    if (!this.buffer) return;
    const gl = state.gl;
    const stride = this.stride * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(locs.uv);
    gl.vertexAttribPointer(locs.uv, 2, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(locs.normal);
    gl.vertexAttribPointer(locs.normal, 3, gl.FLOAT, false, stride, 5 * 4);
    if (this.stride >= 10 && locs.wallAtlas != null) {
      gl.enableVertexAttribArray(locs.wallAtlas);
      gl.vertexAttribPointer(locs.wallAtlas, 2, gl.FLOAT, false, stride, 8 * 4);
    }
  }

  unbind(locs) {
    const gl = state.gl;
    gl.disableVertexAttribArray(locs.uv);
    gl.disableVertexAttribArray(locs.normal);
    if (this.stride >= 10 && locs.wallAtlas != null) {
      gl.disableVertexAttribArray(locs.wallAtlas);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  drawDepthPrepass() {
    if (!this.count || !isWireframe()) return;
    const gl = state.gl;
    drawDepthPrepass(() => gl.drawArrays(gl.TRIANGLES, 0, this.count));
  }

  drawWire() {
    if (!this.count || !isWireframe()) return;
    if (this.wireCount) drawWireLines(this.wireBuffer, this.wireCount);
  }

  draw() {
    if (!this.count) return;
    const gl = state.gl;
    if (isWireframe()) {
      this.drawDepthPrepass();
      this.drawWire();
      return;
    }
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}

export { buildWireLineBuffer, drawDepthPrepass, drawWireLines, isWireframe };
