import { state } from '@/core/runtime-state.js';

import { Shader, bindProgram } from './shader.js';

let wireShader = null;
let wireFillShader = null;

const wireFillCtx = {
  color: [0.2, 0.22, 0.25],
  sunDir: [0.4, -0.8, 0.35],
  ambient: 0.52,
  sunIntensity: 0.38,
};

let wireFillShader2 = null;
let wireFillProg2 = null;
let staticDepthShader = null;

function ensureStaticDepthShader() {
  if (staticDepthShader) return staticDepthShader;
  const vert =
    'attribute vec3 position;\nuniform mat4 mat_pos;\nvoid main(){ gl_Position = mat_pos * vec4(position, 1.0); }';
  const frag =
    '#ifdef GL_ES\nprecision highp float;\n#endif\nvoid main(){ gl_FragColor = vec4(1.0); }';
  staticDepthShader = new Shader(vert, frag, ['mat_pos']);
  return staticDepthShader;
}

function beginWireFillDraw(gl, opts) {
  const o = opts || {};
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(o.depthWrite === true);
  gl.disable(gl.BLEND);
  if (o.noCull) {
    gl.disable(gl.CULL_FACE);
  } else {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(o.cullFront ? gl.FRONT : gl.BACK);
  }
  if (o.polygonOffset) {
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
  }
}

function endWireFillDraw(gl, opts) {
  if (opts && opts.polygonOffset) {
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}

function setWireFillStyle(color, sunDir, ambient, sunIntensity) {
  wireFillCtx.color = color || wireFillCtx.color;
  wireFillCtx.sunDir = sunDir || wireFillCtx.sunDir;
  if (ambient != null) wireFillCtx.ambient = ambient;
  if (sunIntensity != null) wireFillCtx.sunIntensity = sunIntensity;
}

function ensureWireFillShader2() {
  if (wireFillShader2 && !wireFillShader2.u_sceneDepth) {
    wireFillShader2 = null;
    wireFillProg2 = null;
  }
  if (wireFillShader2) return wireFillShader2;
  if (!state.isWebGL2) return null;
  const gl = state.gl;
  const vert = `#version 300 es
precision highp float;
layout(std140) uniform Frame { mat4 viewProj; vec4 sunDir; vec4 lightParams; };
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
out vec3 vNormal;
void main(){
  vNormal = normal;
  gl_Position = viewProj * vec4(position, 1.0);
}`;
  const frag = `#version 300 es
precision highp float;
layout(std140) uniform Frame { mat4 viewProj; vec4 sunDir; vec4 lightParams; };
uniform vec4 u_baseColor;
uniform sampler2D u_sceneDepth;
uniform vec4 u_depthParams;
in vec3 vNormal;
out vec4 outColor;
void main(){
  if (u_depthParams.x > 0.5) {
    vec2 duv = gl_FragCoord.xy * u_depthParams.yz;
    float sceneZ = texture(u_sceneDepth, duv).r;
    if (gl_FragCoord.z > sceneZ + u_depthParams.w) discard;
  }
  vec3 n = normalize(vNormal);
  float ndl = dot(n, normalize(sunDir.xyz)) * 0.5 + 0.5;
  vec3 lit = u_baseColor.rgb * (lightParams.x + lightParams.y * ndl);
  outColor = vec4(lit, 1.0);
}`;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vert);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, frag);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    return null;
  }
  wireFillProg2 = gl.createProgram();
  gl.attachShader(wireFillProg2, vs);
  gl.attachShader(wireFillProg2, fs);
  gl.bindAttribLocation(wireFillProg2, 0, 'position');
  gl.bindAttribLocation(wireFillProg2, 1, 'normal');
  gl.linkProgram(wireFillProg2);
  if (!gl.getProgramParameter(wireFillProg2, gl.LINK_STATUS)) return null;
  wireFillShader2 = {
    prog: wireFillProg2,
    u_baseColor: gl.getUniformLocation(wireFillProg2, 'u_baseColor'),
    u_sceneDepth: gl.getUniformLocation(wireFillProg2, 'u_sceneDepth'),
    u_depthParams: gl.getUniformLocation(wireFillProg2, 'u_depthParams'),
    use() {
      bindProgram(wireFillProg2);
    },
  };
  if (state.frameUBO) state.frameUBO.bind(wireFillProg2);
  return wireFillShader2;
}

