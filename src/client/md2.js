import { state } from '@/core/runtime-state.js';

import { drawDepthPrepass, drawWireFillInterleaved, drawWireLines, ensureDynamicBuffer, isWireframe } from '@/engine/mesh.js';
import { Shader } from '@/engine/shader.js';
import { Texture } from '@/engine/texture.js';


const MD2_IDENT = 844121161; // "IDP2"
const MD2_VERSION = 8;
const MD2_HEADER_INTS = 17;
const MD2_SKIN_NAME_LEN = 64;
const MD2_FRAME_NAME_LEN = 16;

function readCString(bytes, offset, maxLen) {
  let end = offset;
  const limit = offset + maxLen;
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder('ascii').decode(bytes.subarray(offset, end));
}

function ensureRange(name, offset, size, total) {
  if (offset < 0 || size < 0 || offset + size > total) {
    throw new Error(`Invalid MD2 ${name} range`);
  }
}

function parseGlCommands(view, offset, end) {
  const commands = [];
  let cursor = offset;

  while (cursor + 4 <= end) {
    const count = view.getInt32(cursor, true);
    cursor += 4;
    if (count === 0) break;

    const vertexCount = Math.abs(count);
    const bytes = vertexCount * 12;
    ensureRange('glcmd', cursor, bytes, end);

    const vertices = [];
    for (let i = 0; i < vertexCount; i++) {
      vertices.push({
        s: view.getFloat32(cursor, true),
        t: view.getFloat32(cursor + 4, true),
        index: view.getInt32(cursor + 8, true),
      });
      cursor += 12;
    }

    commands.push({
      mode: count > 0 ? 'strip' : 'fan',
      vertices,
    });
  }

  return commands;
}

function parseMd2(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const total = buffer.byteLength;
  ensureRange('header', 0, MD2_HEADER_INTS * 4, total);

  const header = {
    ident: view.getInt32(0, true),
    version: view.getInt32(4, true),
    skinwidth: view.getInt32(8, true),
    skinheight: view.getInt32(12, true),
    framesize: view.getInt32(16, true),
    num_skins: view.getInt32(20, true),
    num_vertices: view.getInt32(24, true),
    num_st: view.getInt32(28, true),
    num_tris: view.getInt32(32, true),
    num_glcmds: view.getInt32(36, true),
    num_frames: view.getInt32(40, true),
    ofs_skins: view.getInt32(44, true),
    ofs_st: view.getInt32(48, true),
    ofs_tris: view.getInt32(52, true),
    ofs_frames: view.getInt32(56, true),
    ofs_glcmds: view.getInt32(60, true),
    ofs_end: view.getInt32(64, true),
  };

  if (header.ident !== MD2_IDENT || header.version !== MD2_VERSION) {
    throw new Error('Unsupported MD2 file');
  }
  if (header.ofs_end > total) {
    throw new Error('Truncated MD2 file');
  }

  ensureRange('skins', header.ofs_skins, header.num_skins * MD2_SKIN_NAME_LEN, total);
  ensureRange('texcoords', header.ofs_st, header.num_st * 4, total);
  ensureRange('triangles', header.ofs_tris, header.num_tris * 12, total);
  ensureRange('frames', header.ofs_frames, header.num_frames * header.framesize, total);
  ensureRange('glcmds', header.ofs_glcmds, header.num_glcmds * 4, total);

  const skins = [];
  for (let i = 0; i < header.num_skins; i++) {
    skins.push(readCString(bytes, header.ofs_skins + i * MD2_SKIN_NAME_LEN, MD2_SKIN_NAME_LEN));
  }

  const texcoords = [];
  for (let i = 0; i < header.num_st; i++) {
    const offset = header.ofs_st + i * 4;
    const s = view.getInt16(offset, true);
    const t = view.getInt16(offset + 2, true);
    texcoords.push({
      s,
      t,
      u: header.skinwidth ? s / header.skinwidth : 0,
      v: header.skinheight ? t / header.skinheight : 0,
    });
  }

  const triangles = [];
  for (let i = 0; i < header.num_tris; i++) {
    const offset = header.ofs_tris + i * 12;
    triangles.push({
      vertexIndices: [
        view.getUint16(offset, true),
        view.getUint16(offset + 2, true),
        view.getUint16(offset + 4, true),
      ],
      texcoordIndices: [
        view.getUint16(offset + 6, true),
        view.getUint16(offset + 8, true),
        view.getUint16(offset + 10, true),
      ],
    });
  }

  const frames = [];
  for (let frame = 0; frame < header.num_frames; frame++) {
    const frameOffset = header.ofs_frames + frame * header.framesize;
    const scale = [
      view.getFloat32(frameOffset, true),
      view.getFloat32(frameOffset + 4, true),
      view.getFloat32(frameOffset + 8, true),
    ];
    const translate = [
      view.getFloat32(frameOffset + 12, true),
      view.getFloat32(frameOffset + 16, true),
      view.getFloat32(frameOffset + 20, true),
    ];
    const name = readCString(bytes, frameOffset + 24, MD2_FRAME_NAME_LEN);
    const vertices = new Float32Array(header.num_vertices * 3);
    const normalIndices = new Uint8Array(header.num_vertices);
    let vertexOffset = frameOffset + 40;

    ensureRange('frame vertices', vertexOffset, header.num_vertices * 4, total);
    for (let i = 0; i < header.num_vertices; i++) {
      vertices[i * 3] = bytes[vertexOffset] * scale[0] + translate[0];
      vertices[i * 3 + 1] = bytes[vertexOffset + 1] * scale[1] + translate[1];
      vertices[i * 3 + 2] = bytes[vertexOffset + 2] * scale[2] + translate[2];
      normalIndices[i] = bytes[vertexOffset + 3];
      vertexOffset += 4;
    }

    frames.push({
      name,
      scale,
      translate,
      vertices,
      normalIndices,
    });
  }

  const glCommands = parseGlCommands(view, header.ofs_glcmds, header.ofs_end);

  return {
    header,
    skins,
    texcoords,
    triangles,
    frames,
    glCommands,
  };
}

