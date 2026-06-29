import { Framebuffer } from '../engine/FBO.js';
import { GLSL } from '../engine/glsl.js';
import { MeshBuilder, isWireframe } from '../engine/mesh.js';
import { Shader } from '../engine/shader.js';
import { ShadowMap } from '../engine/shadowmap.js';
import { Texture } from '../engine/texture.js';
import { state, getMousePitch } from '../runtime-state.js';
import { Buffer } from '../server/libs/buffer.js';
import { Vector } from '../server/libs/vector.js';

import { LavaFlow } from './lavaflow.js';
import { LevelDecals } from './leveldecals.js';
import { LevelLighting } from './levellighting.js';
import { VolumetricFog } from './volumetricfog.js';
import {
  buildWallSegments,
  mergeWallSegments,
  splitLongWallSegments,
} from './wallcontours.js';

class LevelRender3D {
  constructor(my_level, my_size_class) {
    const gl = state.gl;
    const level = my_level.getLevelGener();
    const raw = level.getRawLevel();
    const groundMap = level.getGroundMap();
    const size = raw.getSize();
    const mapCells = groundMap.getSize();
    const mapScale = mapCells / size;
    const wall_height = 4.0;
    const eye_height = 1.6;

    const black_pixel = new Uint8Array([0, 0, 0, 255]);
    const tex_visible_black = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex_visible_black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, black_pixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (state.LevelRender) {
      state.LevelRender.isFirstPerson3D = true;
      state.LevelRender.eye_height = eye_height;
    }

    // Туман войны — top-down raycast по levelmap.g (как в instagib.io shader_visible).
    const visRes = Math.min(256, Math.max(64, size * 4));
    const fbo_visible = new Framebuffer(visRes, visRes);
    fbo_visible.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    fbo_visible.unbind();

    const vert_visible_map = `
    attribute vec2 position;
    varying vec2 v_uv;
    void main()
    {
        v_uv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
    }`;
    // Бинарная карта стен (не размытая groundMap) — иначе пол в коридорах
    // даёт ложные срабатывания и весь экран уходит в туман.
    const tex_vis_wall = Buffer.create_texture(raw, raw, raw, raw, { wrap: gl.CLAMP_TO_EDGE });

    const frag_visible_map = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D wall_map;
    uniform vec2 player_uv;
    varying vec2 v_uv;

    float wallSample(vec2 uv)
    {
        return step(0.5, texture2D(wall_map, uv).r);
    }

    void main()
    {
        vec2 sample_uv = v_uv;
        vec2 d = (player_uv - sample_uv) / 12.0;
        float res = wallSample(sample_uv);
        vec2 p = sample_uv + d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        res += wallSample(p); p += d;
        float fog = clamp((res - 5.0) * 2.0, 0.0, 1.0);
        fog = fog * fog * (3.0 - 2.0 * fog);
        gl_FragColor = vec4(fog, 0.0, 0.0, 1.0);
    }`;
    const shader_visible_map = new Shader(vert_visible_map, frag_visible_map, [
      'wall_map',
      'player_uv',
    ]);

    function renderVisibleMap(camera) {
      if (!camera || !camera.pos) return;
      fbo_visible.bind();
      gl.viewport(0, 0, visRes, visRes);
      gl.disable(gl.DEPTH_TEST);
      shader_visible_map.use();
      shader_visible_map.texture(shader_visible_map.wall_map, tex_vis_wall.getId(), 0);
      // player_uv объявлен как vec2 — задаём именно uniform2f, иначе WebGL ругается
      // "Uniform size does not match uniform method" (shader.vector шлёт uniform4f).
      gl.uniform2f(shader_visible_map.player_uv, camera.pos.x / size, 1.0 - camera.pos.y / size);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      fbo_visible.unbind();
    }

    const tex_ground1 = new Texture('/game/textures/fx/tex_grass.jpg');
    const tex_wall = new Texture('/game/textures/fx/wall.jpg');
    const tex_lava = new Texture('/game/textures/fx/lava.jpg');
    const tex_bridge = new Texture('/game/textures/fx/wall.jpg');
    const tex_noise = new Texture('/game/textures/fx/noise.png');
    let tex_ground2 = null;

    Buffer.loadImage('/game/textures/fx/tex_ground.jpg', function (R, G, B) {
      const ground_mask = new Buffer(R.getSize());
      ground_mask.perlin(32, 0.5).normalize(0, 1);
      tex_ground2 = Buffer.create_texture(R, G, B, ground_mask);
    });

    const mask = new Buffer(level.getTextureSize());
    mask
      .perlin(5 << my_size_class, 0.5)
      .normalize(-5, 6)
      .clamp(0, 1);

    const shadow = new Buffer(level.getTextureSize());
    shadow.shadow(level.getGroundMap(), state.sun_direction);

    const levelmap = Buffer.create_texture(
      level.getRiverMap(),
      level.getGroundMap(),
      mask,
      shadow,
      { wrap: gl.CLAMP_TO_EDGE },
    );

    // Миникарта: отдельная 256² текстура из «сырых» тайлов (nearest upscale),
    // иначе на маленьких картах (64²) levelmap размазывается в LINEAR.
    const MINIMAP_TEX_SIZE = 256;
    function buildMinimapChannel(outSize, src, mapFn) {
      const buf = new Buffer(outSize);
      const srcSize = src.getSize();
      for (let j = 0; j < outSize; j++) {
        for (let i = 0; i < outSize; i++) {
          const sx = Math.min(srcSize - 1, ((i * srcSize) / outSize) | 0);
          const sy = Math.min(srcSize - 1, ((j * srcSize) / outSize) | 0);
          buf.setData(i + j * outSize, mapFn(src.getData(sx, sy)));
        }
      }
      return buf;
    }
    const minimapLava = buildMinimapChannel(MINIMAP_TEX_SIZE, level.getRiverMap(), (v) =>
      v > 0.12 ? 1 : 0,
    );
    const minimapFloor = buildMinimapChannel(MINIMAP_TEX_SIZE, raw, (v) => (v < 0.5 ? 1 : 0));
    const minimapTex = Buffer.create_texture(
      minimapLava,
      minimapFloor,
      minimapFloor,
      minimapFloor,
      { wrap: gl.CLAMP_TO_EDGE, filter: gl.NEAREST },
    );

    // Поле скоростей реки/лавы — задаёт направление течения по позиции (RG = vx, vy).
    // Используется в frag_lava_anim для физически согласованного «потока» как в 2D.
    const tex_velocity = Buffer.create_texture(
      level.getVelocityX(),
      level.getVelocityY(),
      level.getVelocityX(),
      level.getVelocityY(),
      { wrap: gl.CLAMP_TO_EDGE },
    );

    const lavaFlow = new LavaFlow(size, tex_noise);

    const vert_world = `
    attribute vec3 position;
    attribute vec2 texuv;
    attribute vec3 normal;
    uniform mat4 view_proj;
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying float v_height;

    void main()
    {
        v_world_pos = position;
        v_world = position.xz;
        v_uv = texuv;
        v_normal = normal;
        v_height = position.y;
        gl_Position = view_proj * vec4(position, 1.0);
    }`;

    const vert_wall = `
    attribute vec3 position;
    attribute vec2 texuv;
    attribute vec3 normal;
    attribute vec2 atlasuv;
    uniform mat4 view_proj;
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying float v_height;
    varying vec2 v_atlas;

    void main()
    {
        v_world_pos = position;
        v_world = position.xz;
        v_uv = texuv;
        v_normal = normalize(normal);
        v_height = position.y;
        v_atlas = atlasuv;
        gl_Position = view_proj * vec4(position, 1.0);
    }`;

    // Единый базовый уровень освещения и точечные лайты сверху.
    const AMBIENT_BASE = 0.45;

    const FOG_COLOR = 'vec3(0.022, 0.028, 0.045)';
    // Дистанционный экспоненциальный туман: вблизи прозрачно, вдали всё растворяется
    // в цвете тумана. Лёгкий шум по миру делает границу не идеально ровной.
    const FOG_MIX_GLSL = GLSL.distanceFog(FOG_COLOR);

    // Тень от солнца: проекция мировой точки в light-space + PCF 3×3 по depth-карте.
    // apply_sun() добавляет направленный солнечный вклад, погашенный там, где тень.
    const SHADOW_GLSL = `
    uniform sampler2D tex_shadow;
    uniform mat4 light_vp;
    uniform vec4 shadow_params; // x = texel, y = normal-offset, z = bias, w = enabled
    uniform vec4 sun_dir;       // xyz = направление света, w = интенсивность

    float sun_shadow(vec3 wp)
    {
        if (shadow_params.w < 0.5) return 1.0;
        vec4 lp = light_vp * vec4(wp, 1.0);
        vec3 proj = lp.xyz / lp.w * 0.5 + 0.5;
        if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0 || proj.z > 1.0)
            return 1.0;
        float bias = shadow_params.z;
        float s = 0.0;
        for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
                vec2 off = vec2(float(x), float(y)) * shadow_params.x * 1.3;
                float d = texture2D(tex_shadow, proj.xy + off).r;
                s += (proj.z - bias > d) ? 0.0 : 1.0;
            }
        }
        return s / 25.0;
    }

    vec3 apply_sun(vec3 lighting, vec3 wp, vec3 n, float receive)
    {
        vec3 nn = normalize(n);
        float ndl = max(dot(nn, -normalize(sun_dir.xyz)), 0.0);
        // Normal-offset bias: сэмплим тень со сдвигом вдоль нормали, сильнее на
        // гранях под острым углом к свету (стены). Убирает «плитки» самозатенения.
        float off = shadow_params.y * (1.0 + (1.0 - ndl) * 6.0);
        float sh = sun_shadow(wp + nn * off);
        return lighting + vec3(1.0, 0.96, 0.86) * sun_dir.w * ndl * sh * receive;
    }

    // Пол: тени от стен всегда полные; точечный свет на лаве приглушён.
    vec3 apply_sun_ground(vec3 lighting, vec3 wp, vec3 n)
    {
        vec3 nn = normalize(n);
        float ndl = max(dot(nn, -normalize(sun_dir.xyz)), 0.0);
        vec3 toSun = -normalize(sun_dir.xyz);
        float sh = sun_shadow(wp);
        sh = min(sh, sun_shadow(wp + vec3(0.0, 0.12, 0.0)));
        sh = min(sh, sun_shadow(wp + vec3(0.0, 0.32, 0.0)));
        sh = min(sh, sun_shadow(wp + toSun * 0.18));
        return lighting + vec3(1.0, 0.96, 0.86) * sun_dir.w * ndl * sh;
    }

    // Стены: у пола сэмплим без normal-offset (щель под плинтусом), выше — со сдвигом.
    vec3 apply_sun_wall(vec3 lighting, vec3 wp, vec3 n, float height)
    {
        vec3 nn = normalize(n);
        float ndl = dot(nn, -normalize(sun_dir.xyz));
        ndl = max(ndl, 0.0) * 0.55 + 0.45;
        float heightScale = smoothstep(0.0, 0.5, height);
        float off = shadow_params.y * (1.0 + (1.0 - ndl) * 3.0) * heightScale;
        float shBase = sun_shadow(wp);
        float shOff = sun_shadow(wp + nn * off);
        float sh = mix(shBase, min(shBase, shOff), heightScale);
        vec3 sun = vec3(1.0, 0.96, 0.86) * sun_dir.w * ndl * sh;
        float contact = mix(0.35, 1.0, smoothstep(0.0, 0.55, height));
        return (lighting + sun) * contact;
    }`;

    const frag_floor = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex_ground_1;
    uniform sampler2D tex_ground_2;
    uniform sampler2D tex_lava;
    uniform sampler2D tex_velocity;
    uniform sampler2D tex_wave;
    uniform sampler2D tex_decal;
    uniform sampler2D tex_visible;
    uniform sampler2D levelmap;
    uniform vec4 scale_world;
    uniform vec4 time;
    uniform vec4 cam_pos;
    uniform vec4 lava_params; // x = scale, y = time (0..1)
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    ${LevelLighting.dynamicGlsl}
    ${LevelLighting.staticLightmapGlsl}
    ${FOG_MIX_GLSL}
    ${SHADOW_GLSL}

    void main()
    {
        vec2 uv_level = vec2(v_world.x * scale_world.x, 1.0 - v_world.y * scale_world.x);
        vec2 uv_detail = v_world * scale_world.y;
        vec4 level = texture2D(levelmap, uv_level);
        vec4 ground_1 = texture2D(tex_ground_1, uv_detail);
        vec4 ground_2 = texture2D(tex_ground_2, uv_detail);

        // Анимированная лава — тот же расчёт, что и в 2D-шейдере frag_lava, но
        // считается прямо здесь, per-pixel, чтобы не падать на разрешение FBO.
        float lava_scale = lava_params.x;
        float lava_t     = lava_params.y;
        vec4 vel  = texture2D(tex_velocity, uv_level);
        vel = (vel * 2.0 - 1.0) * 0.25;
        vec4 wave = texture2D(tex_wave, uv_level);
        vec2 lava_uv = uv_level * lava_scale + wave.rg * 0.1;
        vec4 lava_a = texture2D(tex_lava, lava_uv + vel.xy * lava_t);
        vec4 lava_b = texture2D(tex_lava, lava_uv - vel.xy + vel.xy * lava_t);
        vec4 lava = mix(lava_a, lava_b, lava_t);
        lava.rgb *= vec3(1.6, 0.85, 0.65);

        float ground_mask = clamp((ground_2.a - level.b + 0.2) * 2.5, 0.0, 1.0);
        vec4 ground = mix(ground_2, ground_1, ground_mask);

        // Маска лавы — с волновым «дрожанием» края (как в 2D frag_lava).
        float lava_wobble = (wave.b - 0.5) * 0.3;
        float lava_mask = clamp(((level.r + lava_wobble) * 2.0 - 1.0) * 10.0, 0.0, 1.0);
        // Тёмный обугленный берег у края «чаши» с лавой.
        float lava_edge = smoothstep(0.32, 0.50, level.r) * (1.0 - lava_mask);
        ground.rgb *= 1.0 - lava_edge * 0.82;
        ground.rgb = mix(ground.rgb, vec3(0.04, 0.025, 0.015), lava_edge * 0.62);

        vec3 albedo = mix(ground.rgb, lava.rgb, lava_mask);
        vec3 n = normalize(v_normal);
        // Лава: факелы приглушены, но тени от солнца/стен — на полную.
        float receive_lights = 1.0 - lava_mask * 0.85;
        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        lighting += sample_static_lightmap(uv_level) * receive_lights;
        lighting += accum_dyn_lights(v_world_pos, n) * receive_lights;
        lighting = apply_sun_ground(lighting, v_world_pos, n);
        vec3 col = albedo * lighting;
        float lava_glow = clamp(max(lighting.r, max(lighting.g, lighting.b)) / 0.5, 0.15, 1.0);
        col += lava.rgb * lava_mask * 0.45 * lava_glow;

        vec4 decal = texture2D(tex_decal, uv_level);
        float dry = 1.0 - lava_mask;
        // Декаль получает то же освещение, что и поверхность пола под ней.
        // Без этого в тёмных коридорах кровь и следы попаданий «светятся».
        col = col * (1.0 - decal.a * dry) + decal.rgb * dry * lighting;

        col = apply_dist_fog(col, v_world_pos, cam_pos.xyz);
        gl_FragColor = vec4(col, 1.0);
    }`;

    const frag_wall = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex_wall;
    uniform sampler2D tex_wall_decal;
    uniform vec4 scale_world;
    uniform vec4 cam_pos;
    uniform vec4 lightmap_params;
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying float v_height;
    varying vec2 v_atlas;
    ${LevelLighting.dynamicGlsl}
    ${LevelLighting.staticLightmapGlsl}
    ${FOG_MIX_GLSL}
    ${SHADOW_GLSL}

    void main()
    {
        vec3 n = normalize(v_normal);
        vec4 wall = texture2D(tex_wall, v_uv);
        vec3 albedo = wall.rgb;
        vec2 uv_level = vec2(v_world.x * scale_world.x, 1.0 - v_world.y * scale_world.x);

        float h_attn = smoothstep(0.0, 0.7, v_height) - smoothstep(3.6, 4.0, v_height);
        h_attn = clamp(h_attn * 1.05, 0.45, 1.0);

        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        float lmStep = lightmap_params.x;
        vec3 lm = texture2D(tex_lightmap, uv_level).rgb;
        lm += texture2D(tex_lightmap, uv_level + vec2(lmStep, 0.0)).rgb;
        lm += texture2D(tex_lightmap, uv_level - vec2(lmStep, 0.0)).rgb;
        lm += texture2D(tex_lightmap, uv_level + vec2(0.0, lmStep)).rgb;
        lm += texture2D(tex_lightmap, uv_level - vec2(0.0, lmStep)).rgb;
        lighting += lm * 0.2 * h_attn;
        lighting += accum_dyn_lights(v_world_pos, vec3(0.0));
        lighting = apply_sun_wall(lighting, v_world_pos, n, v_height);

        vec3 col = albedo * lighting;

        vec4 decal = texture2D(tex_wall_decal, v_atlas);
        // Декаль получает то же освещение, что и стена под ней (premultiplied).
        col = col * (1.0 - decal.a) + decal.rgb * lighting;

        col = apply_dist_fog(col, v_world_pos, cam_pos.xyz);
        gl_FragColor = vec4(col, 1.0);
    }`;

    const frag_ceiling = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex_wall;
    uniform vec4 scale_world;
    uniform vec4 cam_pos;
    varying vec3 v_world_pos;
    varying vec2 v_uv;
    ${LevelLighting.dynamicGlsl}
    ${LevelLighting.staticLightmapGlsl}
    ${FOG_MIX_GLSL}

    void main()
    {
        vec4 wall = texture2D(tex_wall, v_uv);
        vec3 albedo = wall.rgb * 0.45;
        vec2 uv_level = vec2(v_world_pos.x * scale_world.x, 1.0 - v_world_pos.z * scale_world.x);
        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        // Статические факелы хорошо ложатся и на потолок; лёгкое занижение —
        // потолок физически выше уровня факелов.
        lighting += sample_static_lightmap(uv_level) * 0.9;
        lighting += accum_dyn_lights(v_world_pos, vec3(0.0, -1.0, 0.0));
        vec3 col = albedo * lighting;
        col = apply_dist_fog(col, v_world_pos, cam_pos.xyz);
        gl_FragColor = vec4(col, 1.0);
    }`;

    const frag_bridge = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex_wall;
    uniform sampler2D tex_decal;
    uniform vec4 scale_world;
    uniform vec4 cam_pos;
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying float v_height;
    ${LevelLighting.dynamicGlsl}
    ${LevelLighting.staticLightmapGlsl}
    ${FOG_MIX_GLSL}
    ${SHADOW_GLSL}

    void main()
    {
        vec3 n = normalize(v_normal);
        vec4 wood = texture2D(tex_wall, v_uv);
        vec3 tint = vec3(0.82, 0.55, 0.30);
        float plank = abs(fract(v_uv.x * 4.0) - 0.5);
        float plank_line = smoothstep(0.46, 0.5, plank);

        vec3 albedo = wood.rgb * tint;
        albedo *= 1.0 - plank_line * 0.45;

        vec2 uv_level = vec2(v_world.x * scale_world.x, 1.0 - v_world.y * scale_world.x);
        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        lighting += sample_static_lightmap(uv_level);
        lighting += accum_dyn_lights(v_world_pos, n);
        lighting = apply_sun(lighting, v_world_pos, n, 1.0);
        vec3 col = albedo * lighting;

        vec4 decal = texture2D(tex_decal, uv_level);
        // Декаль получает то же освещение, что и доска моста под ней.
        col = col * (1.0 - decal.a) + decal.rgb * lighting;

        col = apply_dist_fog(col, v_world_pos, cam_pos.xyz);
        gl_FragColor = vec4(col, 1.0);
    }`;

    const vert_minimap = `
    attribute vec4 position;
    uniform mat4 mat_pos;
    varying vec4 texcoord;
    void main()
    {
        gl_Position = mat_pos * position;
        texcoord = position * 0.5 + 0.5;
    }`;

    const frag_minimap = `
    #ifdef GL_ES
    precision highp float;
    #endif
    varying vec4 texcoord;
    uniform sampler2D levelmap;
    uniform vec4 pos;
    uniform vec4 player_angle;
    uniform vec4 time;

    void main(void)
    {
        vec2 p = texcoord.xy * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;

        // Вращаем сэмпл вокруг позиции игрока: центр круга = игрок, вверх = взгляд.
        float ca = cos(player_angle.x);
        float sa = sin(player_angle.x);
        vec2 rot = vec2(p.x * ca + p.y * sa, -p.x * sa + p.y * ca);

        // pos приходит в формате (-0.5..0.5); добавляем 0.5, чтобы получить UV (0..1).
        vec2 player_uv = pos.xy + 0.5;
        vec2 sample_uv = player_uv + rot * 0.5;

        // Отсекаем всё, что за пределами уровня — иначе CLAMP_TO_EDGE
        // протягивает краевые пиксели (часто лаву) наружу.
        vec2 inside = step(vec2(0.0), sample_uv) * step(sample_uv, vec2(1.0));
        float inside_mask = inside.x * inside.y;

        vec4 level = texture2D(levelmap, sample_uv);
        level = clamp((level * 2.0 - 1.0), 0.0, 1.0);
        level.rg *= inside_mask;

        // Маски: внутри карты, на рамке, и плавный край.
        float map_mask    = 1.0 - smoothstep(0.91, 0.95, r);
        float border_mask = smoothstep(0.91, 0.95, r) * (1.0 - smoothstep(0.98, 1.0, r));

        // Точка игрока — красный кружок в центре.
        float dot_glow = smoothstep(0.06, 0.0, r);

        // Анимация лавы: две бегущие синус-волны имитируют течение, как в 2D.
        float t = time.x;
        float flow1 = sin(sample_uv.x * 38.0 + sample_uv.y * 17.0 + t * 1.8);
        float flow2 = sin(sample_uv.x * 22.0 - sample_uv.y * 31.0 - t * 1.3);
        float flow = flow1 * 0.5 + flow2 * 0.5;
        float lava_pulse = 0.78 + 0.22 * flow;

        vec3 bg_col = vec3(0.10, 0.12, 0.16);
        vec3 floor_col = vec3(0.42, 0.46, 0.52);
        vec3 lava_hot  = vec3(1.0,  0.55, 0.15);
        vec3 lava_cool = vec3(0.55, 0.10, 0.02);
        vec3 lava_col = mix(lava_cool, lava_hot, lava_pulse);

        vec3 map_col = mix(bg_col, floor_col, level.g);
        map_col = mix(map_col, lava_col, level.r);
        float map_alpha = 0.65 + level.g * 0.2 + level.r * 0.3;

        map_col = mix(map_col, vec3(1.0, 0.25, 0.2), dot_glow);
        map_alpha = max(map_alpha, dot_glow);

        vec3 col = mix(vec3(1.0), map_col, map_mask);
        float alpha = mix(border_mask * 0.7, map_alpha, map_mask);

        gl_FragColor = vec4(col, alpha);
    }`;

    const shader_floor = new Shader(vert_world, frag_floor, [
      'view_proj',
      'levelmap',
      'tex_ground_1',
      'tex_ground_2',
      'tex_lava',
      'tex_velocity',
      'tex_wave',
      'tex_decal',
      'tex_lightmap',
      'tex_visible',
      'scale_world',
      'time',
      'cam_pos',
      'lava_params',
      'dyn_light_count',
      'tex_shadow',
      'light_vp',
      'shadow_params',
      'sun_dir',
    ]);
    const shader_wall = new Shader(vert_wall, frag_wall, [
      'view_proj',
      'tex_wall',
      'tex_wall_decal',
      'tex_lightmap',
      'tex_visible',
      'scale_world',
      'cam_pos',
      'lightmap_params',
      'dyn_light_count',
      'tex_shadow',
      'light_vp',
      'shadow_params',
      'sun_dir',
    ]);
    const shader_ceiling = new Shader(vert_world, frag_ceiling, [
      'view_proj',
      'tex_wall',
      'tex_lightmap',
      'tex_visible',
      'scale_world',
      'cam_pos',
      'dyn_light_count',
    ]);
    const shader_bridge = new Shader(vert_world, frag_bridge, [
      'view_proj',
      'tex_wall',
      'tex_decal',
      'tex_lightmap',
      'tex_visible',
      'scale_world',
      'cam_pos',
      'dyn_light_count',
      'tex_shadow',
      'light_vp',
      'shadow_params',
      'sun_dir',
    ]);
    const shader_minimap = new Shader(vert_minimap, frag_minimap, [
      'mat_pos',
      'levelmap',
      'pos',
      'player_angle',
      'time',
    ]);

    // Объёмный туман вынесен в VolumetricFog (camera-facing слайсы с 3D fbm-шумом
    // + depth-prepass для soft-particles). fogCam — камерный базис, его же читает
    // геометрия уровня для distance-fog; обновляется в buildViewProjection.
    const fogCam = {
      eye: [0, eye_height, 0],
      fwd: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
      tanY: Math.tan(Math.PI * 0.21),
      aspect: 1,
    };
    const fog = new VolumetricFog(size);

    // Карта теней от солнца. Границы уровня: X/Z в [0, size], Y до высоты стены
    // плюс запас на персонажей/предметы.
    const shadowMap = new ShadowMap(2048);
    // Радиус (полусторона) сфокусированной на игроке теневой области в мире.
    const SHADOW_RADIUS = 18;
    const SUN_INTENSITY = 0.5;
    const SHADOW_BIAS = 0.0022;
    // Базовый сдвиг точки сэмпла вдоль нормали (метры) против self-shadow acne.
    // Стены вертикальны и под скользящим углом к солнцу — нужен заметный сдвиг.
    const SHADOW_NORMAL_OFFSET = 0.16;
    let shadowVP = null;

    // --- Стенные декали: привязка к сегментам marching squares (как makeWallMesh) ---
    const wall_segments = [];
    const decals = new LevelDecals(size, wall_height, my_level, wall_segments);

    const uv_loc = shader_floor.attrib('texuv');
    const normal_loc = shader_floor.attrib('normal');
    const wall_atlas_loc = shader_wall.attrib('atlasuv');

    function isWall(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return true;
      return raw.getData(x, y) > 0.5;
    }

    const lighting = new LevelLighting(size, wall_height, isWall);
    const lights_loc_floor = lighting.locs(shader_floor);
    const lights_loc_wall = lighting.locs(shader_wall);
    const lights_loc_ceiling = lighting.locs(shader_ceiling);
    const lights_loc_bridge = lighting.locs(shader_bridge);

    function tessellateWallMesh() {
      const mesh = new MeshBuilder();

      // Сглаживание ГЕОМЕТРИИ стены: контур marching squares — это полилиния из
      // прямых сегментов, и на свету/тенях видны её грани. Изгибаем промежуточные
      // вершины сегмента по сплайну Catmull-Rom через соседние узлы контура. Концы
      // сегментов фиксированы (общие у соседей) → никаких щелей; касательные в узле
      // совпадают у соседних сегментов → гладкие и геометрия, и нормали. Резкие
      // повороты (угол комнаты) распознаём порогом и оставляем прямыми.
      const epKey = (x, z) => x.toFixed(4) + ',' + z.toFixed(4);
      const epAdj = new Map(); // узел -> список дальних концов примыкающих сегментов
      const pushAdj = (k, far) => {
        let a = epAdj.get(k);
        if (!a) {
          a = [];
          epAdj.set(k, a);
        }
        a.push(far);
      };
      for (let si = 0; si < wall_segments.length; si++) {
        const s = wall_segments[si];
        pushAdj(epKey(s.p0[0], s.p0[1]), s.p1);
        pushAdj(epKey(s.p1[0], s.p1[1]), s.p0);
      }
      const COS_TURN = 0.5; // <60° поворота — сглаживаем; резче (~угол 90°) — прямо
      const CURVE_DEV_THRESH = 0.045;
      const WALL_CURVE_STEP = 0.55;
      const WALL_CURVE_MAX = 6;
      const splineMid = (p0, p1, m0x, m0z, m1x, m1z) => [
        0.5 * p0[0] + 0.125 * m0x + 0.5 * p1[0] - 0.125 * m1x,
        0.5 * p0[1] + 0.125 * m0z + 0.5 * p1[1] - 0.125 * m1z,
      ];
      const segCurveDev = (p0, p1, m0x, m0z, m1x, m1z) => {
        const s = splineMid(p0, p1, m0x, m0z, m1x, m1z);
        return Math.hypot(s[0] - (p0[0] + p1[0]) * 0.5, s[1] - (p0[1] + p1[1]) * 0.5);
      };
      const eqPt = (a, bx, bz) => Math.abs(a[0] - bx) < 1e-5 && Math.abs(a[1] - bz) < 1e-5;
      // Сосед в узле (atx,atz), лучше всего продолжающий направление segDir.
      // incoming=true — ищем точку ПЕРЕД узлом (dir far->at ~ segDir);
      // incoming=false — точку ПОСЛЕ узла (dir at->far ~ segDir). exclude — этот сегмент.
      const pickNeighbor = (atKey, atx, atz, sdx, sdz, exX, exZ, incoming) => {
        const list = epAdj.get(atKey);
        if (!list) return null;
        let best = null;
        let bestDot = COS_TURN;
        for (let i = 0; i < list.length; i++) {
          const far = list[i];
          if (eqPt(far, exX, exZ)) continue;
          let vx, vz;
          if (incoming) {
            vx = atx - far[0];
            vz = atz - far[1];
          } else {
            vx = far[0] - atx;
            vz = far[1] - atz;
          }
          const l = Math.hypot(vx, vz) || 1;
          const d = (vx / l) * sdx + (vz / l) * sdz;
          if (d > bestDot) {
            bestDot = d;
            best = far;
          }
        }
        return best;
      };

      const segCols = [];
      for (let si = 0; si < wall_segments.length; si++) {
        const seg = wall_segments[si];
        const p0 = seg.p0;
        const p1 = seg.p1;
        const nx = seg.nx;
        const nz = seg.nz;
        const segLen = seg.len;

        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];

        const sdx = dx / segLen;
        const sdz = dz / segLen;
        const prev = pickNeighbor(epKey(p0[0], p0[1]), p0[0], p0[1], sdx, sdz, p1[0], p1[1], true);
        const next = pickNeighbor(epKey(p1[0], p1[1]), p1[0], p1[1], sdx, sdz, p0[0], p0[1], false);
        const m0x = prev ? (p1[0] - prev[0]) * 0.5 : dx;
        const m0z = prev ? (p1[1] - prev[1]) * 0.5 : dz;
        const m1x = next ? (next[0] - p0[0]) * 0.5 : dx;
        const m1z = next ? (next[1] - p0[1]) * 0.5 : dz;
        const curveDev = segCurveDev(p0, p1, m0x, m0z, m1x, m1z);
        const curved = curveDev > CURVE_DEV_THRESH;
        const nu = curved
          ? Math.min(WALL_CURVE_MAX, Math.max(2, Math.ceil(segLen / WALL_CURVE_STEP)))
          : 1;

        const cols = new Array(nu + 1);
        for (let i = 0; i <= nu; i++) {
          const t = i / nu;
          const t2 = t * t;
          const t3 = t2 * t;
          const h00 = 2 * t3 - 3 * t2 + 1;
          const h10 = t3 - 2 * t2 + t;
          const h01 = -2 * t3 + 3 * t2;
          const h11 = t3 - t2;
          const px = h00 * p0[0] + h10 * m0x + h01 * p1[0] + h11 * m1x;
          const pz = h00 * p0[1] + h10 * m0z + h01 * p1[1] + h11 * m1z;
          const g00 = 6 * t2 - 6 * t;
          const g10 = 3 * t2 - 4 * t + 1;
          const g01 = -6 * t2 + 6 * t;
          const g11 = 3 * t2 - 2 * t;
          const tx = g00 * p0[0] + g10 * m0x + g01 * p1[0] + g11 * m1x;
          const tz = g00 * p0[1] + g10 * m0z + g01 * p1[1] + g11 * m1z;
          let cnx = -tz;
          let cnz = tx;
          const cl = Math.hypot(cnx, cnz) || 1;
          cnx /= cl;
          cnz /= cl;
          if (cnx * nx + cnz * nz < 0) {
            cnx = -cnx;
            cnz = -cnz;
          }
          cols[i] = [px, pz, cnx, cnz];
        }
        cols[0][0] = p0[0];
        cols[0][1] = p0[1];
        cols[nu][0] = p1[0];
        cols[nu][1] = p1[1];
        segCols.push({ seg, cols, nu, prev, next });
      }

      // Сварка нормалей в общих узлах контура — убирает «рёбра плиток» на стыках
      // соседних сегментов marching squares.
      const epNormals = new Map();
      const accEpNormal = (key, nx, nz) => {
        let e = epNormals.get(key);
        if (!e) {
          e = { nx: 0, nz: 0, n: 0 };
          epNormals.set(key, e);
        }
        e.nx += nx;
        e.nz += nz;
        e.n += 1;
      };
      for (let si = 0; si < segCols.length; si++) {
        const { seg, cols, nu } = segCols[si];
        accEpNormal(epKey(seg.p0[0], seg.p0[1]), cols[0][2], cols[0][3]);
        accEpNormal(epKey(seg.p1[0], seg.p1[1]), cols[nu][2], cols[nu][3]);
      }
      const weldedNormal = (key, nx, nz) => {
        const e = epNormals.get(key);
        if (!e || e.n < 2) return [nx, nz];
        const l = Math.hypot(e.nx, e.nz) || 1;
        return [e.nx / l, e.nz / l];
      };

      const wall_base = 0;
      for (let si = 0; si < segCols.length; si++) {
        const { seg, cols, nu, prev, next } = segCols[si];
        const segLen = seg.len;
        const r = seg.atlasRect;
        const iu0 = r ? r.u0 : 0;
        const iu1 = r ? r.u1 : 0;
        const iv0 = r ? r.v0 : 0;
        const iv1 = r ? r.v1 : 0;

        const w0 = weldedNormal(epKey(seg.p0[0], seg.p0[1]), cols[0][2], cols[0][3]);
        const w1 = weldedNormal(epKey(seg.p1[0], seg.p1[1]), cols[nu][2], cols[nu][3]);
        cols[0][2] = w0[0];
        cols[0][3] = w0[1];
        cols[nu][2] = w1[0];
        cols[nu][3] = w1[1];

        // Размазываем сваренную нормаль вдоль сегмента у узлов — убирает резкий
        // перелом ndl/теней на последних «плитках» перед углом.
        const normSpan = Math.max(2, Math.min(8, Math.ceil(nu * 0.22)));
        if (prev) {
          for (let i = 1; i < normSpan && i < nu; i++) {
            const t = i / normSpan;
            let nx = w0[0] + (cols[i][2] - w0[0]) * t;
            let nz = w0[1] + (cols[i][3] - w0[1]) * t;
            const l = Math.hypot(nx, nz) || 1;
            cols[i][2] = nx / l;
            cols[i][3] = nz / l;
          }
        }
        if (next) {
          for (let i = nu - 1; i > nu - normSpan && i > 0; i--) {
            const t = (nu - i) / normSpan;
            let nx = w1[0] + (cols[i][2] - w1[0]) * t;
            let nz = w1[1] + (cols[i][3] - w1[1]) * t;
            const l = Math.hypot(nx, nz) || 1;
            cols[i][2] = nx / l;
            cols[i][3] = nz / l;
          }
        }

        const y0 = wall_base;
        const y1 = wall_height;
        for (let i = 0; i < nu; i++) {
          const A = cols[i];
          const B = cols[i + 1];
          const ax = A[0],
            az = A[1];
          const bx = B[0],
            bz = B[1];
          const su0 = (segLen * i) / nu,
            su1 = (segLen * (i + 1)) / nu;
          const au0 = r ? iu0 + (su0 / segLen) * (iu1 - iu0) : 0;
          const au1 = r ? iu0 + (su1 / segLen) * (iu1 - iu0) : 0;
          const av0 = r ? iv0 + (y0 / wall_height) * (iv1 - iv0) : 0;
          const av1 = r ? iv0 + (y1 / wall_height) * (iv1 - iv0) : 0;

          mesh.wallVertex(ax, y0, az, su0, y0, A[2], 0, A[3], au0, av0);
          mesh.wallVertex(bx, y0, bz, su1, y0, B[2], 0, B[3], au1, av0);
          mesh.wallVertex(bx, y1, bz, su1, y1, B[2], 0, B[3], au1, av1);
          mesh.wallVertex(ax, y0, az, su0, y0, A[2], 0, A[3], au0, av0);
          mesh.wallVertex(bx, y1, bz, su1, y1, B[2], 0, B[3], au1, av1);
          mesh.wallVertex(ax, y1, az, su0, y1, A[2], 0, A[3], au0, av1);
        }
      }
      return mesh.build(10);
    }

    const LAVA_RECESS_DEPTH = 0.14;

    function sampleRiverBilinear(wx, wz) {
      const river = level.getRiverMap();
      const ms = river.getSize();
      const fx = (wx / size) * (ms - 1);
      const fy = (wz / size) * (ms - 1);
      const x0 = Math.max(0, Math.min(ms - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(ms - 1, Math.floor(fy)));
      const x1 = Math.min(ms - 1, x0 + 1);
      const y1 = Math.min(ms - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const v00 = river.getData(x0, y0);
      const v10 = river.getData(x1, y0);
      const v01 = river.getData(x0, y1);
      const v11 = river.getData(x1, y1);
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }

    function lavaRecessFactor(riverVal) {
      const t = Math.max(0, Math.min(1, (riverVal - 0.34) / (0.58 - 0.34)));
      return t * t * (3 - 2 * t);
    }

    function floorHeight(wx, wz) {
      return -lavaRecessFactor(sampleRiverBilinear(wx, wz)) * LAVA_RECESS_DEPTH;
    }

    function floorNormal(wx, wz) {
      const e = 0.22;
      const ddx = (floorHeight(wx + e, wz) - floorHeight(wx - e, wz)) / (2 * e);
      const ddz = (floorHeight(wx, wz + e) - floorHeight(wx, wz - e)) / (2 * e);
      const nx = -ddx;
      const ny = 1;
      const nz = -ddz;
      const len = Math.hypot(nx, ny, nz) || 1;
      return [nx / len, ny / len, nz / len];
    }

    function addFloorCell(mesh, x0, z0, x1, z1, uvScale) {
      const corners = [
        [x0, z0, 0, 0],
        [x1, z0, 1, 0],
        [x1, z1, 1, 1],
        [x0, z1, 0, 1],
      ];
      const pts = corners.map(([x, z, u, v]) => {
        const y = floorHeight(x, z);
        const n = floorNormal(x, z);
        return { x, y, z, u: u * uvScale, v: v * uvScale, n };
      });
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        for (let i = 0; i < 3; i++) {
          const p = pts[tri[i]];
          mesh.vertex(p.x, p.y, p.z, p.u, p.v, p.n[0], p.n[1], p.n[2]);
        }
      }
    }

    const FLOOR_MIN_CELL = 2.5;
    const FLOOR_MAX_DEPTH = 6;
    const FLOOR_LAVA_SKIP = 0.3;

    function floorNeedsSubdivide(x0, z0, x1, z1, cellW, cellH) {
      if (cellW <= FLOOR_MIN_CELL && cellH <= FLOOR_MIN_CELL) return false;

      const r00 = sampleRiverBilinear(x0, z0);
      const r10 = sampleRiverBilinear(x1, z0);
      const r01 = sampleRiverBilinear(x0, z1);
      const r11 = sampleRiverBilinear(x1, z1);
      const rMax = Math.max(r00, r10, r01, r11);
      // Далеко от лавы пол практически плоский — один квад на ячейку.
      if (rMax < FLOOR_LAVA_SKIP) return false;

      const h00 = floorHeight(x0, z0);
      const h10 = floorHeight(x1, z0);
      const h01 = floorHeight(x0, z1);
      const h11 = floorHeight(x1, z1);
      if (Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11) > 0.018) return true;

      const hMid = floorHeight((x0 + x1) * 0.5, (z0 + z1) * 0.5);
      const hAvg = (h00 + h10 + h01 + h11) * 0.25;
      if (Math.abs(hMid - hAvg) > 0.012) return true;

      if (Math.max(r00, r10, r01, r11) - Math.min(r00, r10, r01, r11) > 0.18) return true;

      const n0 = floorNormal(x0, z0);
      const n1 = floorNormal(x1, z1);
      const n2 = floorNormal(x0, z1);
      const n3 = floorNormal(x1, z0);
      const minDot = Math.min(
        n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2],
        n0[0] * n2[0] + n0[1] * n2[1] + n0[2] * n2[2],
        n0[0] * n3[0] + n0[1] * n3[1] + n0[2] * n3[2],
        n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2],
        n1[0] * n3[0] + n1[1] * n3[1] + n1[2] * n3[2],
        n2[0] * n3[0] + n2[1] * n3[1] + n2[2] * n3[2],
      );
      return minDot < 0.992;
    }

    function addFloorAdaptive(mesh, x0, z0, x1, z1, depth, uvScale) {
      const cellW = x1 - x0;
      const cellH = z1 - z0;
      if (depth >= FLOOR_MAX_DEPTH || !floorNeedsSubdivide(x0, z0, x1, z1, cellW, cellH)) {
        addFloorCell(mesh, x0, z0, x1, z1, uvScale);
        return;
      }
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      addFloorAdaptive(mesh, x0, z0, mx, mz, depth + 1, uvScale);
      addFloorAdaptive(mesh, mx, z0, x1, mz, depth + 1, uvScale);
      addFloorAdaptive(mesh, x0, mz, mx, z1, depth + 1, uvScale);
      addFloorAdaptive(mesh, mx, mz, x1, z1, depth + 1, uvScale);
    }

    function makeFloorMesh() {
      const tex_repeat = size / 4;
      const rootDiv = Math.max(4, Math.min(12, size >> 3));
      const rootStep = size / rootDiv;
      const mesh = new MeshBuilder();
      for (let iz = 0; iz < rootDiv; iz++) {
        for (let ix = 0; ix < rootDiv; ix++) {
          addFloorAdaptive(
            mesh,
            ix * rootStep,
            iz * rootStep,
            (ix + 1) * rootStep,
            (iz + 1) * rootStep,
            0,
            tex_repeat,
          );
        }
      }
      return mesh.build();
    }

    function makeCeilingMesh() {
      const tex_repeat = size / 8;
      return new MeshBuilder()
        .quad(
          [0, wall_height, size],
          [size, wall_height, size],
          [size, wall_height, 0],
          [0, wall_height, 0],
          [0, -1, 0],
          [tex_repeat, tex_repeat],
        )
        .build();
    }

    function makeWallMesh() {
      // Макс. длина тайла в мир-юнитах при минимальном PPU и 4096² атласе.
      const maxTileLen =
        (4096 - 2 * LevelDecals.WALL_ATLAS_PAD - 1) / LevelDecals.WALL_PPU_MIN;
      const segs = splitLongWallSegments(
        mergeWallSegments(buildWallSegments(groundMap, mapCells, mapScale)),
        maxTileLen,
      );
      wall_segments.length = 0;
      for (let i = 0; i < segs.length; i++) wall_segments.push(segs[i]);
      decals.packWallAtlas();
      return tessellateWallMesh();
    }

    function makeBridgesMesh() {
      const mesh = new MeshBuilder();
      const bridges = level.getBridges().getBridges();
      const plank_thick = 0.22;
      for (let i = 0; i < bridges.length; i++) {
        const br = bridges[i];
        const halfLen = br.size.x * 0.5 + 1.0;
        const halfWid = br.size.y * 0.5;
        const a = -br.angle;
        mesh.box(
          [br.pos.x, plank_thick * 0.5, br.pos.y],
          [halfLen, plank_thick * 0.5, halfWid],
          a,
          [halfLen * 0.6, halfWid * 0.6],
        );
      }
      return mesh.build();
    }

    const floor_mesh = makeFloorMesh();
    const ceiling_mesh = makeCeilingMesh();
    const wall_mesh = makeWallMesh();
    const bridges_mesh = makeBridgesMesh();

    // Локации атрибутов мешей (texuv/normal/atlasuv) для Mesh.bind/unbind.
    const meshLocs = { uv: uv_loc, normal: normal_loc, wallAtlas: wall_atlas_loc };

    function buildViewProjection(camera) {
      const mat4 = state.mat4;
      const aspect = state.canvas.width / state.canvas.height;
      const projection = mat4.create();
      const view = mat4.create();
      const view_proj = mat4.create();
      const pitch = getMousePitch();
      const yaw = camera.angle;
      const cp = Math.cos(pitch);

      const eye = [camera.pos.x, eye_height, camera.pos.y];
      const forward = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
      const target = [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]];

      const fovY = Math.PI * 0.42;
      mat4.perspective(projection, fovY, aspect, 0.05, size * 2);
      mat4.lookAt(view, eye, target, [0, 1, 0]);
      mat4.mul(view_proj, projection, view);

      // Базис камеры для объёмного тумана (camera-facing слайсы).
      let rx = forward[2],
        ry = 0,
        rz = -forward[0]; // forward × up(0,1,0)
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      // up = right × forward
      const ux = ry * forward[2] - rz * forward[1];
      const uy = rz * forward[0] - rx * forward[2];
      const uz = rx * forward[1] - ry * forward[0];
      fogCam.eye = eye;
      fogCam.fwd = forward;
      fogCam.right = [rx, ry, rz];
      fogCam.up = [ux, uy, uz];
      fogCam.tanY = Math.tan(fovY * 0.5);
      fogCam.aspect = aspect;
      return view_proj;
    }

    function calc_minimap_position(camera) {
      return Vector.mul(camera.pos, 1 / size)
        .mul2(1, -1)
        .add2(-0.5, 0.5);
    }

    this.isFirstPerson3D = true;
    this.eye_height = eye_height;
    this.tex_visible_id = fbo_visible.getTexture();
    this.levelmapTexId = null;
    this.levelSize = size;
    this.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
    this.clearDynamicLights = lighting.clearDynamicLights.bind(lighting);
    this.addDynamicLight = lighting.addDynamicLight.bind(lighting);
    this.getActiveLights = function () {
      return lighting.active();
    };
    this.getLightmapTexId = function () {
      return lighting.texture();
    };
    this.getLevelInvSize = function () {
      return 1 / size;
    };
    // Depth-текстура сцены (тот же depth-prepass, что и для объёмного тумана) —
    // нужна Q2FX для soft-particles и фаербола взрыва. near/far совпадают с
    // линеаризацией в шейдере тумана (screen_p.zw).
    this.getSceneDepthInfo = function () {
      return fog.depthInfo();
    };

    // Туман войны отключён: за углами ничего не прячем (стены и так перекрывает
    // depth-тест), а «туман» создают объёмные billboard-слайсы, наслаивающиеся
    // с дистанцией. Геттеры оставлены для совместимости с вызовами в клиенте.
    // Прямая видимость по стенам (DDA по тайловой сетке). Конечную клетку не
    // проверяем — цель может стоять вплотную к стене. Нужна, чтобы эффекты
    // (трассеры/лучи) не светили сквозь стены.
    this.hasLineOfSight = function (from, to) {
      if (!from || !to) return true;
      const x0 = from.x,
        y0 = from.y;
      let dx = to.x - x0,
        dy = to.y - y0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1e-4) return true;
      const steps = Math.ceil(dist / 0.25);
      const sx = dx / steps,
        sy = dy / steps;
      let cx = x0,
        cy = y0;
      for (let i = 0; i < steps - 1; i++) {
        cx += sx;
        cy += sy;
        if (isWall(Math.floor(cx), Math.floor(cy))) return false;
      }
      return true;
    };
    // Чисто дистанционный туман (без learn-of-sight): формула совпадает с
    // apply_dist_fog в шейдерах геометрии (start 5, dens 0.072), чтобы мобы и
    // айтемы растворялись в тумане синхронно со стенами.
    this.getWorldFog = function (from, to) {
      if (!from || !to) return 0;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      // Должна совпадать с dist_fog_amount в шейдерах (квадратичная кривая).
      const d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - 4);
      const t = 0.02 * d + 0.0045 * d * d;
      return Math.min(1, Math.max(0, 1 - Math.exp(-t)));
    };
    this.mixFogRgb = function (rgb, distFog, strength) {
      const t = Math.min(1, Math.max(0, distFog || 0)) * (strength !== undefined ? strength : 0.96);
      const fog = [0.012, 0.018, 0.032];
      return [
        rgb[0] * (1 - t) + fog[0] * t,
        rgb[1] * (1 - t) + fog[1] * t,
        rgb[2] * (1 - t) + fog[2] * t,
      ];
    };
    this.isWorldVisible = function () {
      return true;
    };
    this.getLightLevel = function (x, z) {
      return lighting.lightLevel(AMBIENT_BASE, x, z);
    };
    if (state.LevelRender) {
      state.LevelRender.levelmapTexId = null;
      state.LevelRender.levelSize = size;
      state.LevelRender.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
      state.LevelRender.clearDynamicLights = this.clearDynamicLights;
      state.LevelRender.addDynamicLight = this.addDynamicLight;
      state.LevelRender.getActiveLights = this.getActiveLights;
      state.LevelRender.getLightmapTexId = this.getLightmapTexId;
      state.LevelRender.getLevelInvSize = this.getLevelInvSize;
      state.LevelRender.getSceneDepthInfo = this.getSceneDepthInfo;
      state.LevelRender.hasLineOfSight = this.hasLineOfSight;
      state.LevelRender.getWorldFog = this.getWorldFog;
      state.LevelRender.mixFogRgb = this.mixFogRgb;
      state.LevelRender.getLightLevel = this.getLightLevel;
      state.LevelRender.isWorldVisible = this.isWorldVisible;
    }
    this.ready = function () {
      return (
        tex_ground2 !== null &&
        tex_ground1.ready() &&
        tex_ground2.ready() &&
        tex_wall.ready() &&
        tex_bridge.ready() &&
        tex_lava.ready() &&
        tex_noise.ready()
      );
    };
    this.getLevel = function () {
      return my_level;
    };
    this.getDecal = function () {
      return decals.adapter();
    };
    let visFrame = 0;
    this.beginFrame = function (camera) {
      state.viewProj3D = buildViewProjection(camera);
      visFrame++;
      if (visFrame === 1 || visFrame % 4 === 0) {
        renderVisibleMap(camera);
        state.LevelRender.tex_visible_id = fbo_visible.getTexture();
      }
      state.LevelRender.eye_height = eye_height;
      state.LevelRender.levelmapTexId = levelmap.getId();
      state.LevelRender.levelSize = size;
      state.LevelRender.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
      lighting.selectActive(camera);
    };
    // Проход карты теней: глубина статической геометрии + динамических кастеров
    // (боты, предметы) из light-space. drawCasters(lightVP) дорисовывает динамику.
    this.renderShadows = function (camera, drawCasters) {
      if (!shadowMap.ok || !this.ready()) {
        shadowVP = null;
        return;
      }
      // Фокус теневой карты — вокруг игрока (его позиция в мире XZ, середина по высоте).
      const cx = camera && camera.pos ? camera.pos.x : size * 0.5;
      const cz = camera && camera.pos ? camera.pos.y : size * 0.5;
      const center = [cx, wall_height * 0.5, cz];
      const vp = shadowMap.begin(this.sunDir, center, SHADOW_RADIUS);
      if (!vp) {
        shadowVP = null;
        return;
      }
      shadowMap.drawWorld(vp, [wall_mesh, bridges_mesh]);
      if (drawCasters) drawCasters(vp);
      shadowMap.end();
      shadowVP = vp;
    };
    // Глубину произвольного локального буфера (иконки, прочее) — в карту теней.
    this.shadowDrawLocal = function (mvp, buffer, stride, count) {
      shadowMap.drawLocal(mvp, buffer, stride, count);
    };
    if (state.LevelRender) {
      state.LevelRender.renderShadows = this.renderShadows;
      state.LevelRender.shadowDrawLocal = this.shadowDrawLocal;
    }

    const applyShadow = (shader, unit) => {
      const enabled = shadowMap.ok && shadowVP ? 1 : 0;
      shader.texture(shader.tex_shadow, enabled ? shadowMap.texture() : tex_visible_black, unit);
      if (shadowVP) shader.matrix(shader.light_vp, shadowVP);
      shader.vector(shader.shadow_params, [
        shadowMap.texelSize(),
        SHADOW_NORMAL_OFFSET,
        SHADOW_BIAS,
        enabled,
      ]);
      shader.vector(shader.sun_dir, [
        this.sunDir[0],
        this.sunDir[1],
        this.sunDir[2],
        SUN_INTENSITY,
      ]);
    };

    this.render = function (camera) {
      if (!this.ready()) return;

      // Затухание декалей: каждый кадр FBO мультиплицируется на коэффициент.
      decals.fade();

      // Анимированный поток лавы — отдельный pre-pass в FBO, тот же шейдер, что в 2D.
      lavaFlow.render();

      // Активные точечные лайты (динамика). Статика уже запечена в lightmap.
      this.beginFrame(camera);

      // Глубина сцены в отдельный FBO — для soft-particles объёмного тумана.
      fog.prepass(state.viewProj3D, [floor_mesh, wall_mesh, ceiling_mesh, bridges_mesh]);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, state.canvas.width, state.canvas.height);
      gl.clearColor(0.08, 0.1, 0.13, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);

      const view_proj = state.viewProj3D;
      const detail_scale = (10 * size) / 64 / size;
      const level_scale = 1 / size;
      const t = (Date.now() % 100000) * 0.001;
      const cam_eye_v = [fogCam.eye[0], fogCam.eye[1], fogCam.eye[2], 0];

      const decal_tex = decals.floorTexture();
      const lightmap_tex = lighting.texture();
      const visible_tex = fbo_visible.getTexture();

      shader_floor.use();
      shader_floor.matrix(shader_floor.view_proj, view_proj);
      shader_floor.vector(shader_floor.scale_world, [level_scale, detail_scale, 0, 0]);
      shader_floor.vector(shader_floor.cam_pos, cam_eye_v);
      shader_floor.vector(shader_floor.time, [t, t * 0.7, 0, 0]);
      // lava_params.x = tiling в координатах level UV, y = фазовое время 0..1.
      shader_floor.vector(shader_floor.lava_params, lavaFlow.params());
      shader_floor.texture(shader_floor.levelmap, levelmap.getId(), 0);
      shader_floor.texture(shader_floor.tex_ground_1, tex_ground1.getId(), 1);
      shader_floor.texture(shader_floor.tex_ground_2, tex_ground2.getId(), 2);
      shader_floor.texture(shader_floor.tex_lava, tex_lava.getId(), 3);
      shader_floor.texture(shader_floor.tex_velocity, tex_velocity.getId(), 4);
      shader_floor.texture(shader_floor.tex_wave, lavaFlow.texture(), 5);
      shader_floor.texture(shader_floor.tex_decal, decal_tex, 6);
      shader_floor.texture(shader_floor.tex_lightmap, lightmap_tex, 7);
      shader_floor.texture(shader_floor.tex_visible, visible_tex, 8);
      applyShadow(shader_floor, 9);
      lighting.apply(lights_loc_floor);
      floor_mesh.bind(meshLocs);
      if (isWireframe()) floor_mesh.drawDepthPrepass();
      else floor_mesh.draw();

      shader_wall.use();
      shader_wall.matrix(shader_wall.view_proj, view_proj);
      shader_wall.vector(shader_wall.scale_world, [level_scale, detail_scale * 0.6, 0, 0]);
      shader_wall.vector(shader_wall.cam_pos, cam_eye_v);
      shader_wall.vector(shader_wall.lightmap_params, [lighting.lightmapInvSize, 0, 0, 0]);
      shader_wall.texture(shader_wall.tex_wall, tex_wall.getId(), 0);
      shader_wall.texture(shader_wall.tex_lightmap, lightmap_tex, 1);
      shader_wall.texture(shader_wall.tex_visible, visible_tex, 2);
      shader_wall.texture(shader_wall.tex_wall_decal, decals.wallTexture() || tex_visible_black, 3);
      applyShadow(shader_wall, 4);
      lighting.apply(lights_loc_wall);
      wall_mesh.bind(meshLocs);
      if (isWireframe()) wall_mesh.drawDepthPrepass();
      else wall_mesh.draw();

      shader_ceiling.use();
      shader_ceiling.matrix(shader_ceiling.view_proj, view_proj);
      shader_ceiling.vector(shader_ceiling.scale_world, [level_scale, detail_scale, 0, 0]);
      shader_ceiling.vector(shader_ceiling.cam_pos, cam_eye_v);
      shader_ceiling.texture(shader_ceiling.tex_wall, tex_wall.getId(), 0);
      shader_ceiling.texture(shader_ceiling.tex_lightmap, lightmap_tex, 1);
      shader_ceiling.texture(shader_ceiling.tex_visible, visible_tex, 2);
      lighting.apply(lights_loc_ceiling);
      ceiling_mesh.bind(meshLocs);
      if (isWireframe()) ceiling_mesh.drawDepthPrepass();
      else ceiling_mesh.draw();

      if (bridges_mesh.count > 0) {
        shader_bridge.use();
        shader_bridge.matrix(shader_bridge.view_proj, view_proj);
        shader_bridge.vector(shader_bridge.scale_world, [level_scale, detail_scale * 0.7, 0, 0]);
        shader_bridge.vector(shader_bridge.cam_pos, cam_eye_v);
        shader_bridge.texture(shader_bridge.tex_wall, tex_bridge.getId(), 0);
        shader_bridge.texture(shader_bridge.tex_decal, decal_tex, 1);
        shader_bridge.texture(shader_bridge.tex_lightmap, lightmap_tex, 2);
        shader_bridge.texture(shader_bridge.tex_visible, visible_tex, 3);
        applyShadow(shader_bridge, 4);
        lighting.apply(lights_loc_bridge);
        bridges_mesh.bind(meshLocs);
        if (isWireframe()) bridges_mesh.drawDepthPrepass();
        else bridges_mesh.draw();
      }

      wall_mesh.unbind(meshLocs);
      ceiling_mesh.unbind(meshLocs);
    };
    this.drawLevelWire = function () {
      if (!this.ready() || !isWireframe()) return;
      floor_mesh.drawWire();
      wall_mesh.drawWire();
      ceiling_mesh.drawWire();
      if (bridges_mesh.count > 0) bridges_mesh.drawWire();
    };
    this.beginSpritePass = function () {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
    };
    this.endSpritePass = function () {
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
    };
    this.renderVolumetricFog = function () {
      if (!this.ready() || !state.viewProj3D) return;
      fog.render(state.viewProj3D, fogCam);
    };
    this.renderMinimap = function (camera) {
      if (!this.ready()) return;
      const mat4 = state.mat4;
      const pos = calc_minimap_position(camera);
      const aspect = state.canvas.width / state.canvas.height;
      const radius = 0.3;

      gl.enable(gl.BLEND);
      const mat_pos = mat4.create();
      mat4.trans(mat_pos, [-0.8, -0.7, 0]);
      mat4.scal(mat_pos, [radius / aspect, radius, 1]);

      const t = Date.now() * 0.001;
      shader_minimap.use();
      shader_minimap.matrix(shader_minimap.mat_pos, mat_pos);
      shader_minimap.texture(shader_minimap.levelmap, minimapTex.getId(), 0);
      shader_minimap.vector(shader_minimap.pos, [pos.x, pos.y, 0, 0]);
      shader_minimap.vector(shader_minimap.player_angle, [camera.angle || 0, 0, 0, 0]);
      shader_minimap.vector(shader_minimap.time, [t, 0, 0, 0]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    };
  }
}

export { LevelRender3D };