function ensureWireFillShader() {
  if (wireFillShader) return wireFillShader;
  const vert =
    'attribute vec4 position;\nattribute vec3 normal;\nuniform mat4 mat_pos;\nvarying vec3 vNormal;\nvoid main(){ vNormal = normal; gl_Position = mat_pos * vec4(position.xyz, 1.0); }';
  const frag =
    '#ifdef GL_ES\nprecision highp float;\n#endif\nuniform vec4 u_sunDir;\nuniform vec4 u_baseColor;\nuniform vec4 u_lightParams;\nvarying vec3 vNormal;\nvoid main(){\n  vec3 n = normalize(vNormal);\n  vec3 sun = normalize(u_sunDir.xyz);\n  float ndl = dot(n, sun) * 0.5 + 0.5;\n  vec3 lit = u_baseColor.rgb * (u_lightParams.x + u_lightParams.y * ndl);\n  gl_FragColor = vec4(lit, 1.0);\n}';
  wireFillShader = new Shader(vert, frag, ['mat_pos', 'u_sunDir', 'u_baseColor', 'u_lightParams']);
  return wireFillShader;
}

function sunUniform(dir) {
  const s = dir || wireFillCtx.sunDir;
  return [s[0], s[1], s[2], 0];
}

function ensureDynamicBuffer(gl, pool, byteSize) {
  if (!pool.buffer) pool.buffer = gl.createBuffer();
  if (!pool.bytes || pool.bytes < byteSize) {
    gl.bindBuffer(gl.ARRAY_BUFFER, pool.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW);
    pool.bytes = byteSize;
  }
  return pool.buffer;
}

function bindWireFillDepthUniforms(sh2, opts) {
  const gl = state.gl;
  const depth = opts && opts.sceneDepth;
  if (depth && depth.ready && depth.tex && sh2.u_sceneDepth) {
    const w = state.canvas.width;
    const h = state.canvas.height;
    gl.activeTexture(gl.TEXTURE0 + 2);
    gl.bindTexture(gl.TEXTURE_2D, depth.tex);
    gl.uniform1i(sh2.u_sceneDepth, 2);
    gl.uniform4f(sh2.u_depthParams, 1, 1 / w, 1 / h, 0.0008);
  } else if (sh2.u_depthParams) {
    gl.uniform4f(sh2.u_depthParams, 0, 0, 0, 0);
  }
}

function drawWireFillInterleaved(buffer, count, strideFloats, normalOffset, color, matPos, opts) {
  if (!count || !buffer) return;
  const gl = state.gl;

  if (state.isWebGL2 && state.frameUBO && ensureWireFillShader2()) {
    state.frameUBO.update(
      matPos || state.viewProj3D,
      wireFillCtx.sunDir,
      wireFillCtx.ambient,
      wireFillCtx.sunIntensity,
    );
    const sh2 = wireFillShader2;
    sh2.use();
    if (state.frameUBO) state.frameUBO.bind(sh2.prog);
    const c = color || wireFillCtx.color;
    gl.uniform4f(sh2.u_baseColor, c[0], c[1], c[2], 1);
    bindWireFillDepthUniforms(sh2, opts);
    const stride = strideFloats * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, normalOffset * 4);
    beginWireFillDraw(gl, opts);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    endWireFillDraw(gl, opts);
    gl.disableVertexAttribArray(1);
    return;
  }

  const sh = ensureWireFillShader();
  sh.use();
  sh.matrix(sh.mat_pos, matPos || state.viewProj3D);
  sh.vector(sh.u_sunDir, sunUniform());
  sh.vector(sh.u_baseColor, [...(color || wireFillCtx.color), 1]);
  sh.vector(sh.u_lightParams, [wireFillCtx.ambient, wireFillCtx.sunIntensity, 0, 0]);
  const normalLoc = sh.attrib('normal');
  const stride = strideFloats * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(normalLoc);
  gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, stride, normalOffset * 4);
  beginWireFillDraw(gl, opts);
  gl.drawArrays(gl.TRIANGLES, 0, count);
  endWireFillDraw(gl, opts);
  gl.disableVertexAttribArray(normalLoc);
}

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