class MD2 {
  static async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load MD2: ${url}`);
    return parseMd2(await res.arrayBuffer());
  }
}

MD2.parse = parseMd2;

let cachedShader = null;
let cachedShaderVer = 0;
const MD2_SHADER_VER = 4;
const MD2_MAX_LIGHTS = 8;

const MD2_LIGHTS_GLSL = `
    uniform int  dyn_light_count;
    uniform vec4 dyn_light_pos[${MD2_MAX_LIGHTS}];
    uniform vec4 dyn_light_col[${MD2_MAX_LIGHTS}];

    vec3 accum_dyn_lights(vec3 wp, vec3 n)
    {
        vec3 sum = vec3(0.0);
        for (int i = 0; i < ${MD2_MAX_LIGHTS}; i++) {
            if (i >= dyn_light_count) break;
            vec3 lp = dyn_light_pos[i].xyz;
            float r = dyn_light_pos[i].w;
            if (r <= 0.0) continue;
            vec3 dv = wp - lp;
            float d = length(dv);
            float att = max(0.0, 1.0 - d / r);
            att *= att;
            float face = 1.0;
            if (length(n) > 0.001) {
                vec3 to_light = -dv / max(d, 0.0001);
                face = clamp(0.5 + 0.5 * dot(normalize(n), to_light), 0.4, 1.2);
            }
            sum += dyn_light_col[i].rgb * dyn_light_col[i].a * att * face;
        }
        return sum;
    }`;

let cachedOutlineShader = null;
let cachedDepthShader = null;

function transformPoint(m, p) {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function triangleNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// Depth-only шейдер для прохода карты теней: та же интерполяция кадров, что в
// основном шейдере, но без освещения — пишем только глубину из light-space.
function makeDepthShader() {
  const vert = `
    attribute vec3 position;
    attribute vec3 position_next;
    uniform mat4 mat_pos;
    uniform vec4 lerp;
    void main() {
        vec3 p = mix(position, position_next, lerp.x);
        gl_Position = mat_pos * vec4(p, 1.0);
    }`;
  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif
    void main() { gl_FragColor = vec4(1.0); }`;
  return new Shader(vert, frag, ['mat_pos', 'lerp']);
}

