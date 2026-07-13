import { state } from '@/core/runtime-state.js';

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

export class Mesh {
  constructor(vertices, stride = 8) {
    this.stride = stride;
    if (!vertices || vertices.length === 0) {
      this.buffer = null;
      this.count = 0;
      return;
    }
    const gl = state.gl;
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

  draw() {
    if (!this.count) return;
    state.gl.drawArrays(state.gl.TRIANGLES, 0, this.count);
  }
}