function drawDepthPrepass(drawFn, forceWriteOrOpts) {
  const gl = state.gl;
  let forceWrite = false;
  let cullFront = false;
  let noCull = false;
  if (typeof forceWriteOrOpts === 'boolean') forceWrite = forceWriteOrOpts;
  else if (forceWriteOrOpts) {
    forceWrite = !!forceWriteOrOpts.forceWrite;
    cullFront = !!forceWriteOrOpts.cullFront;
    noCull = !!forceWriteOrOpts.noCull;
  }
  const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  const prevCull = gl.isEnabled(gl.CULL_FACE);
  const prevCullFace = gl.getParameter(gl.CULL_FACE_MODE);
  if (forceWrite) gl.disable(gl.DEPTH_TEST);
  else {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }
  if (noCull) gl.disable(gl.CULL_FACE);
  else {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(cullFront ? gl.FRONT : gl.BACK);
  }
  gl.depthMask(true);
  gl.colorMask(false, false, false, false);
  drawFn();
  gl.colorMask(true, true, true, true);
  gl.depthMask(prevDepthMask);
  if (prevDepthTest) gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);
  if (prevCull) {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(prevCullFace);
  } else gl.disable(gl.CULL_FACE);
  gl.depthFunc(gl.LEQUAL);
}

function drawStaticDepth(buffer, count, strideFloats, matPos, opts) {
  if (!count || !buffer || !matPos) return;
  const gl = state.gl;
  const sh = ensureStaticDepthShader();
  if (!sh) return;
  sh.use();
  sh.matrix(sh.mat_pos, matPos);
  const stride = strideFloats * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  drawDepthPrepass(() => gl.drawArrays(gl.TRIANGLES, 0, count), opts);
}

function drawLevelMeshesDepth(meshes, opts) {
  if (!state.viewProj3D) return;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (!mesh || !mesh.count) continue;
    drawStaticDepth(mesh.buffer, mesh.count, mesh.stride || 8, state.viewProj3D, opts);
  }
}

function drawWireLines(lineBuffer, lineVertCount, color, mvp, depthBias, depthTest) {
  if (!lineBuffer || !lineVertCount) return;
  const gl = state.gl;
  const sh = ensureWireShader();
  sh.use();
  sh.matrix(sh.mat_pos, mvp || state.viewProj3D);
  sh.vector(sh.u_color, color || [0.85, 0.95, 1.0, 1]);
  sh.vector(sh.u_bias, [depthBias || 0.0025, 0, 0, 0]);
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
    if (!this.count || !isWireframe() || !state.viewProj3D) return;
    drawStaticDepth(this.buffer, this.count, this.stride, state.viewProj3D, { noCull: true });
  }

  drawWireFill(opts) {
    if (!this.count || !isWireframe()) return;
    const gl = state.gl;
    const fillOpts = opts || null;

    if (state.isWebGL2 && state.frameUBO && ensureWireFillShader2()) {
      state.frameUBO.update(
        state.viewProj3D,
        wireFillCtx.sunDir,
        wireFillCtx.ambient,
        wireFillCtx.sunIntensity,
      );
      const sh2 = wireFillShader2;
      sh2.use();
      state.frameUBO.bind(sh2.prog);
      gl.uniform4f(sh2.u_baseColor, wireFillCtx.color[0], wireFillCtx.color[1], wireFillCtx.color[2], 1);
      bindWireFillDepthUniforms(sh2, fillOpts);
      const stride = this.stride * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 5 * 4);
      beginWireFillDraw(gl, fillOpts);
      gl.drawArrays(gl.TRIANGLES, 0, this.count);
      endWireFillDraw(gl, fillOpts);
      gl.disableVertexAttribArray(1);
      return;
    }

    const sh = ensureWireFillShader();
    sh.use();
    sh.matrix(sh.mat_pos, state.viewProj3D);
    sh.vector(sh.u_sunDir, sunUniform());
    sh.vector(sh.u_baseColor, [...wireFillCtx.color, 1]);
    sh.vector(sh.u_lightParams, [wireFillCtx.ambient, wireFillCtx.sunIntensity, 0, 0]);
    const normalLoc = sh.attrib('normal');
    const stride = this.stride * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(normalLoc);
    gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, stride, 5 * 4);
    beginWireFillDraw(gl, fillOpts);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    endWireFillDraw(gl, fillOpts);
    gl.disableVertexAttribArray(normalLoc);
  }

  drawWire() {
    if (!this.count || !isWireframe()) return;
    if (this.wireCount) drawWireLines(this.wireBuffer, this.wireCount, null, null, 0);
  }

  draw() {
    if (!this.count) return;
    const gl = state.gl;
    if (isWireframe()) {
      this.drawWire();
      return;
    }
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}

export {
  buildWireLineBuffer,
  drawDepthPrepass,
  drawLevelMeshesDepth,
  drawStaticDepth,
  drawWireFillInterleaved,
  drawWireLines,
  ensureDynamicBuffer,
  isWireframe,
  setWireFillStyle,
};