function makeOutlineShader() {
  const vert = `
    attribute vec3 position;
    attribute vec3 position_next;
    uniform mat4 mat_pos;
    uniform vec4 lerp;
    uniform vec4 outline;
    void main()
    {
        vec3 p = mix(position, position_next, lerp.x);
        vec3 n = normalize(p - vec3(0.0, 24.0, 0.0));
        p += n * outline.x;
        gl_Position = mat_pos * vec4(p, 1.0);
    }`;
  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 color;
    void main()
    {
        gl_FragColor = color;
    }`;
  return new Shader(vert, frag, ['mat_pos', 'lerp', 'outline', 'color']);
}

function makeShader() {
  const vert = `
    attribute vec3 position;
    attribute vec3 position_next;
    attribute vec2 texuv;
    uniform mat4 mat_pos;
    uniform mat4 mat_model;
    uniform vec4 lerp;
    varying vec2 v_uv;
    varying vec3 v_world_pos;
    varying vec3 v_normal_lerp;

    void main()
    {
        vec3 p = mix(position, position_next, lerp.x);
        v_uv = texuv;
        // Псевдо-нормаль: вектор от центра модели как приближение.
        v_normal_lerp = normalize(p - vec3(0.0, 24.0, 0.0));
        vec4 wp = mat_model * vec4(p, 1.0);
        v_world_pos = wp.xyz;
        gl_Position = mat_pos * vec4(p, 1.0);
    }`;

  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex;
    uniform sampler2D tex_lightmap;
    uniform sampler2D tex_visible;
    uniform vec4 color;
    uniform vec4 light_dir;       // xyz = sun dir в мировых координатах, w = use_directional
    uniform vec4 lightmap_params; // x = 1/level_size, y = use_lightmap
    uniform vec4 fog_params;      // x = 1/level_size, y = use_map_fog, z = dist_fog, w = dist_only
    uniform vec4 world_ref;       // xyz = override world-pos для лайтинга, w = use_flag
    varying vec2 v_uv;
    varying vec3 v_world_pos;
    varying vec3 v_normal_lerp;
    ${MD2_LIGHTS_GLSL}

    void main()
    {
        vec4 col = texture2D(tex, v_uv) * color;
        if (col.a < 0.05) discard;

        // Если задан world_ref (например, view-weapon в руках игрока), берём свет
        // в одной точке мира (где стоит игрок), а не per-vertex — иначе оружие
        // получает разный лайтмап для разных частей.
        vec3 wp = (world_ref.w > 0.5) ? world_ref.xyz : v_world_pos;

        float ambient = 0.45;
        float directional = 0.0;
        if (light_dir.w > 0.5) {
            directional = max(0.0, dot(normalize(v_normal_lerp), -normalize(light_dir.xyz))) * 0.18;
        }
        vec3 light = vec3(ambient + directional);

        // Освещение от запечённых статических факелов (без лимита).
        if (lightmap_params.y > 0.5) {
            vec2 uv_level = vec2(wp.x * lightmap_params.x,
                                 1.0 - wp.z * lightmap_params.x);
            // Для модели сэмплим лайтмап чуть «шире»: модель крупнее одного тайла,
            // плюс берём слегка размытое значение из 4 углов вокруг центра модели.
            float r = lightmap_params.x * 0.5;
            vec3 lm =
                texture2D(tex_lightmap, uv_level).rgb * 0.4 +
                texture2D(tex_lightmap, uv_level + vec2( r,  0)).rgb * 0.15 +
                texture2D(tex_lightmap, uv_level + vec2(-r,  0)).rgb * 0.15 +
                texture2D(tex_lightmap, uv_level + vec2( 0,  r)).rgb * 0.15 +
                texture2D(tex_lightmap, uv_level + vec2( 0, -r)).rgb * 0.15;
            // Усиливаем — модель должна явно «реагировать» на проходящие факелы.
            light += lm * 1.5;
        }

        // Динамические лайты (снаряды, вспышки).
        light += accum_dyn_lights(wp, v_normal_lerp);
        light = max(light, vec3(0.32));

        vec3 lit = col.rgb * light;
        float fogAmt = 0.0;
        if (fog_params.w > 0.5) {
            fogAmt = clamp(fog_params.z, 0.0, 1.0);
        } else if (fog_params.y > 0.5) {
            vec2 fuv = vec2(wp.x * fog_params.x, 1.0 - wp.z * fog_params.x);
            float mapFog = texture2D(tex_visible, fuv).r;
            mapFog = mapFog * mapFog * (3.0 - 2.0 * mapFog);
            fogAmt = clamp(max(mapFog, fog_params.z), 0.0, 1.0);
        }
        if (fogAmt > 0.001) {
            vec3 fogCol = vec3(0.012, 0.018, 0.032);
            lit = mix(lit, fogCol, fogAmt * 0.96);
        }
        if (col.a < 0.03) discard;
        gl_FragColor = vec4(lit, col.a);
    }`;

  return new Shader(vert, frag, [
    'mat_pos',
    'mat_model',
    'lerp',
    'tex',
    'color',
    'light_dir',
    'tex_lightmap',
    'lightmap_params',
    'tex_visible',
    'fog_params',
    'world_ref',
    'dyn_light_count',
  ]);
}

