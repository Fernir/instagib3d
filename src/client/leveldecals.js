import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { Framebuffer } from '@/engine/FBO.js';
import { Shader } from '@/engine/shader.js';


const WALL_DECAL_HALF_LIFE_MS = 45000;
const WALL_ATLAS_PAD = 2;
const WALL_PPU_MIN = 16;
const WALL_PPU_MAX = 64;

const VERT_FADE = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
const FRAG_FADE = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 fade;
    void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, fade.a); }`;

const VERT_PAINT = `
    attribute vec2 position;
    attribute vec2 texuv;
    varying vec2 v_uv;
    void main()
    {
        v_uv = texuv;
        gl_Position = vec4(position, 0.0, 1.0);
    }`;
const FRAG_PAINT = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex;
    uniform vec4 color;
    varying vec2 v_uv;
    void main()
    {
        float a = texture2D(tex, v_uv).r * color.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(color.rgb * a, a);
    }`;

function setSharp(tex) {
  const gl = state.gl;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function dirFromDynent(dir) {
  if (!dir) return { x: 0, y: 0 };
  const x = typeof dir.x === 'number' ? dir.x : Array.isArray(dir) ? dir[0] : 0;
  const y = typeof dir.y === 'number' ? dir.y : Array.isArray(dir) ? dir[1] : 0;
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

export class LevelDecals {
  static WALL_ATLAS_PAD = WALL_ATLAS_PAD;
  static WALL_PPU_MIN = WALL_PPU_MIN;

  constructor(size, wallHeight, myLevel, wallSegments) {
    const gl = state.gl;
    this.size = size;
    this.wallHeight = wallHeight;
    this.myLevel = myLevel;
    this.wallSegments = wallSegments;
    this.wallAtlasRes = 2048;
    this.wallAtlasPpu = 32;
    this.wallFbo = null;
    this.lastFadeTime = Date.now();
    this.decalActivity = Date.now();
    this.fadeFloorFactor = 1;
    this.fadeWallFactor = 1;

    const decalRes = Math.min(2048, Math.max(1280, size * 40));
    this.floorFbo = new Framebuffer(decalRes, decalRes);
    this.floorFbo.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.floorFbo.unbind();

    this.fadeShader = new Shader(VERT_FADE, FRAG_FADE, ['fade']);
    this.paintShader = new Shader(VERT_PAINT, FRAG_PAINT, ['tex', 'color']);
    this.paintAddShader = new Shader(VERT_PAINT, FRAG_PAINT, ['tex', 'color']);
    this.uvLoc = this.paintShader.attrib('texuv');
    this.vbo = gl.createBuffer();
  }

  floorTexture() {
    return this.floorFbo.getTexture();
  }

  wallTexture() {
    return this.wallFbo ? this.wallFbo.getTexture() : null;
  }

  adapter() {
    return {
      render_decal: (dynent, tex, color, shAdd) => this.renderDecal(dynent, tex, color, shAdd),
      getDecalTexture: () => this.floorTexture(),
    };
  }

  fade() {
    const now = Date.now();
    const dt = Math.min(100, now - this.lastFadeTime);
    this.lastFadeTime = now;
    if (dt <= 0) return;
    const factor = Math.pow(0.5, dt / 45000);
    const wallFactor = Math.pow(0.5, dt / WALL_DECAL_HALF_LIFE_MS);
    this.fadeFloorFactor *= factor;
    this.fadeWallFactor *= wallFactor;
    if (now - this.decalActivity > 2500 && this.fadeFloorFactor > 0.997 && this.fadeWallFactor > 0.997) {
      return;
    }
    if (factor > 0.99998 && wallFactor > 0.99998) return;
    const gl = state.gl;
    this.fadeTarget(this.floorFbo, factor);
    if (this.wallFbo) {
      this.fadeTarget(this.wallFbo, wallFactor);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  fadeTarget(fbo, factor) {
    const gl = state.gl;
    fbo.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    this.fadeShader.use();
    this.fadeShader.vector(this.fadeShader.fade, [0, 0, 0, factor]);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    fbo.unbind();
  }

  packWallAtlas() {
    const atlasSizes = [2048, 4096];
    let packed = false;
    const tryPack = (res, ppu) => {
      const placements = [];
      let x = WALL_ATLAS_PAD;
      let y = WALL_ATLAS_PAD;
      let rowH = 0;
      for (let i = 0; i < this.wallSegments.length; i++) {
        const seg = this.wallSegments[i];
        const wPx = Math.max(1, Math.ceil(seg.len * ppu));
        const hPx = Math.max(1, Math.ceil(this.wallHeight * ppu));
        if (wPx + 2 * WALL_ATLAS_PAD > res || hPx + 2 * WALL_ATLAS_PAD > res) return null;
        if (x + wPx + WALL_ATLAS_PAD > res) {
          x = WALL_ATLAS_PAD;
          y += rowH + WALL_ATLAS_PAD;
          rowH = 0;
        }
        if (y + hPx + WALL_ATLAS_PAD > res) return null;
        placements.push({ seg, x, y, w: wPx, h: hPx, ppu });
        x += wPx + WALL_ATLAS_PAD;
        rowH = Math.max(rowH, hPx);
      }
      return placements;
    };

    const applyPlacements = (placements, res, ppu) => {
      this.wallAtlasRes = res;
      this.wallAtlasPpu = ppu;
      const inset = 0.5 / res;
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        p.seg.atlasPx = { x: p.x, y: p.y, w: p.w, h: p.h };
        p.seg.atlasRect = {
          u0: (p.x + inset) / res,
          u1: (p.x + p.w - inset) / res,
          v0: 1.0 - (p.y + p.h - inset) / res,
          v1: 1.0 - (p.y + inset) / res,
        };
        p.seg.ppu = ppu;
      }
    };

    for (let ai = 0; ai < atlasSizes.length && !packed; ai++) {
      const res = atlasSizes[ai];
      for (let ppu = WALL_PPU_MAX; ppu >= WALL_PPU_MIN && !packed; ppu--) {
        const placements = tryPack(res, ppu);
        if (!placements) continue;
        applyPlacements(placements, res, ppu);
        packed = true;
      }
    }
    if (!packed) {
      const placements = tryPack(4096, WALL_PPU_MIN) || [];
      Console.info('wall decal atlas: fallback pack at minimum PPU');
      applyPlacements(placements, 4096, WALL_PPU_MIN);
    }

    const gl = state.gl;
    this.wallFbo = new Framebuffer(this.wallAtlasRes, this.wallAtlasRes);
    this.wallFbo.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.wallFbo.unbind();
    setSharp(this.wallFbo.getTexture());
  }

  hasFloorAt(pos) {
    if (pos.x < 0 || pos.y < 0 || pos.x >= this.size || pos.y >= this.size) return false;
    if (this.myLevel.getCollide(pos, false) > 100) return false;
    if (this.myLevel.collideLava(pos) && !this.myLevel.getCollideBridges(pos)) return false;
    return true;
  }

  findWallSegmentAt(posX, posY, dirX, dirY) {
    const maxDist = 0.8;
    let best = null;
    let bestScore = -1e9;
    const hasDir = dirX * dirX + dirY * dirY > 1e-8;
    for (let i = 0; i < this.wallSegments.length; i++) {
      const seg = this.wallSegments[i];
      const ax = seg.p0[0];
      const az = seg.p0[1];
      const bx = seg.p1[0];
      const bz = seg.p1[1];
      const sx = bx - ax;
      const sz = bz - az;
      const len2 = sx * sx + sz * sz;
      if (len2 < 1e-8) continue;
      let t = ((posX - ax) * sx + (posY - az) * sz) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + sx * t;
      const cz = az + sz * t;
      const dist = Math.hypot(posX - cx, posY - cz);
      if (dist > maxDist) continue;
      const align = hasDir ? Math.abs(dirX * seg.nx + dirY * seg.nz) : 0;
      const score = (maxDist - dist) * 6 + align * 2;
      if (score > bestScore) {
        bestScore = score;
        best = { seg, t, cx, cz };
      }
    }
    return best;
  }

  decalReachesFloor(dynent, wallHit, sz) {
    const pz = dynent.pos_z;
    if (pz !== undefined && pz !== null) return pz - sz < 0.12;
    if (wallHit) {
      const dist = Math.hypot(dynent.pos.x - wallHit.cx, dynent.pos.y - wallHit.cz);
      return dist < 0.2;
    }
    return false;
  }

  renderDecal(dynent, tex, color, shAdd) {
    if (!tex || !tex.getId || !tex.getId()) return;
    this.decalActivity = Date.now();
    this.fadeFloorFactor = 1;
    this.fadeWallFactor = 1;
    const d = dirFromDynent(dynent.dir);
    const sz = Math.max(dynent.size.x, dynent.size.y) * 0.5;
    const canWall = !!dynent.dir || (dynent.pos_z !== undefined && dynent.pos_z !== null);
    const wallHit = canWall ? this.findWallSegmentAt(dynent.pos.x, dynent.pos.y, d.x, d.y) : null;
    if (wallHit) {
      this.spawnWallDecalOnSegment(
        dynent.pos,
        dynent.pos_z,
        wallHit,
        sz,
        color,
        tex.getId(),
        dynent.angle || 0,
        shAdd,
      );
      if (this.decalReachesFloor(dynent, wallHit, sz)) {
        let rx = -d.x;
        let ry = -d.y;
        if (rx * rx + ry * ry < 1e-6) {
          rx = wallHit.seg.nx;
          ry = wallHit.seg.nz;
        }
        const probe = { x: wallHit.cx + rx * 0.4, y: wallHit.cz + ry * 0.4 };
        if (this.hasFloorAt(probe)) {
          this.paintFloorDecal(
            { pos: { x: wallHit.cx, y: wallHit.cz }, size: dynent.size, angle: dynent.angle || 0 },
            tex.getId(),
            color,
            shAdd,
          );
        }
      }
      return;
    }
    if (!this.hasFloorAt(dynent.pos)) return;
    this.paintFloorDecal(dynent, tex.getId(), color, shAdd);
  }

  spawnWallDecalOnSegment(pos, posZ, hit, sz, color, texId, angle, shAdd) {
    if (!texId || !hit) return;
    let py =
      posZ !== undefined && posZ !== null ? posZ : (state.LevelRender && state.LevelRender.eye_height) || 1.6;
    py = Math.max(0.04, Math.min(this.wallHeight - 0.04, py));
    color = [0, 0, 0, color && color[3] !== undefined ? color[3] : 1];
    const reach = sz + 0.5;
    const reach2 = reach * reach;
    for (let i = 0; i < this.wallSegments.length; i++) {
      const seg = this.wallSegments[i];
      if (!seg.atlasRect) continue;
      const ax = seg.p0[0];
      const az = seg.p0[1];
      const bx = seg.p1[0];
      const bz = seg.p1[1];
      const sx = bx - ax;
      const sgz = bz - az;
      const len2 = sx * sx + sgz * sgz;
      if (len2 < 1e-8) continue;
      const tRaw = ((pos.x - ax) * sx + (pos.y - az) * sgz) / len2;
      const tC = Math.max(0, Math.min(1, tRaw));
      const cx = ax + sx * tC;
      const cz = az + sgz * tC;
      const dx = pos.x - cx;
      const dz = pos.y - cz;
      if (dx * dx + dz * dz > reach2) continue;
      this.paintWallDecal(seg, tRaw * seg.len, py, sz, angle || 0, color, texId, shAdd);
    }
  }

  paintWallDecal(seg, along, py, sz, angle, color, texId, shAdd) {
    if (!texId || !seg || !seg.atlasRect || !this.wallFbo) return;
    const gl = state.gl;
    const r = seg.atlasRect;
    const ppu = seg.ppu || this.wallAtlasPpu;
    const uCenter = r.u0 + (along / seg.len) * (r.u1 - r.u0);
    const vCenter = r.v0 + (py / this.wallHeight) * (r.v1 - r.v0);
    const halfU = (sz * 1.06 * ppu) / this.wallAtlasRes;
    const halfV = (sz * 1.06 * ppu) / this.wallAtlasRes;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    const corners = [];
    const local = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const uvs = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
    for (let i = 0; i < 6; i++) {
      const lx = local[i][0];
      const ly = local[i][1];
      const ru = lx * ca - ly * sa;
      const rv = lx * sa + ly * ca;
      corners.push([uCenter + ru * halfU, vCenter + rv * halfV]);
    }
    const verts = new Float32Array(6 * 4);
    for (let i = 0; i < 6; i++) {
      verts[i * 4 + 0] = corners[i][0] * 2 - 1;
      verts[i * 4 + 1] = corners[i][1] * 2 - 1;
      verts[i * 4 + 2] = uvs[i * 2 + 0];
      verts[i * 4 + 3] = uvs[i * 2 + 1];
    }

    const px = seg.atlasPx;
    this.wallFbo.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.SCISSOR_TEST);
    const scPad = 1;
    const scX = Math.max(0, px.x - scPad);
    const scY = Math.max(0, this.wallAtlasRes - px.y - px.h - scPad);
    const scW = Math.min(this.wallAtlasRes - scX, px.w + scPad * 2);
    const scH = Math.min(this.wallAtlasRes - scY, px.h + scPad * 2);
    gl.scissor(scX, scY, scW, scH);
    this.paintVerts(verts, texId, color, shAdd);
    gl.disable(gl.SCISSOR_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.wallFbo.unbind();
  }

  paintFloorDecal(dynent, texId, color, shAdd) {
    if (!texId) return;
    const ang = dynent.angle || 0;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const hw = (dynent.size.x * 0.5) / this.size;
    const hh = (dynent.size.y * 0.5) / this.size;
    const cx = dynent.pos.x / this.size;
    const cy = 1 - dynent.pos.y / this.size;
    const toNdc = (lx, ly) => {
      const rx = lx * ca - ly * sa;
      const ry = lx * sa + ly * ca;
      return [(cx + rx) * 2 - 1, (cy + ry) * 2 - 1];
    };
    const ndc = [toNdc(-hw, -hh), toNdc(hw, -hh), toNdc(-hw, hh), toNdc(hw, -hh), toNdc(hw, hh), toNdc(-hw, hh)];
    const uvs = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
    const verts = new Float32Array(6 * 4);
    for (let i = 0; i < 6; i++) {
      verts[i * 4 + 0] = ndc[i][0];
      verts[i * 4 + 1] = ndc[i][1];
      verts[i * 4 + 2] = uvs[i * 2 + 0];
      verts[i * 4 + 3] = uvs[i * 2 + 1];
    }

    this.floorFbo.bind();
    state.gl.disable(state.gl.DEPTH_TEST);
    this.paintVerts(verts, texId, color, shAdd);
    state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);
    this.floorFbo.unbind();
  }

  paintVerts(verts, texId, color, shAdd) {
    const gl = state.gl;
    gl.enable(gl.BLEND);
    if (shAdd) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const sh = shAdd ? this.paintAddShader : this.paintShader;
    sh.use();
    sh.texture(sh.tex, texId, 0);
    sh.vector(sh.color, color);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const stride = 4 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.uvLoc);
    gl.vertexAttribPointer(this.uvLoc, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(this.uvLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }
}