function buildGlcmdTopology(md2) {
  const corners = [];
  const pushTri = (a, b, c, verts) => {
    for (const i of [a, b, c]) {
      const v = verts[i];
      corners.push({ vi: v.index, u: v.s, v: v.t });
    }
  };

  for (const cmd of md2.glCommands) {
    const verts = cmd.vertices;
    if (cmd.mode === 'strip') {
      for (let i = 0; i < verts.length - 2; i++) {
        if (i % 2 === 0) pushTri(i, i + 1, i + 2, verts);
        else pushTri(i, i + 2, i + 1, verts);
      }
    } else {
      for (let i = 1; i < verts.length - 1; i++) {
        pushTri(0, i, i + 1, verts);
      }
    }
  }
  return corners;
}

function mapMd2Vertex(frame, vi) {
  const o = vi * 3;
  // Q2 frame layout: X=forward, Y=side, Z=up.
  // Engine: X=right, Y=up, Z=south. Bot yaw=0 looks toward -Z, so map Q2 +X to engine -Z.
  return [frame.vertices[o + 1], frame.vertices[o + 2], -frame.vertices[o]];
}

// Screen-space winding: CCW front face (matches gl.cullFace(BACK)).
function triFrontFacing(p0, p1, p2, mvp, invert) {
  const proj = (p) => {
    const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
    const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
    const w = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
    if (Math.abs(w) < 1e-5) return null;
    return [x / w, y / w];
  };
  const a = proj(p0);
  const b = proj(p1);
  const c = proj(p2);
  if (!a || !b || !c) return !invert;
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return invert ? cross < 0 : cross > 0;
}

function expandFrame(md2, frameIndex, topology) {
  const frame = md2.frames[frameIndex];
  const vertices = new Float32Array(topology.length * 3);
  let out = 0;
  for (let i = 0; i < topology.length; i++) {
    const p = mapMd2Vertex(frame, topology[i].vi);
    vertices[out++] = p[0];
    vertices[out++] = p[1];
    vertices[out++] = p[2];
  }
  return vertices;
}

function expandTexcoords(topology) {
  const texcoords = new Float32Array(topology.length * 2);
  let out = 0;
  for (let i = 0; i < topology.length; i++) {
    texcoords[out++] = topology[i].u;
    // glcmds — те же UV, что st/skin (как в коммите до правок); скин с UNPACK_FLIP_Y.
    texcoords[out++] = topology[i].v;
  }
  return texcoords;
}

let _fallbackSkinId = null;
function getFallbackSkinId() {
  if (_fallbackSkinId) return _fallbackSkinId;
  const gl = state.gl;
  if (!gl) return null;
  const id = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, id);
  // 2×2 серый «металл» с лёгкой вариацией яркости — даёт хоть какой-то материал.
  const data = new Uint8Array([
    160, 160, 168, 255, 140, 140, 150, 255, 150, 150, 160, 255, 170, 170, 180, 255,
  ]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  _fallbackSkinId = id;
  return id;
}

async function fetchSkin(url) {
  const gl = state.gl;
  const tex = new Texture(url, { wrap: gl.CLAMP_TO_EDGE });
  return { ready: () => tex.ready(), id: null, texture: tex, ext: 'image' };
}

class MD2Model {
  constructor(md2) {
    const gl = state.gl;
    this.md2 = md2;
    this.topology = buildGlcmdTopology(md2);
    this.vertexCount = this.topology.length;
    if (!cachedShader || cachedShaderVer !== MD2_SHADER_VER) {
      cachedShader = makeShader();
      cachedShaderVer = MD2_SHADER_VER;
    }
    this.shader = cachedShader;
    this.nextLocation = this.shader.attrib('position_next');
    this.uvLocation = this.shader.attrib('texuv');
    // Кешируем uniform-локации массивов лайтов (вызываются каждый кадр на каждом боте).
    this.lightPosLoc = this.shader.getLocation('dyn_light_pos[0]');
    this.lightColLoc = this.shader.getLocation('dyn_light_col[0]');

    this.frameBuffers = md2.frames.map((_, index) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, expandFrame(md2, index, this.topology), gl.STATIC_DRAW);
      return buffer;
    });

    this.texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, expandTexcoords(this.topology), gl.STATIC_DRAW);

    this.skins = [];
    this.frameLookup = new Map();
    md2.frames.forEach((frame, index) => {
      this.frameLookup.set(frame.name, index);
    });
  }

  addSkin(url) {
    const slot = { ready: () => false, id: null };
    this.skins.push(slot);
    fetchSkin(url)
      .then((loaded) => {
        Object.assign(slot, loaded);
      })
      .catch(() => {});
    return this.skins.length - 1;
  }

  ready() {
    return this.skins.length > 0 && this.skins.every((s) => s.ready());
  }

  frameIndex(name) {
    return this.frameLookup.has(name) ? this.frameLookup.get(name) : -1;
  }

  framesByPrefix(prefix) {
    const list = [];
    for (const [name, index] of this.frameLookup) {
      if (name.startsWith(prefix)) list.push(index);
    }
    list.sort((a, b) => a - b);
    return list;
  }

  skinTextureId(skinIndex) {
    const skin = this.skins[skinIndex];
    if (skin && skin.ready()) {
      if (skin.id) return skin.id;
      if (skin.texture) return skin.texture.getId();
    }
    // Фолбэк: 1×1 серая текстура — модель остаётся видимой, даже если скин не загрузился
    return getFallbackSkinId();
  }

  // Рендер только глубины в карту теней (light-space). FBO/состояние depth-pass
  // уже выставлены вызывающим (ShadowMap.begin).
  renderDepth(modelMatrix, frameA, frameB, lerp, lightViewProj) {
    if (!this.frameBuffers.length) return;
    const gl = state.gl;
    const mat4 = state.mat4;
    const shader = cachedDepthShader || (cachedDepthShader = makeDepthShader());
    const last = this.frameBuffers.length - 1;
    const a = Math.max(0, Math.min(last, frameA | 0));
    const b = Math.max(0, Math.min(last, frameB | 0));
    const mix = Math.max(0, Math.min(1, lerp || 0));
    const matPos = mat4.create();
    mat4.multiply(matPos, lightViewProj, modelMatrix);
    const nextLoc = shader.attrib('position_next');

    shader.use();
    shader.matrix(shader.mat_pos, matPos);
    shader.vector(shader.lerp, [mix, 0, 0, 0]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[a]);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(nextLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[b]);
    gl.vertexAttribPointer(nextLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

    gl.disableVertexAttribArray(nextLoc);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
  }

  renderOutline(modelMatrix, frameA, frameB, lerp, neonColor, width) {
    if (!this.frameBuffers.length) return;
    const gl = state.gl;
    const mat4 = state.mat4;
    const shader = cachedOutlineShader || (cachedOutlineShader = makeOutlineShader());
    const last = this.frameBuffers.length - 1;
    const a = Math.max(0, Math.min(last, frameA | 0));
    const b = Math.max(0, Math.min(last, frameB | 0));
    const mix = Math.max(0, Math.min(1, lerp || 0));
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, modelMatrix);

    const nextLoc = shader.attrib('position_next');

    shader.use();
    shader.matrix(shader.mat_pos, matPos);
    shader.vector(shader.lerp, [mix, 0, 0, 0]);
    shader.vector(shader.outline, [width || 0.6, 0, 0, 0]);
    shader.vector(shader.color, neonColor);

    const prevCull = gl.isEnabled(gl.CULL_FACE);
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(true);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[a]);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.enableVertexAttribArray(nextLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[b]);
    gl.vertexAttribPointer(nextLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

    gl.disableVertexAttribArray(nextLoc);
    gl.cullFace(gl.BACK);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (!prevBlend) gl.disable(gl.BLEND);
    if (!prevCull) gl.disable(gl.CULL_FACE);
    gl.depthMask(prevDepthMask);

    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
  }

  render(modelMatrix, frameA, frameB, lerp, skinIndex, color, lightCtx) {
    if (isWireframe()) {
      this.renderWire(modelMatrix, frameA, frameB, lerp, color);
      return;
    }
    const texId = this.skinTextureId(skinIndex || 0);
    if (texId === null || !this.frameBuffers.length) return;

    const gl = state.gl;
    const mat4 = state.mat4;
    const shader = this.shader;
    const last = this.frameBuffers.length - 1;
    const a = Math.max(0, Math.min(last, frameA | 0));
    const b = Math.max(0, Math.min(last, frameB | 0));
    const mix = Math.max(0, Math.min(1, lerp || 0));
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, modelMatrix);

    shader.use();
    shader.matrix(shader.mat_pos, matPos);
    shader.matrix(shader.mat_model, modelMatrix);
    shader.vector(shader.lerp, [mix, 0, 0, 0]);
    shader.vector(shader.color, color || [1, 1, 1, 1]);
    shader.texture(shader.tex, texId, 0);

    const worldRef = lightCtx && lightCtx.worldRef;

    if (shader.world_ref) {
      if (worldRef) {
        shader.vector(shader.world_ref, [worldRef[0], worldRef[1], worldRef[2], 1]);
      } else {
        shader.vector(shader.world_ref, [0, 0, 0, 0]);
      }
    }

    if (lightCtx && lightCtx.sunDir && shader.light_dir) {
      shader.vector(shader.light_dir, [
        lightCtx.sunDir[0],
        lightCtx.sunDir[1],
        lightCtx.sunDir[2],
        1.0,
      ]);
    } else if (shader.light_dir) {
      shader.vector(shader.light_dir, [0, -1, 0, 0]);
    }

    // Запечённая lightmap (статические факелы) — без лимита по числу источников.
    const lr = state.LevelRender;
    const lmId = lr && lr.getLightmapTexId ? lr.getLightmapTexId() : null;
    const invSize = lr && lr.getLevelInvSize ? lr.getLevelInvSize() : 0;
    if (lmId && shader.tex_lightmap && shader.lightmap_params) {
      shader.texture(shader.tex_lightmap, lmId, 1);
      shader.vector(shader.lightmap_params, [invSize, 1.0, 0, 0]);
    } else if (shader.lightmap_params) {
      shader.vector(shader.lightmap_params, [0, 0, 0, 0]);
    }

    // Активные динамические лайты (снаряды + вспышки).
    const lights = lr && lr.getActiveLights ? lr.getActiveLights() : null;
    if (lights) {
      gl.uniform1i(shader.dyn_light_count, lights.count);
      if (this.lightPosLoc) gl.uniform4fv(this.lightPosLoc, lights.pos);
      if (this.lightColLoc) gl.uniform4fv(this.lightColLoc, lights.col);
    } else {
      gl.uniform1i(shader.dyn_light_count, 0);
    }

    const distFog =
      lightCtx && lightCtx.distFog ? Math.min(1, Math.max(0, lightCtx.distFog)) : 0;
    if (shader.fog_params) {
      if (distFog > 0.001) {
        shader.vector(shader.fog_params, [0, 0, distFog, 1]);
      } else {
        shader.vector(shader.fog_params, [0, 0, 0, 0]);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[a]);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.enableVertexAttribArray(this.nextLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[b]);
    gl.vertexAttribPointer(this.nextLocation, 3, gl.FLOAT, false, 0, 0);

    gl.enableVertexAttribArray(this.uvLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
    gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

    gl.disableVertexAttribArray(this.nextLocation);
    gl.disableVertexAttribArray(this.uvLocation);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
  }

  renderWireFill(modelMatrix, frameA, frameB, lerp, color, opts) {
    if (!this.frameBuffers.length || !state.viewProj3D) return;
    const gl = state.gl;
    const mat4 = state.mat4;
    const last = this.frameBuffers.length - 1;
    const a = Math.max(0, Math.min(last, frameA | 0));
    const b = Math.max(0, Math.min(last, frameB | 0));
    const mix = Math.max(0, Math.min(1, lerp || 0));

    const fillCap = this.vertexCount * 6;
    if (!this.wireFillFloats || this.wireFillFloats.length < fillCap) {
      this.wireFillFloats = new Float32Array(fillCap);
    }
    if (!this._wireFillPool) this._wireFillPool = { buffer: null, bytes: 0 };
    ensureDynamicBuffer(gl, this._wireFillPool, this.wireFillFloats.byteLength);
    const wireFillBuffer = this._wireFillPool.buffer;

    const fa = this.md2.frames[a];
    const fb = this.md2.frames[b];
    const posAt = (slot) => {
      const vi = this.topology[slot].vi;
      const p0 = mapMd2Vertex(fa, vi);
      if (mix <= 0.001) return p0;
      const p1 = mapMd2Vertex(fb, vi);
      return [
        p0[0] + (p1[0] - p0[0]) * mix,
        p0[1] + (p1[1] - p0[1]) * mix,
        p0[2] + (p1[2] - p0[2]) * mix,
      ];
    };

    const out = this.wireFillFloats;
    let o = 0;
    const pushVert = (wp, nrm) => {
      out[o++] = wp[0];
      out[o++] = wp[1];
      out[o++] = wp[2];
      out[o++] = nrm[0];
      out[o++] = nrm[1];
      out[o++] = nrm[2];
    };

    for (let tri = 0; tri + 2 < this.vertexCount; tri += 3) {
      const p0 = posAt(tri);
      const p1 = posAt(tri + 1);
      const p2 = posAt(tri + 2);
      const w0 = transformPoint(modelMatrix, p0);
      const w1 = transformPoint(modelMatrix, p1);
      const w2 = transformPoint(modelMatrix, p2);
      const nrm = triangleNormal(w0, w1, w2);
      pushVert(w0, nrm);
      pushVert(w1, nrm);
      pushVert(w2, nrm);
    }

    const vertCount = o / 6;
    if (vertCount === 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, wireFillBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.subarray(0, o));
    const rgb = color || [0.75, 0.78, 0.82];
    drawWireFillInterleaved(wireFillBuffer, vertCount, 6, 3, rgb, state.viewProj3D, opts);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
  }

  renderWireDepth(modelMatrix, frameA, frameB, lerp, cullFront) {
    if (!this.frameBuffers.length) return;
    const gl = state.gl;
    const mat4 = state.mat4;
    const last = this.frameBuffers.length - 1;
    const a = Math.max(0, Math.min(last, frameA | 0));
    const b = Math.max(0, Math.min(last, frameB | 0));
    const mix = Math.max(0, Math.min(1, lerp || 0));
    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, modelMatrix);
    const shader = cachedDepthShader || (cachedDepthShader = makeDepthShader());
    const nextLoc = shader.attrib('position_next');
    shader.use();
    shader.matrix(shader.mat_pos, matPos);
    shader.vector(shader.lerp, [mix, 0, 0, 0]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[a]);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(nextLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffers[b]);
    gl.vertexAttribPointer(nextLoc, 3, gl.FLOAT, false, 0, 0);
    const prevCull = gl.isEnabled(gl.CULL_FACE);
    const prevCullFace = gl.getParameter(gl.CULL_FACE_MODE);
    drawDepthPrepass(() => gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount), {
      cullFront: !!cullFront,
    });
    gl.disableVertexAttribArray(nextLoc);
    if (prevCull) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(prevCullFace);
    } else gl.disable(gl.CULL_FACE);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
  }

  renderWireDraw(modelMatrix, frameA, frameB, lerp, color, depthTest, cullFront) {
    if (!this.frameBuffers.length) return;
    const gl = state.gl;
    const mat4 = state.mat4;
    const last = this.frameBuffers.length - 1;
    const a = Math.max(0, Math.min(last, frameA | 0));
    const b = Math.max(0, Math.min(last, frameB | 0));
    const mix = Math.max(0, Math.min(1, lerp || 0));

    const lineCap = this.vertexCount * 6;
    if (!this.wireLineFloats || this.wireLineFloats.length < lineCap) {
      this.wireLineFloats = new Float32Array(lineCap);
    }
    if (!this._wireLinePool) this._wireLinePool = { buffer: null, bytes: 0 };
    ensureDynamicBuffer(gl, this._wireLinePool, this.wireLineFloats.byteLength);
    const wireLineBuffer = this._wireLinePool.buffer;

    const fa = this.md2.frames[a];
    const fb = this.md2.frames[b];
    const posAt = (slot) => {
      const vi = this.topology[slot].vi;
      const p0 = mapMd2Vertex(fa, vi);
      if (mix <= 0.001) return p0;
      const p1 = mapMd2Vertex(fb, vi);
      return [
        p0[0] + (p1[0] - p0[0]) * mix,
        p0[1] + (p1[1] - p0[1]) * mix,
        p0[2] + (p1[2] - p0[2]) * mix,
      ];
    };

    const matPos = mat4.create();
    mat4.multiply(matPos, state.viewProj3D, modelMatrix);
    const invert = !!cullFront;
    const out = this.wireLineFloats;
    let o = 0;
    const pushEdge = (sa, sb) => {
      const pa = posAt(sa);
      const pb = posAt(sb);
      out[o++] = pa[0];
      out[o++] = pa[1];
      out[o++] = pa[2];
      out[o++] = pb[0];
      out[o++] = pb[1];
      out[o++] = pb[2];
    };

    for (let tri = 0; tri + 2 < this.vertexCount; tri += 3) {
      const p0 = posAt(tri);
      const p1 = posAt(tri + 1);
      const p2 = posAt(tri + 2);
      if (!triFrontFacing(p0, p1, p2, matPos, invert)) continue;
      pushEdge(tri, tri + 1);
      pushEdge(tri + 1, tri + 2);
      pushEdge(tri + 2, tri);
    }

    if (o === 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, wireLineBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.subarray(0, o));
    drawWireLines(wireLineBuffer, o / 3, color || [0.85, 0.95, 1.0, 1], matPos, 0.0012, depthTest);
    if (state.quadBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
  }

  renderWire(modelMatrix, frameA, frameB, lerp, color) {
    this.renderWireDepth(modelMatrix, frameA, frameB, lerp);
    this.renderWireDraw(modelMatrix, frameA, frameB, lerp, color);
  }

  static async load(modelUrl, skinUrls) {
    const md2 = await MD2.load(modelUrl);
    const model = new MD2Model(md2);
    const list = Array.isArray(skinUrls) ? skinUrls : skinUrls ? [skinUrls] : [];
    list.forEach((url) => model.addSkin(url));
    return model;
  }
}

MD2.Model = MD2Model;

export { MD2Model };
