import { Framebuffer } from '../engine/FBO.js';
import { Shader } from '../engine/shader.js';
import { Texture } from '../engine/texture.js';
import { state, getMousePitch } from '../runtime-state.js';
import { Buffer } from '../server/libs/buffer.js';
import { Vector } from '../server/libs/vector.js';

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

    const decalRes = Math.min(2048, Math.max(1280, size * 40));
    const fbo_decal_floor = new Framebuffer(decalRes, decalRes);
    fbo_decal_floor.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    fbo_decal_floor.unbind();

    // NEAREST + CLAMP: чёткие настенные следы без «швов» от LINEAR на границе
    // тайла атласа. На полу оставляем LINEAR (мягкие края, как и было).
    function setDecalTexSharp(tex) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    // Стенный decal-атлас создаётся после упаковки wall_segments (см. ниже).
    let fbo_decal_wall = null;
    let wallAtlasRes = 2048;
    let wallAtlasPpu = 32;
    const WALL_DECAL_HALF_LIFE_MS = 45000;
    const WALL_ATLAS_PAD = 2;
    // Выше PPU = больше текселей на мир-юнит = чётче след вблизи стены.
    const WALL_PPU_MIN = 16;
    const WALL_PPU_MAX = 64;

    // Lightmap FBO — запекаем сюда все статические источники света (факелы),
    // потом сэмплим в шейдерах геометрии. Так число «факелов» неограничено.
    const lightmapRes = Math.min(1024, Math.max(256, size * 8));
    const fbo_lightmap = new Framebuffer(lightmapRes, lightmapRes);
    fbo_lightmap.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    fbo_lightmap.unbind();

    const vert_lightmap_paint = `
    attribute vec2 position;
    uniform vec4 quad;
    varying vec2 v_uv;
    void main()
    {
        v_uv = position;
        gl_Position = vec4(quad.x + position.x * quad.z,
                           quad.y + position.y * quad.w,
                           0.0, 1.0);
    }`;

    const frag_lightmap_paint = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 color;
    varying vec2 v_uv;
    void main()
    {
        float d = length(v_uv);
        if (d > 1.0) discard;
        float att = 1.0 - d;
        att *= att;
        gl_FragColor = vec4(color.rgb * color.a * att, 1.0);
    }`;
    const shader_lightmap_paint = new Shader(vert_lightmap_paint, frag_lightmap_paint, [
      'quad',
      'color',
    ]);

    // Шейдер «затухания» декалей: каждый кадр мультиплицирует FBO на коэффициент.
    const vert_decal_fade = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const frag_decal_fade = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 fade;
    void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, fade.a); }`;
    const shader_decal_fade = new Shader(vert_decal_fade, frag_decal_fade, ['fade']);

    const vert_decal_paint = `
    attribute vec2 position;
    attribute vec2 texuv;
    varying vec2 v_uv;
    void main()
    {
        v_uv = texuv;
        gl_Position = vec4(position, 0.0, 1.0);
    }`;
    const frag_decal_paint = `
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
    const frag_decal_paint_add = `
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
    const shader_decal_paint = new Shader(vert_decal_paint, frag_decal_paint, ['tex', 'color']);
    const shader_decal_paint_add = new Shader(vert_decal_paint, frag_decal_paint_add, [
      'tex',
      'color',
    ]);
    const decal_paint_uv_loc = shader_decal_paint.attrib('texuv');
    const floor_decal_vbo = gl.createBuffer();

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

    let lastFadeTime = Date.now();
    // Полупериод затухания декалей пола: 45 секунд (медленное «выцветание»).
    const DECAL_HALF_LIFE_MS = 45000;
    function fadeDecalsStep() {
      const now = Date.now();
      const dt = Math.min(100, now - lastFadeTime);
      lastFadeTime = now;
      if (dt <= 0) return;
      // factor = exp(-dt * ln2 / halflife) = 0.5 ^ (dt / halflife)
      const factor = Math.pow(0.5, dt / DECAL_HALF_LIFE_MS);

      fbo_decal_floor.bind();
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      // out = dst * src_alpha → весь FBO умножается на factor.
      gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);

      shader_decal_fade.use();
      shader_decal_fade.vector(shader_decal_fade.fade, [0, 0, 0, factor]);

      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      fbo_decal_floor.unbind();

      if (fbo_decal_wall) {
        const wallFactor = Math.pow(0.5, dt / WALL_DECAL_HALF_LIFE_MS);
        fbo_decal_wall.bind();
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        shader_decal_fade.use();
        shader_decal_fade.vector(shader_decal_fade.fade, [0, 0, 0, wallFactor]);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        fbo_decal_wall.unbind();
      }
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

    // Поле скоростей реки/лавы — задаёт направление течения по позиции (RG = vx, vy).
    // Используется в frag_lava_anim для физически согласованного «потока» как в 2D.
    const tex_velocity = Buffer.create_texture(
      level.getVelocityX(),
      level.getVelocityY(),
      level.getVelocityX(),
      level.getVelocityY(),
      { wrap: gl.CLAMP_TO_EDGE },
    );

    // Анимированная лава: финальный цвет считается прямо в frag_floor (per-pixel),
    // чтобы не падать на разрешение FBO при близкой камере. Сюда уходит только
    // медленный волновой шум (rg = смещение, b = доп.шум для маски).
    const fbo_wave = new Framebuffer(512, 512);

    const MAX_LIGHTS = 8;

    // Универсальный GLSL-фрагмент: набор точечных источников света и помощник освещения.
    // dyn_light_pos[i].xyz = мировая позиция (engine-coords: x, y, z),
    // dyn_light_pos[i].w   = радиус действия (за пределами вклад = 0),
    // dyn_light_col[i].rgb = цвет, dyn_light_col[i].a = яркость.
    const LIGHTS_GLSL = `
    uniform int  dyn_light_count;
    uniform vec4 dyn_light_pos[${MAX_LIGHTS}];
    uniform vec4 dyn_light_col[${MAX_LIGHTS}];

    vec3 accum_dyn_lights(vec3 wp, vec3 n)
    {
        vec3 sum = vec3(0.0);
        for (int i = 0; i < ${MAX_LIGHTS}; i++) {
            if (i >= dyn_light_count) break;
            vec3 lp = dyn_light_pos[i].xyz;
            float r = dyn_light_pos[i].w;
            if (r <= 0.0) continue;
            vec3 dv = wp - lp;
            float d = length(dv);
            float att = max(0.0, 1.0 - d / r);
            att *= att;
            // Лёгкая зависимость от нормали (вклад слегка усиливается при «лицевом» направлении).
            float face = 1.0;
            if (length(n) > 0.001) {
                vec3 to_light = -dv / max(d, 0.0001);
                face = clamp(0.5 + 0.5 * dot(normalize(n), to_light), 0.4, 1.2);
            }
            sum += dyn_light_col[i].rgb * dyn_light_col[i].a * att * face;
        }
        return sum;
    }`;

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
        v_normal = normal;
        v_height = position.y;
        v_atlas = atlasuv;
        gl_Position = view_proj * vec4(position, 1.0);
    }`;

    // Единый базовый уровень освещения и точечные лайты сверху.
    const AMBIENT_BASE = 0.45;

    // Универсальный фрагмент для сэмпла запечённой lightmap (все статические лайты).
    // sample_static_lightmap(uv_level, height_attn) возвращает RGB освещения.
    const STATIC_LIGHTMAP_GLSL = `
    uniform sampler2D tex_lightmap;
    vec3 sample_static_lightmap(vec2 uv_level)
    {
        return texture2D(tex_lightmap, uv_level).rgb;
    }`;

    const FOG_COLOR = 'vec3(0.022, 0.028, 0.045)';
    // Дистанционный экспоненциальный туман: вблизи прозрачно, вдали всё растворяется
    // в цвете тумана. Лёгкий шум по миру делает границу не идеально ровной.
    const FOG_DIST_GLSL = `
    float dist_fog_amount(vec3 wp, vec3 eye)
    {
        // Квадратичная плотность: вблизи прозрачно (линейный член мал), но вдали
        // нарастает резко (член d*d), чтобы дальние мобы растворялись в тумане
        // ДО того как их откроет угол/LOS — без «выскакивания из пустоты».
        float d = max(0.0, distance(wp, eye) - 4.0);
        float t = 0.02 * d + 0.0045 * d * d;
        return clamp(1.0 - exp(-t), 0.0, 1.0);
    }
    vec3 apply_dist_fog(vec3 col, vec3 wp, vec3 eye)
    {
        float f = dist_fog_amount(wp, eye);
        return mix(col, ${FOG_COLOR}, f * 0.96);
    }`;
    const FOG_MIX_GLSL = FOG_DIST_GLSL;

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
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}
    ${FOG_MIX_GLSL}

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
        // Тёмный обугленный берег вокруг лавы.
        float lava_edge = smoothstep(0.38, 0.55, level.r) * (1.0 - lava_mask);
        ground.rgb *= 1.0 - lava_edge * 0.78;
        ground.rgb = mix(ground.rgb, vec3(0.05, 0.03, 0.02), lava_edge * 0.55);

        vec3 albedo = mix(ground.rgb, lava.rgb, lava_mask);
        // Лава сама эмиссивна — не даём ей удваиваться от точечных лайтов и факелов.
        float receive = 1.0 - lava_mask * 0.85;
        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        lighting += sample_static_lightmap(uv_level) * receive;
        lighting += accum_dyn_lights(v_world_pos, vec3(0.0, 1.0, 0.0)) * receive;
        vec3 col = albedo * lighting;
        col += lava.rgb * lava_mask * 0.7;

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
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying float v_height;
    varying vec2 v_atlas;
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}
    ${FOG_MIX_GLSL}

    void main()
    {
        vec3 n = normalize(v_normal);
        vec4 wall = texture2D(tex_wall, v_uv);
        vec3 albedo = wall.rgb;
        vec2 uv_level = vec2(v_world.x * scale_world.x, 1.0 - v_world.y * scale_world.x);

        // Свет факела на стене распространяется почти равномерно по высоте,
        // только у самого потолка/пола немного приглушается.
        float h_attn = smoothstep(0.0, 0.7, v_height) - smoothstep(3.6, 4.0, v_height);
        h_attn = clamp(h_attn * 1.05, 0.45, 1.0);

        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        lighting += sample_static_lightmap(uv_level) * h_attn;
        lighting += accum_dyn_lights(v_world_pos, n);

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
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}
    ${FOG_MIX_GLSL}

    void main()
    {
        vec4 wall = texture2D(tex_wall, v_uv);
        vec3 albedo = wall.rgb * 0.45;
        vec2 uv_level = vec2(v_world_pos.x * scale_world.x, 1.0 - v_world_pos.z * scale_world.x);
        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        // Потолок далеко от факелов — даём приглушённый вклад.
        lighting += sample_static_lightmap(uv_level) * 0.45;
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
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}
    ${FOG_MIX_GLSL}

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
    ]);
    const shader_wall = new Shader(vert_wall, frag_wall, [
      'view_proj',
      'tex_wall',
      'tex_wall_decal',
      'tex_lightmap',
      'tex_visible',
      'scale_world',
      'cam_pos',
      'dyn_light_count',
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
    ]);
    const shader_minimap = new Shader(vert_minimap, frag_minimap, [
      'mat_pos',
      'levelmap',
      'pos',
      'player_angle',
      'time',
    ]);

    // ---- Объёмный туман: camera-facing слайсы с 3D fbm-шумом (как дым в играх) ------
    // Набор плоскостей, обращённых к камере и расставленных по глубине. Каждая
    // проходит сквозь сцену с depth-тестом, поэтому стены корректно перекрывают
    // слайсы за ними, а в открытом воздухе слои складываются в объёмный дым.
    const FOG_SLICES = 16;
    const FOG_NEAR = 1.5;
    const FOG_FAR = 28.0;
    const fogCam = {
      eye: [0, eye_height, 0],
      fwd: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
      tanY: Math.tan(Math.PI * 0.21),
      aspect: 1,
    };
    const vert_fog_vol = `
    attribute vec2 position; // unit quad -1..1
    uniform mat4 view_proj;
    uniform vec4 cam_eye;   // xyz = eye, w = dist
    uniform vec4 cam_fwd;   // xyz = forward, w = halfH
    uniform vec4 cam_right; // xyz = right, w = halfW
    uniform vec4 cam_up;    // xyz = up
    varying vec3 v_world_pos;
    void main()
    {
        vec3 center = cam_eye.xyz + cam_fwd.xyz * cam_eye.w;
        vec3 wp = center
                + cam_right.xyz * (position.x * cam_right.w)
                + cam_up.xyz    * (position.y * cam_fwd.w);
        v_world_pos = wp;
        gl_Position = view_proj * vec4(wp, 1.0);
    }`;
    const frag_fog_vol = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex_visible;
    uniform sampler2D tex_depth;
    uniform vec4 fog_p;    // x = 1/level_size, y = slice_alpha, z = time, w = slice_eye_dist
    uniform vec4 screen_p; // x = 1/w, y = 1/h, z = near, w = far (>0 => soft particles on)
    varying vec3 v_world_pos;
    ${FOG_MIX_GLSL}

    float hash13(vec3 p)
    {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
    }
    float vnoise(vec3 x)
    {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash13(i + vec3(0.0,0.0,0.0));
        float n100 = hash13(i + vec3(1.0,0.0,0.0));
        float n010 = hash13(i + vec3(0.0,1.0,0.0));
        float n110 = hash13(i + vec3(1.0,1.0,0.0));
        float n001 = hash13(i + vec3(0.0,0.0,1.0));
        float n101 = hash13(i + vec3(1.0,0.0,1.0));
        float n011 = hash13(i + vec3(0.0,1.0,1.0));
        float n111 = hash13(i + vec3(1.0,1.0,1.0));
        float x00 = mix(n000, n100, f.x);
        float x10 = mix(n010, n110, f.x);
        float x01 = mix(n001, n101, f.x);
        float x11 = mix(n011, n111, f.x);
        float y0 = mix(x00, x10, f.y);
        float y1 = mix(x01, x11, f.y);
        return mix(y0, y1, f.z);
    }
    float fbm(vec3 p)
    {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 3; i++) {
            s += a * vnoise(p);
            p *= 2.03;
            a *= 0.5;
        }
        return s;
    }

    void main()
    {
        vec3 p = v_world_pos;

        // Высотный профиль: дым стелется снизу и редеет кверху.
        float h = clamp(p.y, 0.0, 5.0);
        float height = exp(-h * 0.4);

        // Живой 3D-дым: один слой fbm, но крупные клочья + высокий контраст,
        // чтобы рисунок дыма был хорошо заметен и переживал апсемпл с 1/4 буфера.
        float t = fog_p.z;
        vec3 q = vec3(p.x, p.y * 0.7, p.z) * 0.32;
        q += vec3(t * 0.10, t * 0.045, -t * 0.08);
        float n = fbm(q);
        n = clamp(n * 2.2 - 0.55, 0.0, 1.0);

        // Чистая объёмная дымка: плотность одинакова по всей карте, а «туман»
        // на расстоянии набирается за счёт наслоения множества слайсов.
        float baseHaze = 0.22;
        float density = baseHaze * height * n;
        float alpha = clamp(density * fog_p.y, 0.0, 0.5);

        // Soft particles: гасим альфу там, где слайс почти упирается в геометрию
        // (мягкий стык с полом/стенами) и полностью — где он за геометрией. Это
        // убирает резкий шов на полу и мерцание от жёсткого depth-теста.
        if (screen_p.w > 0.0) {
            vec2 suv = gl_FragCoord.xy * screen_p.xy;
            float dz = texture2D(tex_depth, suv).r;
            float ndc = dz * 2.0 - 1.0;
            float nearZ = screen_p.z, farZ = screen_p.w;
            float sceneEye = (2.0 * nearZ * farZ) / (farZ + nearZ - ndc * (farZ - nearZ));
            float soft = clamp((sceneEye - fog_p.w) / 1.6, 0.0, 1.0);
            alpha *= soft;
        }
        if (alpha < 0.01) discard;

        vec3 col = mix(vec3(0.03, 0.038, 0.058), vec3(0.12, 0.14, 0.18), n);
        // Premultiplied alpha: накапливаем слайсы в буфере через blend ONE/1-SRC_ALPHA.
        gl_FragColor = vec4(col * alpha, alpha);
    }`;
    const shader_fog_vol = new Shader(vert_fog_vol, frag_fog_vol, [
      'view_proj',
      'tex_visible',
      'tex_depth',
      'fog_p',
      'screen_p',
      'cam_eye',
      'cam_fwd',
      'cam_right',
      'cam_up',
    ]);
    const fog_vol_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fog_vol_vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );

    // ---- Depth-prepass для soft-particles тумана ------------------------------------
    // Глубину сцены нельзя прочитать из default-фреймбуфера, поэтому в начале кадра
    // рисуем геометрию (только глубина) в отдельный FBO с depth-текстурой. Затем
    // шейдер тумана сэмплит её и мягко гасит слайсы у поверхностей.
    const depthExt =
      gl.getExtension('WEBGL_depth_texture') ||
      gl.getExtension('WEBKIT_WEBGL_depth_texture') ||
      gl.getExtension('MOZ_WEBGL_depth_texture');
    let depthFBO = null,
      depthColorTex = null,
      depthTex = null,
      depthW = 0,
      depthH = 0;
    // Туман рисуется в буфер половинного разрешения (в 4 раза меньше фрагментов),
    // а затем одним проходом накладывается на экран — иначе тяжёлый 3D-шум по
    // 18 полноэкранным слайсам убивает fps.
    let fogFBO = null,
      fogColorTex = null,
      fogW = 0,
      fogH = 0;
    function ensureDepthFBO() {
      if (!depthExt) return false;
      const w = state.canvas.width,
        h = state.canvas.height;
      if (depthFBO && w === depthW && h === depthH) return true;
      if (depthFBO) {
        gl.deleteFramebuffer(depthFBO);
        gl.deleteTexture(depthColorTex);
        gl.deleteTexture(depthTex);
        gl.deleteFramebuffer(fogFBO);
        gl.deleteTexture(fogColorTex);
      }
      depthW = w;
      depthH = h;
      fogW = Math.max(1, w >> 2);
      fogH = Math.max(1, h >> 2);

      depthColorTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depthColorTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      depthTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.DEPTH_COMPONENT,
        w,
        h,
        0,
        gl.DEPTH_COMPONENT,
        gl.UNSIGNED_SHORT,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      depthFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, depthFBO);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        depthColorTex,
        0,
      );
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
      let ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

      // Цветовой буфер тумана половинного разрешения (premultiplied alpha).
      fogColorTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, fogColorTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fogW, fogH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fogFBO = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fogFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fogColorTex, 0);
      ok = ok && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, state.canvas.width, state.canvas.height);
      return ok;
    }

    // Композит буфера тумана на экран (premultiplied: blend = ONE, 1-SRC_ALPHA).
    const vert_fog_blit = `
    attribute vec2 position;
    varying vec2 v_uv;
    void main() { v_uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;
    const frag_fog_blit = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex_fog;
    varying vec2 v_uv;
    void main() { gl_FragColor = texture2D(tex_fog, v_uv); }`;
    const shader_fog_blit = new Shader(vert_fog_blit, frag_fog_blit, ['tex_fog']);

    const vert_depth = `
    attribute vec4 position;
    uniform mat4 view_proj;
    void main() { gl_Position = view_proj * vec4(position.xyz, 1.0); }`;
    const frag_depth = `
    #ifdef GL_ES
    precision highp float;
    #endif
    void main() { gl_FragColor = vec4(1.0); }`;
    const shader_depth = new Shader(vert_depth, frag_depth, ['view_proj']);

    let fogSoftReady = false;
    function renderDepthPrepass(view_proj) {
      fogSoftReady = ensureDepthFBO();
      if (!fogSoftReady) return;

      gl.bindFramebuffer(gl.FRAMEBUFFER, depthFBO);
      gl.viewport(0, 0, depthW, depthH);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);

      shader_depth.use();
      shader_depth.matrix(shader_depth.view_proj, view_proj);

      const meshes = [floor_mesh, wall_mesh, ceiling_mesh, bridges_mesh];
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        if (!mesh || !mesh.count) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, (mesh.stride || 8) * 4, 0);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, state.canvas.width, state.canvas.height);
    }

    function drawFogSlices(inv, t) {
      gl.bindBuffer(gl.ARRAY_BUFFER, fog_vol_vbo);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      // Задние слайсы рисуем первыми (back-to-front) для корректного alpha.
      for (let i = FOG_SLICES - 1; i >= 0; i--) {
        const f = i / (FOG_SLICES - 1);
        const dist = FOG_NEAR + (FOG_FAR - FOG_NEAR) * f;
        const halfH = dist * fogCam.tanY;
        const halfW = halfH * fogCam.aspect;
        // Гасим слайсы у самого «носа» камеры, чтобы туман не лип на объектив.
        const nearFade = Math.min(1, Math.max(0, (dist - FOG_NEAR) / 3.0));
        shader_fog_vol.vector(shader_fog_vol.cam_eye, [
          fogCam.eye[0],
          fogCam.eye[1],
          fogCam.eye[2],
          dist,
        ]);
        shader_fog_vol.vector(shader_fog_vol.cam_fwd, [
          fogCam.fwd[0],
          fogCam.fwd[1],
          fogCam.fwd[2],
          halfH,
        ]);
        shader_fog_vol.vector(shader_fog_vol.cam_right, [
          fogCam.right[0],
          fogCam.right[1],
          fogCam.right[2],
          halfW,
        ]);
        // fog_p.w = глубина слайса по оси взгляда — нужна для soft-particles.
        shader_fog_vol.vector(shader_fog_vol.fog_p, [inv, nearFade, t, dist]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }

    function renderVolumetricFog(view_proj) {
      const cullWas = gl.isEnabled(gl.CULL_FACE);
      const blendWas = gl.isEnabled(gl.BLEND);
      const depthWas = gl.isEnabled(gl.DEPTH_TEST);
      const inv = 1 / size;
      const t = Date.now() * 0.001;

      gl.disable(gl.CULL_FACE);
      // Слайсы выводят premultiplied-цвет, поэтому везде blend = ONE / 1-SRC_ALPHA.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);

      shader_fog_vol.use();
      shader_fog_vol.matrix(shader_fog_vol.view_proj, view_proj);
      shader_fog_vol.vector(shader_fog_vol.cam_up, [fogCam.up[0], fogCam.up[1], fogCam.up[2], 0]);

      if (fogSoftReady) {
        // Туман в буфер половинного разрешения (в 4 раза дешевле по фрагментам),
        // soft-particles по depth-текстуре, затем композит на экран.
        shader_fog_vol.texture(shader_fog_vol.tex_depth, depthTex, 1);
        shader_fog_vol.vector(shader_fog_vol.screen_p, [1 / fogW, 1 / fogH, 0.05, size * 2]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fogFBO);
        gl.viewport(0, 0, fogW, fogH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        drawFogSlices(inv, t);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, state.canvas.width, state.canvas.height);
        shader_fog_blit.use();
        shader_fog_blit.texture(shader_fog_blit.tex_fog, fogColorTex, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.clearColor(0.08, 0.1, 0.13, 1);
      } else {
        // Фолбэк без depth-текстуры: прямо на экран, обычный depth-тест.
        shader_fog_vol.vector(shader_fog_vol.screen_p, [0, 0, 0, 0]);
        drawFogSlices(inv, t);
      }

      // ВАЖНО: не отключаем attrib 0 (position) — последующий рендер оружия/мобов
      // (MD2) полагается, что он включён, иначе геометрия вырождается и моргает.
      if (state.quadBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }
      gl.depthMask(true);
      if (depthWas) gl.enable(gl.DEPTH_TEST);
      else gl.disable(gl.DEPTH_TEST);
      if (!blendWas) gl.disable(gl.BLEND);
      if (cullWas) gl.enable(gl.CULL_FACE);
    }

    // ---- Анимированный волновой шум для лавы (тот же frag_wave, что в 2D) ----------
    // Только wave-FBO: финальный цвет лавы считается per-pixel в frag_floor,
    // чтобы не упираться в разрешение FBO при близкой камере.
    const vert_wave_fs = `
    attribute vec4 position;
    varying vec4 texcoord;
    void main()
    {
        gl_Position = vec4(position.xy, 0.0, 1.0);
        texcoord.xy = position.xy * 0.5 + 0.5;
        texcoord.zw = position.xy * 0.5 + 0.5;
    }`;

    const frag_wave_2d =
      '\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec4 texcoord;\n\
    uniform sampler2D noise;\n\
    uniform vec4 scale_time;\n\
    \n\
    void main(void) \n\
    {\n\
        vec2 scale = scale_time.xy;\n\
        vec2 time = scale_time.zw;\n\
        vec4 n = texture2D(noise, 1.5 * texcoord.xy * scale.xy);\n\
        vec4 d1 = texture2D(noise, (texcoord.xy * scale.xy + time.xy));\n\
        vec4 d2 = texture2D(noise, (texcoord.xy * scale.xy + time.yx) * 2.0);\n\
        vec4 d3 = texture2D(noise, (texcoord.xy * scale.xy + vec2(1.0 - time.x, 1.0)) * 4.0);\n\
        vec4 d4 = texture2D(noise, (texcoord.xy * scale.xy + vec2(1.0, 1.0 - time.x)) * 8.0);\n\
        vec2 d = (d1.rg + d2.gr + d3.rg + d4.gr) * 0.25;\n\
        gl_FragColor = vec4(d.rg, n.g, 0.0);\n\
    }\n';

    const shader_wave_3d = new Shader(vert_wave_fs, frag_wave_2d, ['noise', 'scale_time']);

    function renderLavaAnimation() {
      if (!tex_noise.ready()) return;

      const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
      const prevBlend = gl.isEnabled(gl.BLEND);
      const prevCull = gl.isEnabled(gl.CULL_FACE);
      const prevMask = gl.getParameter(gl.DEPTH_WRITEMASK);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);

      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const t_wave = ((Date.now() / 64) % 1000) / 1000;
      const sc_wave = (5 * size) / 64;

      fbo_wave.bind();
      shader_wave_3d.use();
      shader_wave_3d.texture(shader_wave_3d.noise, tex_noise.getId(), 0);
      shader_wave_3d.vector(shader_wave_3d.scale_time, [sc_wave, sc_wave, t_wave, 0]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      fbo_wave.unbind();

      if (prevDepth) gl.enable(gl.DEPTH_TEST);
      if (prevBlend) gl.enable(gl.BLEND);
      if (prevCull) gl.enable(gl.CULL_FACE);
      gl.depthMask(prevMask);
    }

    // --- Стенные декали: привязка к сегментам marching squares (как makeWallMesh) ---
    const wall_segments = [];

    // Проверка: под точкой есть реальный пол (не лава без моста, не внутренность стены,
    // не за границей карты). Без неё декали «зависают» там, где пол не отрисован.
    function hasFloorAt(pos) {
      if (pos.x < 0 || pos.y < 0 || pos.x >= size || pos.y >= size) return false;
      if (my_level.getCollide(pos, false) > 100) return false;
      if (my_level.collideLava(pos) && !my_level.getCollideBridges(pos)) return false;
      return true;
    }

    function dirFromDynent(dir) {
      if (!dir) return { x: 0, y: 0 };
      const x = typeof dir.x === 'number' ? dir.x : Array.isArray(dir) ? dir[0] : 0;
      const y = typeof dir.y === 'number' ? dir.y : Array.isArray(dir) ? dir[1] : 0;
      // Нормализуем — снарядные vel имеют крошечную длину (speed≈0.02),
      // и тогда align в resolveWallFace оказывается ≈0 и реджектит грань.
      const len = Math.sqrt(x * x + y * y);
      if (len < 1e-6) return { x: 0, y: 0 };
      return { x: x / len, y: y / len };
    }

    function findWallSegmentAt(posX, posY, dirX, dirY) {
      // Чуть больше старого 0.55 — визуальная стена (marching squares по
      // размытой groundMap) и коллизия (raw-тайлы) расходятся до ~полклетки,
      // иначе часть попаданий не находит сегмент и след не появляется.
      const MAX_DIST = 0.8;
      let best = null;
      let bestScore = -1e9;
      const hasDir = dirX * dirX + dirY * dirY > 1e-8;

      for (let i = 0; i < wall_segments.length; i++) {
        const seg = wall_segments[i];
        const ax = seg.p0[0],
          az = seg.p0[1];
        const bx = seg.p1[0],
          bz = seg.p1[1];
        const sx = bx - ax,
          sz = bz - az;
        const len2 = sx * sx + sz * sz;
        if (len2 < 1e-8) continue;

        const px = posX - ax,
          pz = posY - az;
        let t = (px * sx + pz * sz) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + sx * t;
        const cz = az + sz * t;
        const dist = Math.hypot(posX - cx, posY - cz);
        if (dist > MAX_DIST) continue;

        // align — мягкий приоритет «лицевой» грани, БЕЗ жёсткого реджекта.
        // dir у попаданий в стену приходит то как вектор полёта, то как
        // нормаль грани, поэтому берём |align| и не отсекаем по нему:
        // решает близость, ориентация лишь разрешает спорные случаи.
        const align = hasDir ? Math.abs(dirX * seg.nx + dirY * seg.nz) : 0;
        const score = (MAX_DIST - dist) * 6 + align * 2;
        if (score > bestScore) {
          bestScore = score;
          best = { seg, t, cx, cz };
        }
      }
      return best;
    }

    function spawnWallDecalOnSegment(pos, posZ, hit, sz, color, texId, angle, sh_add) {
      if (!texId || !hit) return;
      let py =
        posZ !== undefined && posZ !== null
          ? posZ
          : (state.LevelRender && state.LevelRender.eye_height) || 1.6;
      py = Math.max(0.04, Math.min(wall_height - 0.04, py));

      // Все повреждения стены — одного цвета (чёрный), alpha сохраняем.
      const blackColor = [0, 0, 0, color && color[3] !== undefined ? color[3] : 1];
      color = blackColor;

      // «Splat»: красим декаль во ВСЕ сегменты, чьи грани попадают в радиус
      // отпечатка (а не только в задетый сегмент). Так след переходит на
      // соседнюю грань и заворачивается за угол — каждый сегмент рисуется в
      // своём тайле атласа (scissor), но вместе они дают непрерывное пятно.
      const reach = sz + 0.5;
      const reach2 = reach * reach;
      for (let i = 0; i < wall_segments.length; i++) {
        const seg = wall_segments[i];
        if (!seg.atlasRect) continue;
        const ax = seg.p0[0],
          az = seg.p0[1];
        const bx = seg.p1[0],
          bz = seg.p1[1];
        const sx = bx - ax,
          sgz = bz - az;
        const len2 = sx * sx + sgz * sgz;
        if (len2 < 1e-8) continue;

        // Непрерывная (нефиксированная) проекция точки на линию сегмента:
        // along может выходить за [0,len] — лишнее обрежет scissor тайла.
        const tRaw = ((pos.x - ax) * sx + (pos.y - az) * sgz) / len2;
        const tC = Math.max(0, Math.min(1, tRaw));
        const cx = ax + sx * tC,
          cz = az + sgz * tC;
        const dx = pos.x - cx,
          dz = pos.y - cz;
        if (dx * dx + dz * dz > reach2) continue;

        const along = tRaw * seg.len;
        paintWallDecal(seg, along, py, sz, angle || 0, color, texId, sh_add);
      }
    }

    function paintWallDecal(seg, along, py, sz, angle, color, texId, sh_add) {
      if (!texId || !seg || !seg.atlasRect || !fbo_decal_wall) return;

      const r = seg.atlasRect;
      const ppu = seg.ppu || wallAtlasPpu;
      const tu = r.u0 + (along / seg.len) * (r.u1 - r.u0);
      const tv = r.v0 + (py / wall_height) * (r.v1 - r.v0);
      // Чуть больше отпечаток — перекрывает стыки тайлов и scissor-границы.
      const halfU = (sz * 1.06 * ppu) / wallAtlasRes;
      const halfV = (sz * 1.06 * ppu) / wallAtlasRes;

      const ca = Math.cos(angle),
        sa = Math.sin(angle);
      function atlasCorner(lx, ly) {
        const rx = lx * ca - ly * sa;
        const ry = lx * sa + ly * ca;
        return [tu + rx, tv + ry];
      }

      const corners = [
        atlasCorner(-halfU, -halfV),
        atlasCorner(halfU, -halfV),
        atlasCorner(-halfU, halfV),
        atlasCorner(halfU, -halfV),
        atlasCorner(halfU, halfV),
        atlasCorner(-halfU, halfV),
      ];
      const uvs = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
      const verts = new Float32Array(6 * 4);
      for (let i = 0; i < 6; i++) {
        verts[i * 4 + 0] = corners[i][0] * 2 - 1;
        verts[i * 4 + 1] = corners[i][1] * 2 - 1;
        verts[i * 4 + 2] = uvs[i * 2 + 0];
        verts[i * 4 + 3] = uvs[i * 2 + 1];
      }

      const px = seg.atlasPx;
      fbo_decal_wall.bind();
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.SCISSOR_TEST);
      // Scissor на 1px шире тайла — рисуем в зону паддинга между тайлами,
      // чтобы на стыках сегментов не оставались прозрачные полоски.
      const scPad = 1;
      const scX = Math.max(0, px.x - scPad);
      const scY = Math.max(0, wallAtlasRes - px.y - px.h - scPad);
      const scW = Math.min(wallAtlasRes - scX, px.w + scPad * 2);
      const scH = Math.min(wallAtlasRes - scY, px.h + scPad * 2);
      gl.scissor(scX, scY, scW, scH);
      gl.enable(gl.BLEND);
      if (sh_add) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const sh = sh_add ? shader_decal_paint_add : shader_decal_paint;
      sh.use();
      sh.texture(sh.tex, texId, 0);
      sh.vector(sh.color, color);

      gl.bindBuffer(gl.ARRAY_BUFFER, floor_decal_vbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      const stride = 4 * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(decal_paint_uv_loc);
      gl.vertexAttribPointer(decal_paint_uv_loc, 2, gl.FLOAT, false, stride, 2 * 4);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(decal_paint_uv_loc);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.disable(gl.SCISSOR_TEST);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      fbo_decal_wall.unbind();
    }

    function paintFloorDecal(dynent, texId, color, sh_add) {
      if (!texId) return;
      const ang = dynent.angle || 0;
      const ca = Math.cos(ang),
        sa = Math.sin(ang);
      const hw = (dynent.size.x * 0.5) / size;
      const hh = (dynent.size.y * 0.5) / size;
      const cx = dynent.pos.x / size;
      const cy = 1 - dynent.pos.y / size;

      function toNdc(lx, ly) {
        const rx = lx * ca - ly * sa;
        const ry = lx * sa + ly * ca;
        return [(cx + rx) * 2 - 1, (cy + ry) * 2 - 1];
      }

      const ndc = [
        toNdc(-hw, -hh),
        toNdc(hw, -hh),
        toNdc(-hw, hh),
        toNdc(hw, -hh),
        toNdc(hw, hh),
        toNdc(-hw, hh),
      ];
      const uvs = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
      const verts = new Float32Array(6 * 4);
      for (let i = 0; i < 6; i++) {
        verts[i * 4 + 0] = ndc[i][0];
        verts[i * 4 + 1] = ndc[i][1];
        verts[i * 4 + 2] = uvs[i * 2 + 0];
        verts[i * 4 + 3] = uvs[i * 2 + 1];
      }

      fbo_decal_floor.bind();
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      if (sh_add) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const sh = sh_add ? shader_decal_paint_add : shader_decal_paint;
      sh.use();
      sh.texture(sh.tex, texId, 0);
      sh.vector(sh.color, color);

      gl.bindBuffer(gl.ARRAY_BUFFER, floor_decal_vbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      const stride = 4 * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(decal_paint_uv_loc);
      gl.vertexAttribPointer(decal_paint_uv_loc, 2, gl.FLOAT, false, stride, 2 * 4);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disableVertexAttribArray(decal_paint_uv_loc);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      fbo_decal_floor.unbind();
    }

    const uv_loc = shader_floor.attrib('texuv');
    const normal_loc = shader_floor.attrib('normal');
    const wall_atlas_loc = shader_wall.attrib('atlasuv');

    // Получаем uniform-локации массивов лайтов для каждого шейдера.
    function lightLocs(shader) {
      return {
        pos: shader.getLocation('dyn_light_pos[0]'),
        col: shader.getLocation('dyn_light_col[0]'),
        count: shader.dyn_light_count,
      };
    }
    const lights_loc_floor = lightLocs(shader_floor);
    const lights_loc_wall = lightLocs(shader_wall);
    const lights_loc_ceiling = lightLocs(shader_ceiling);
    const lights_loc_bridge = lightLocs(shader_bridge);

    // Преаллокированные буферы под uniform4fv (8 vec4 = 32 числа).
    const light_pos_buf = new Float32Array(MAX_LIGHTS * 4);
    const light_col_buf = new Float32Array(MAX_LIGHTS * 4);
    let active_light_count = 0;

    function applyLights(locs) {
      gl.uniform1i(locs.count, active_light_count);
      gl.uniform4fv(locs.pos, light_pos_buf);
      gl.uniform4fv(locs.col, light_col_buf);
    }

    function isWall(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return true;
      return raw.getData(x, y) > 0.5;
    }

    function pushVertex(out, x, y, z, u, v, nx, ny, nz) {
      out.push(x, y, z, u, v, nx, ny, nz);
    }

    function pushWallVertex(out, x, y, z, u, v, nx, ny, nz, au, av) {
      out.push(x, y, z, u, v, nx, ny, nz, au, av);
    }

    function pushQuad(out, a, b, c, d, n, uv) {
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
        pushVertex(out, tri[i][0], tri[i][1], tri[i][2], uvs[i][0], uvs[i][1], n[0], n[1], n[2]);
      }
    }

    function pushBox(out, center, halfSize, angle, uvScale) {
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const hx = halfSize[0];
      const hy = halfSize[1];
      const hz = halfSize[2];

      function rot(x, y, z) {
        return [center[0] + x * cosA - z * sinA, center[1] + y, center[2] + x * sinA + z * cosA];
      }

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

      pushQuad(out, p011, p111, p110, p010, [0, 1, 0], uvScale);
      pushQuad(out, p000, p100, p101, p001, [0, -1, 0], uvScale);
      pushQuad(out, p001, p011, p010, p000, [-nx[0], 0, -nx[2]], [uvScale[0], hy * 2]);
      pushQuad(out, p100, p110, p111, p101, [nx[0], 0, nx[2]], [uvScale[0], hy * 2]);
      pushQuad(out, p000, p010, p110, p100, [-nz[0], 0, -nz[2]], [uvScale[0], hy * 2]);
      pushQuad(out, p101, p111, p011, p001, [nz[0], 0, nz[2]], [uvScale[0], hy * 2]);
    }

    function makeMesh(vertices, stride) {
      stride = stride || 8;
      if (vertices.length === 0) return { buffer: null, count: 0, stride: stride };
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      return { buffer: buffer, count: vertices.length / stride, stride: stride };
    }

    function collectWallSegments() {
      wall_segments.length = 0;
      const seen = new Set();
      const MS_SEGMENTS = [
        [],
        [[0, 3]],
        [[0, 1]],
        [[1, 3]],
        [[1, 2]],
        [
          [0, 1],
          [2, 3],
        ],
        [[0, 2]],
        [[2, 3]],
        [[2, 3]],
        [[0, 2]],
        [
          [0, 3],
          [1, 2],
        ],
        [[1, 2]],
        [[1, 3]],
        [[0, 1]],
        [[0, 3]],
        [],
      ];

      function addWallSegment(p0, p1) {
        const key = [p0[0].toFixed(4), p0[1].toFixed(4), p1[0].toFixed(4), p1[1].toFixed(4)]
          .sort()
          .join('|');
        if (seen.has(key)) return;
        seen.add(key);

        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];
        const segLen = Math.hypot(dx, dz);
        if (segLen < 1e-5) return;

        let nx = -dz / segLen;
        let nz = dx / segLen;
        const midx = (p0[0] + p1[0]) * 0.5;
        const midz = (p0[1] + p1[1]) * 0.5;
        const probe = sampleWallField((midx + nx * 0.05) * mapScale, (midz + nz * 0.05) * mapScale);
        if (probe > 0.5) {
          nx = -nx;
          nz = -nz;
        }

        wall_segments.push({
          p0: [p0[0], p0[1]],
          p1: [p1[0], p1[1]],
          nx: nx,
          nz: nz,
          len: segLen,
        });
      }

      for (let gy = 0; gy < mapCells - 1; gy++) {
        for (let gx = 0; gx < mapCells - 1; gx++) {
          const v00 = sampleWallField(gx, gy);
          const v10 = sampleWallField(gx + 1, gy);
          const v01 = sampleWallField(gx, gy + 1);
          const v11 = sampleWallField(gx + 1, gy + 1);
          const caseIndex =
            (v00 > 0.5 ? 1 : 0) | (v10 > 0.5 ? 2 : 0) | (v11 > 0.5 ? 4 : 0) | (v01 > 0.5 ? 8 : 0);
          let edges = MS_SEGMENTS[caseIndex];
          // Седловые случаи MS (5 и 10): без disambiguation остаются дыры
          // в диагональных/тонких стенах.
          if (caseIndex === 5)
            edges =
              v00 + v11 > v10 + v01
                ? [
                    [0, 1],
                    [2, 3],
                  ]
                : [
                    [0, 3],
                    [1, 2],
                  ];
          else if (caseIndex === 10)
            edges =
              v00 + v11 > v10 + v01
                ? [
                    [0, 3],
                    [1, 2],
                  ]
                : [
                    [0, 1],
                    [2, 3],
                  ];
          if (!edges.length) continue;

          const pts = [
            wallEdgePoint(0, gx, gy, v00, v10, v01, v11),
            wallEdgePoint(1, gx, gy, v00, v10, v01, v11),
            wallEdgePoint(2, gx, gy, v00, v10, v01, v11),
            wallEdgePoint(3, gx, gy, v00, v10, v01, v11),
          ];
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i];
            addWallSegment(pts[e[0]], pts[e[1]]);
          }
        }
      }
    }

    function packWallAtlas() {
      const atlasSizes = [2048, 4096];
      let packed = false;

      function tryPack(res, ppu) {
        const placements = [];
        let x = WALL_ATLAS_PAD;
        let y = WALL_ATLAS_PAD;
        let rowH = 0;

        for (let i = 0; i < wall_segments.length; i++) {
          const seg = wall_segments[i];
          const wPx = Math.max(1, Math.ceil(seg.len * ppu));
          const hPx = Math.max(1, Math.ceil(wall_height * ppu));

          // Один тайл крупнее атласа при этом PPU — пробуем меньший PPU.
          if (wPx + 2 * WALL_ATLAS_PAD > res || hPx + 2 * WALL_ATLAS_PAD > res) return null;

          if (x + wPx + WALL_ATLAS_PAD > res) {
            x = WALL_ATLAS_PAD;
            y += rowH + WALL_ATLAS_PAD;
            rowH = 0;
          }
          if (y + hPx + WALL_ATLAS_PAD > res) return null;

          placements.push({ seg: seg, x: x, y: y, w: wPx, h: hPx, ppu: ppu });
          x += wPx + WALL_ATLAS_PAD;
          rowH = Math.max(rowH, hPx);
        }
        return placements;
      }

      for (let ai = 0; ai < atlasSizes.length && !packed; ai++) {
        const res = atlasSizes[ai];
        for (let ppu = WALL_PPU_MAX; ppu >= WALL_PPU_MIN && !packed; ppu--) {
          const placements = tryPack(res, ppu);
          if (!placements) continue;

          wallAtlasRes = res;
          wallAtlasPpu = ppu;
          for (let i = 0; i < placements.length; i++) {
            const p = placements[i];
            p.seg.atlasPx = { x: p.x, y: p.y, w: p.w, h: p.h };
            p.seg.atlasRect = {
              u0: p.x / res,
              u1: (p.x + p.w) / res,
              v0: 1.0 - (p.y + p.h) / res,
              v1: 1.0 - p.y / res,
            };
            p.seg.ppu = ppu;
          }
          packed = true;
        }
      }

      if (!packed) {
        wallAtlasRes = 4096;
        wallAtlasPpu = WALL_PPU_MIN;
        console.warn('wall decal atlas: fallback pack at minimum PPU');
        const placements = tryPack(wallAtlasRes, WALL_PPU_MIN) || [];
        for (let i = 0; i < placements.length; i++) {
          const p = placements[i];
          p.seg.atlasPx = { x: p.x, y: p.y, w: p.w, h: p.h };
          p.seg.atlasRect = {
            u0: p.x / wallAtlasRes,
            u1: (p.x + p.w) / wallAtlasRes,
            v0: 1.0 - (p.y + p.h) / wallAtlasRes,
            v1: 1.0 - p.y / wallAtlasRes,
          };
          p.seg.ppu = WALL_PPU_MIN;
        }
      }

      fbo_decal_wall = new Framebuffer(wallAtlasRes, wallAtlasRes);
      fbo_decal_wall.bind();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      fbo_decal_wall.unbind();
      setDecalTexSharp(fbo_decal_wall.getTexture());
    }

    // Декаль на стене у основания должна продолжаться на пол. Дублируем на пол,
    // если нижний край отпечатка (py - sz) опускается ниже линии пола: тогда
    // обрезанная низом стены часть продолжается на полу — угол выглядит цельным.
    function decalReachesFloor(dynent, wallHit, sz) {
      const pz = dynent.pos_z;
      if (pz !== undefined && pz !== null) return pz - sz < 0.12;
      if (wallHit) {
        const dist = Math.hypot(dynent.pos.x - wallHit.cx, dynent.pos.y - wallHit.cz);
        return dist < 0.2;
      }
      return false;
    }

    function tessellateWallMesh() {
      const out = [];
      for (let si = 0; si < wall_segments.length; si++) {
        const seg = wall_segments[si];
        const p0 = seg.p0;
        const p1 = seg.p1;
        const nx = seg.nx;
        const nz = seg.nz;
        const segLen = seg.len;
        const r = seg.atlasRect;
        // Геометрия стены не зависит от атласа декалей — без atlasRect
        // рисуем с нулевым UV (декали не видны, но полигоны есть).
        const iu0 = r ? r.u0 : 0;
        const iu1 = r ? r.u1 : 0;
        const iv0 = r ? r.v0 : 0;
        const iv1 = r ? r.v1 : 0;

        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];
        const nu = Math.max(1, Math.round(segLen / 0.5));
        const nv = Math.max(1, Math.round(wall_height / 0.5));
        const ux = dx / nu,
          uz = dz / nu;
        const vy = wall_height / nv;

        for (let j = 0; j < nv; j++) {
          const y0 = j * vy,
            y1 = y0 + vy;
          for (let i = 0; i < nu; i++) {
            const ax = p0[0] + ux * i,
              az = p0[1] + uz * i;
            const bx = p0[0] + ux * (i + 1),
              bz = p0[1] + uz * (i + 1);
            const su0 = (segLen * i) / nu,
              su1 = (segLen * (i + 1)) / nu;
            const au0 = r ? iu0 + (su0 / segLen) * (iu1 - iu0) : 0;
            const au1 = r ? iu0 + (su1 / segLen) * (iu1 - iu0) : 0;
            const av0 = r ? iv0 + (y0 / wall_height) * (iv1 - iv0) : 0;
            const av1 = r ? iv0 + (y1 / wall_height) * (iv1 - iv0) : 0;

            pushWallVertex(out, ax, y0, az, su0, y0, nx, 0, nz, au0, av0);
            pushWallVertex(out, bx, y0, bz, su1, y0, nx, 0, nz, au1, av0);
            pushWallVertex(out, bx, y1, bz, su1, y1, nx, 0, nz, au1, av1);
            pushWallVertex(out, ax, y0, az, su0, y0, nx, 0, nz, au0, av0);
            pushWallVertex(out, bx, y1, bz, su1, y1, nx, 0, nz, au1, av1);
            pushWallVertex(out, ax, y1, az, su0, y1, nx, 0, nz, au0, av1);
          }
        }
      }
      return makeMesh(out, 10);
    }

    function makeFloorMesh() {
      const out = [];
      const tex_repeat = size / 4;
      pushQuad(
        out,
        [0, 0, 0],
        [size, 0, 0],
        [size, 0, size],
        [0, 0, size],
        [0, 1, 0],
        [tex_repeat, tex_repeat],
      );
      return makeMesh(out);
    }

    function makeCeilingMesh() {
      const out = [];
      const tex_repeat = size / 8;
      pushQuad(
        out,
        [0, wall_height, size],
        [size, wall_height, size],
        [size, wall_height, 0],
        [0, wall_height, 0],
        [0, -1, 0],
        [tex_repeat, tex_repeat],
      );
      return makeMesh(out);
    }

    function sampleWallField(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= mapCells || gy >= mapCells) return 0;
      return groundMap.getData(gx, gy);
    }

    function wallEdgePoint(edge, gx, gy, v00, v10, v01, v11) {
      const wx = (coord) => coord / mapScale;
      const wz = (coord) => coord / mapScale;
      function lerpIso(va, vb, x0, z0, x1, z1) {
        const denom = vb - va;
        const t = Math.abs(denom) < 1e-6 ? 0.5 : (0.5 - va) / denom;
        return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
      }
      switch (edge) {
        case 0:
          return lerpIso(v00, v10, wx(gx), wz(gy), wx(gx + 1), wz(gy));
        case 1:
          return lerpIso(v10, v11, wx(gx + 1), wz(gy), wx(gx + 1), wz(gy + 1));
        case 2:
          return lerpIso(v01, v11, wx(gx), wz(gy + 1), wx(gx + 1), wz(gy + 1));
        case 3:
          return lerpIso(v00, v01, wx(gx), wz(gy), wx(gx), wz(gy + 1));
        default:
          return [wx(gx), wz(gy)];
      }
    }

    // Сшиваем коллинеарные соединённые сегменты marching-squares в длинные
    // «прогоны». Тогда прямая стена — один полигон с непрерывной текстурой и
    // одним атлас-тайлом, а декали переходят по всему прогону (обрезаются лишь
    // на реальных углах, где направление меняется), а не на каждом кусочке.
    function mergeWallSegments() {
      const EPS_DIR = 0.9995; // cos порога коллинеарности (~1.8°)
      const keyOf = (p) => p[0].toFixed(4) + ',' + p[1].toFixed(4);

      // endpoint-ключ -> список { idx, end } (end: 0 = p0, 1 = p1)
      const endpoints = new Map();
      for (let i = 0; i < wall_segments.length; i++) {
        const s = wall_segments[i];
        const k0 = keyOf(s.p0),
          k1 = keyOf(s.p1);
        if (!endpoints.has(k0)) endpoints.set(k0, []);
        if (!endpoints.has(k1)) endpoints.set(k1, []);
        endpoints.get(k0).push({ idx: i, end: 0 });
        endpoints.get(k1).push({ idx: i, end: 1 });
      }

      const used = new Array(wall_segments.length).fill(false);
      const merged = [];

      for (let i = 0; i < wall_segments.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const s = wall_segments[i];
        const dir = [(s.p1[0] - s.p0[0]) / s.len, (s.p1[1] - s.p0[1]) / s.len];
        const nx = s.nx,
          nz = s.nz;
        let start = [s.p0[0], s.p0[1]];
        let end = [s.p1[0], s.p1[1]];

        // Расширяем вперёд от end вдоль dir.
        let grow = true;
        while (grow) {
          grow = false;
          const cands = endpoints.get(keyOf(end));
          if (!cands) break;
          for (let c = 0; c < cands.length; c++) {
            const cand = cands[c];
            if (used[cand.idx]) continue;
            const cs = wall_segments[cand.idx];
            const far = cand.end === 0 ? cs.p1 : cs.p0;
            const cdir = [(far[0] - end[0]) / cs.len, (far[1] - end[1]) / cs.len];
            if (cdir[0] * dir[0] + cdir[1] * dir[1] < EPS_DIR) continue;
            if (cs.nx * nx + cs.nz * nz < EPS_DIR) continue;
            used[cand.idx] = true;
            end = [far[0], far[1]];
            grow = true;
            break;
          }
        }

        // Расширяем назад от start против dir.
        grow = true;
        while (grow) {
          grow = false;
          const cands = endpoints.get(keyOf(start));
          if (!cands) break;
          for (let c = 0; c < cands.length; c++) {
            const cand = cands[c];
            if (used[cand.idx]) continue;
            const cs = wall_segments[cand.idx];
            const far = cand.end === 0 ? cs.p1 : cs.p0;
            const cdir = [(start[0] - far[0]) / cs.len, (start[1] - far[1]) / cs.len];
            if (cdir[0] * dir[0] + cdir[1] * dir[1] < EPS_DIR) continue;
            if (cs.nx * nx + cs.nz * nz < EPS_DIR) continue;
            used[cand.idx] = true;
            start = [far[0], far[1]];
            grow = true;
            break;
          }
        }

        const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (len < 1e-5) {
          merged.push({ p0: s.p0, p1: s.p1, nx: nx, nz: nz, len: s.len });
          continue;
        }
        merged.push({ p0: start, p1: end, nx: nx, nz: nz, len: len });
      }

      wall_segments.length = 0;
      for (let i = 0; i < merged.length; i++) wall_segments.push(merged[i]);
    }

    // Длинные прогоны после merge могут не влезть в один тайл атласа — режем
    // на куски до упаковки. Геометрия остаётся непрерывной, декали — по тайлам.
    function splitLongWallSegments(maxWorldLen) {
      const out = [];
      for (let i = 0; i < wall_segments.length; i++) {
        const seg = wall_segments[i];
        if (seg.len <= maxWorldLen) {
          out.push(seg);
          continue;
        }
        const dx = (seg.p1[0] - seg.p0[0]) / seg.len;
        const dz = (seg.p1[1] - seg.p0[1]) / seg.len;
        let along = 0;
        while (along < seg.len - 1e-5) {
          const chunk = Math.min(maxWorldLen, seg.len - along);
          const ax = seg.p0[0] + dx * along;
          const az = seg.p0[1] + dz * along;
          const bx = seg.p0[0] + dx * (along + chunk);
          const bz = seg.p0[1] + dz * (along + chunk);
          out.push({ p0: [ax, az], p1: [bx, bz], nx: seg.nx, nz: seg.nz, len: chunk });
          along += chunk;
        }
      }
      wall_segments.length = 0;
      for (let i = 0; i < out.length; i++) wall_segments.push(out[i]);
    }

    function makeWallMesh() {
      collectWallSegments();
      mergeWallSegments();
      // Макс. длина тайла в мир-юнитах при минимальном PPU и 4096² атласе.
      const maxTileLen = (4096 - 2 * WALL_ATLAS_PAD - 1) / WALL_PPU_MIN;
      splitLongWallSegments(maxTileLen);
      packWallAtlas();
      return tessellateWallMesh();
    }

    function makeBridgesMesh() {
      const out = [];
      const bridges = level.getBridges().getBridges();
      const plank_thick = 0.22;
      for (let i = 0; i < bridges.length; i++) {
        const br = bridges[i];
        const halfLen = br.size.x * 0.5 + 1.0;
        const halfWid = br.size.y * 0.5;
        const a = -br.angle;
        pushBox(
          out,
          [br.pos.x, plank_thick * 0.5, br.pos.y],
          [halfLen, plank_thick * 0.5, halfWid],
          a,
          [halfLen * 0.6, halfWid * 0.6],
        );
      }
      return makeMesh(out);
    }

    const floor_mesh = makeFloorMesh();
    const ceiling_mesh = makeCeilingMesh();
    const wall_mesh = makeWallMesh();
    const bridges_mesh = makeBridgesMesh();

    // --- Статические факелы Quake 2 на стенах ---------------------------------
    // Раз в N тайлов вдоль каждой открытой стенки добавляем тёплый источник.
    // Сама геометрия факела (маленький светящийся «шар») вписана в общий wall_mesh.
    const TORCH_STEP = 11;
    const TORCH_RADIUS = 13.0;
    const TORCH_Y = wall_height * 0.55;

    // Детерминированный «шум» от позиции — даёт стабильную вариацию факелов.
    function torchHash(ix, iy) {
      let h = ((ix | 0) * 73856093) ^ ((iy | 0) * 19349663);
      h = (h ^ (h >>> 13)) * 2654435761;
      return (h >>> 0) / 4294967295;
    }

    // Каждый факел получает свой цвет/яркость/радиус, но в общем тёплом «жёлтом» спектре.
    // hue от тёплого оранжевого (~hot) до бледно-жёлтого/неонового (~cool).
    function buildTorch(x, z) {
      const r1 = torchHash(x * 31, z * 17);
      const r2 = torchHash(x * 53 + 7, z * 41 + 3);
      const r3 = torchHash(x * 11 + 5, z * 23 + 9);
      // Палитра — от насыщенно-оранжевого до неоново-жёлтого.
      const palette = [
        [1.0, 0.55, 0.2], // огненный
        [1.0, 0.72, 0.28], // тёплый янтарный
        [1.0, 0.92, 0.35], // жёлтый
        [1.0, 0.98, 0.55], // лимонный неон
        [1.0, 0.62, 0.18], // углей
      ];
      const idx = Math.min(palette.length - 1, Math.floor(r1 * palette.length));
      const color = palette[idx];
      // С большим радиусом интенсивность нужно мягче, иначе пересвет.
      const intensity = 0.55 + r2 * 0.65; // 0.55..1.20
      const radius = TORCH_RADIUS * (0.75 + r3 * 0.5); // ~9.75..16.25
      return { color, intensity, radius };
    }

    function makeStaticLights() {
      const list = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!isWall(x, y)) continue;
          // Северная грань тайла (face -Z), идём шагом по X.
          if (!isWall(x, y - 1) && (x + y * 7) % TORCH_STEP === 0)
            list.push([x + 0.5, TORCH_Y, y - 0.05]);
          if (!isWall(x, y + 1) && (x + y * 7) % TORCH_STEP === 5)
            list.push([x + 0.5, TORCH_Y, y + 1.05]);
          if (!isWall(x - 1, y) && (y + x * 7) % TORCH_STEP === 0)
            list.push([x - 0.05, TORCH_Y, y + 0.5]);
          if (!isWall(x + 1, y) && (y + x * 7) % TORCH_STEP === 5)
            list.push([x + 1.05, TORCH_Y, y + 0.5]);
        }
      }
      // Прикрепим вариативные параметры (цвет/яркость/радиус) детерминированно по координате.
      return list.map(function (p) {
        const t = buildTorch((p[0] * 16) | 0, (p[2] * 16) | 0);
        return { pos: p, color: t.color, intensity: t.intensity, radius: t.radius };
      });
    }
    const static_lights = makeStaticLights();

    // --- Запекаем статические факелы в lightmap (один раз при инициализации) ---
    function bakeStaticLightmap() {
      fbo_lightmap.bind();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      shader_lightmap_paint.use();
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      for (let i = 0; i < static_lights.length; i++) {
        const item = static_lights[i];
        const p = item.pos;
        const ndc_x = (p[0] / size) * 2 - 1;
        const ndc_y = 1 - (p[2] / size) * 2;
        const halfNdc = item.radius / size;
        shader_lightmap_paint.vector(shader_lightmap_paint.quad, [ndc_x, ndc_y, halfNdc, halfNdc]);
        shader_lightmap_paint.vector(shader_lightmap_paint.color, [
          item.color[0],
          item.color[1],
          item.color[2],
          item.intensity,
        ]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      fbo_lightmap.unbind();
    }
    bakeStaticLightmap();

    // --- Динамические лайты (снаряды и пр.) -----------------------------------
    const dyn_lights = [];
    function clearDynamicLights() {
      dyn_lights.length = 0;
    }
    // priority=2 — живой снаряд; priority=1 — короткая вспышка (muzzle/impact);
    // priority=0 — всё остальное. Чем выше — тем раньше попадает в активный список.
    function addDynamicLight(x, y, z, color, intensity, radius, priority) {
      dyn_lights.push([
        x,
        y,
        z,
        radius,
        color[0],
        color[1],
        color[2],
        intensity,
        priority !== undefined ? priority : 2,
      ]);
    }
    // Заполняет light_pos_buf/light_col_buf активными лайтами.
    // Динамические (снаряды, вспышки) ВСЕГДА имеют приоритет — иначе летящая ракета
    // в коридоре с факелами вытесняется из top-8 и перестаёт освещать сцену.
    // Оставшиеся слоты дозабиваем ближайшими к камере факелами.
    function writeLight(slot, px, py, pz, r, cr, cg, cb, inten) {
      const k = slot * 4;
      light_pos_buf[k + 0] = px;
      light_pos_buf[k + 1] = py;
      light_pos_buf[k + 2] = pz;
      light_pos_buf[k + 3] = r;
      light_col_buf[k + 0] = cr;
      light_col_buf[k + 1] = cg;
      light_col_buf[k + 2] = cb;
      light_col_buf[k + 3] = inten;
    }
    function selectActiveLights(camera) {
      const cx = camera.pos.x;
      const cz = camera.pos.y;
      // Все статические факелы уже в lightmap — здесь только динамические лайты.
      // Сортируем по приоритету (priority) и по близости к камере.
      const sortedDyn = dyn_lights.slice();
      sortedDyn.sort(function (a, b) {
        if (a[8] !== b[8]) return b[8] - a[8];
        const ad = (a[0] - cx) * (a[0] - cx) + (a[2] - cz) * (a[2] - cz);
        const bd = (b[0] - cx) * (b[0] - cx) + (b[2] - cz) * (b[2] - cz);
        return ad - bd;
      });
      const n = Math.min(sortedDyn.length, MAX_LIGHTS);
      for (let i = 0; i < n; i++) {
        const d = sortedDyn[i];
        writeLight(i, d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
      }
      for (let i = n; i < MAX_LIGHTS; i++) {
        light_pos_buf[i * 4 + 3] = 0;
        light_col_buf[i * 4 + 3] = 0;
      }
      active_light_count = n;
    }

    function bindMesh(mesh) {
      const stride = (mesh && mesh.stride ? mesh.stride : 8) * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(uv_loc);
      gl.vertexAttribPointer(uv_loc, 2, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(normal_loc);
      gl.vertexAttribPointer(normal_loc, 3, gl.FLOAT, false, stride, 5 * 4);
    }

    function bindWallMesh(mesh) {
      const stride = 10 * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(uv_loc);
      gl.vertexAttribPointer(uv_loc, 2, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(normal_loc);
      gl.vertexAttribPointer(normal_loc, 3, gl.FLOAT, false, stride, 5 * 4);
      gl.enableVertexAttribArray(wall_atlas_loc);
      gl.vertexAttribPointer(wall_atlas_loc, 2, gl.FLOAT, false, stride, 8 * 4);
    }

    function unbindMesh() {
      gl.disableVertexAttribArray(uv_loc);
      gl.disableVertexAttribArray(normal_loc);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    function unbindWallMesh() {
      gl.disableVertexAttribArray(wall_atlas_loc);
      unbindMesh();
    }

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
    this.clearDynamicLights = clearDynamicLights;
    this.addDynamicLight = addDynamicLight;
    this.getActiveLights = function () {
      return { pos: light_pos_buf, col: light_col_buf, count: active_light_count };
    };
    this.getLightmapTexId = function () {
      return fbo_lightmap.getTexture();
    };
    this.getLevelInvSize = function () {
      return 1 / size;
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
    this.isWorldVisible = function () {
      return true;
    };
    // Приблизительная яркость в точке (x,z) на CPU — для затемнения 2D-оверлеев
    // (имена, HP-бары) в тёмных углах. Формула повторяет запекание lightmap:
    // ambient + сумма факелов с затуханием (1 - d/R)^2.
    this.getLightLevel = function (x, z) {
      let r = AMBIENT_BASE,
        g = AMBIENT_BASE,
        b = AMBIENT_BASE;
      for (let i = 0; i < static_lights.length; i++) {
        const L = static_lights[i];
        const dx = x - L.pos[0];
        const dz = z - L.pos[2];
        const dd = dx * dx + dz * dz;
        const rad = L.radius;
        if (dd >= rad * rad) continue;
        let att = 1 - Math.sqrt(dd) / rad;
        att *= att;
        const k = L.intensity * att;
        r += L.color[0] * k;
        g += L.color[1] * k;
        b += L.color[2] * k;
      }
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    if (state.LevelRender) {
      state.LevelRender.levelmapTexId = null;
      state.LevelRender.levelSize = size;
      state.LevelRender.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
      state.LevelRender.clearDynamicLights = clearDynamicLights;
      state.LevelRender.addDynamicLight = addDynamicLight;
      state.LevelRender.getActiveLights = this.getActiveLights;
      state.LevelRender.getLightmapTexId = this.getLightmapTexId;
      state.LevelRender.getLevelInvSize = this.getLevelInvSize;
      state.LevelRender.hasLineOfSight = this.hasLineOfSight;
      state.LevelRender.getWorldFog = this.getWorldFog;
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
    const decalAdapter = {
      render_decal: function (dynent, tex, color, sh_add) {
        if (!tex || !tex.getId || !tex.getId()) return;
        const d = dirFromDynent(dynent.dir);
        const sz = Math.max(dynent.size.x, dynent.size.y) * 0.5;
        // На стену притягиваем только попадания снарядов (есть направление
        // или высота). Декали без этого (кровь от трупов) — всегда на полу,
        // иначе при широком радиусе привязки они «повисают» на стене.
        const canWall = !!dynent.dir || (dynent.pos_z !== undefined && dynent.pos_z !== null);
        const wallHit = canWall ? findWallSegmentAt(dynent.pos.x, dynent.pos.y, d.x, d.y) : null;
        if (wallHit) {
          spawnWallDecalOnSegment(
            dynent.pos,
            dynent.pos_z,
            wallHit,
            sz,
            color,
            tex.getId(),
            dynent.angle || 0,
            sh_add,
          );
          // Низ отпечатка достаёт до пола — продолжаем тот же след на полу.
          // Центрируем floor-копию ровно на линии стены (cx,cz): её половина
          // со стороны комнаты ложится на пол вплотную к стене и продолжает
          // настенное пятно, вторая половина скрыта под стеной. Так нет ни
          // зазора, ни «нового» отдельного пятна, отступающего от стены.
          if (decalReachesFloor(dynent, wallHit, sz)) {
            // Проба чуть внутрь комнаты: убеждаемся, что рядом есть пол.
            let rx = -d.x,
              ry = -d.y;
            if (rx * rx + ry * ry < 1e-6) {
              rx = wallHit.seg.nx;
              ry = wallHit.seg.nz;
            }
            const probe = { x: wallHit.cx + rx * 0.4, y: wallHit.cz + ry * 0.4 };
            if (hasFloorAt(probe)) {
              paintFloorDecal(
                {
                  pos: { x: wallHit.cx, y: wallHit.cz },
                  size: dynent.size,
                  angle: dynent.angle || 0,
                },
                tex.getId(),
                color,
                sh_add,
              );
            }
          }
          return;
        }
        if (!hasFloorAt(dynent.pos)) return;
        paintFloorDecal(dynent, tex.getId(), color, sh_add);
      },
      getDecalTexture: function () {
        return fbo_decal_floor.getTexture();
      },
    };
    this.getDecal = function () {
      return decalAdapter;
    };
    this.beginFrame = function (camera) {
      state.viewProj3D = buildViewProjection(camera);
      renderVisibleMap(camera);
      state.LevelRender.tex_visible_id = fbo_visible.getTexture();
      state.LevelRender.eye_height = eye_height;
      state.LevelRender.levelmapTexId = levelmap.getId();
      state.LevelRender.levelSize = size;
      state.LevelRender.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
      selectActiveLights(camera);
    };
    this.render = function (camera) {
      if (!this.ready()) return;

      // Затухание декалей: каждый кадр FBO мультиплицируется на коэффициент.
      fadeDecalsStep();

      // Анимированный поток лавы — отдельный pre-pass в FBO, тот же шейдер, что в 2D.
      renderLavaAnimation();

      // Активные точечные лайты (динамика). Статика уже запечена в lightmap.
      this.beginFrame(camera);

      // Глубина сцены в отдельный FBO — для soft-particles объёмного тумана.
      renderDepthPrepass(state.viewProj3D);

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

      const decal_tex = fbo_decal_floor.getTexture();
      const lightmap_tex = fbo_lightmap.getTexture();
      const visible_tex = fbo_visible.getTexture();

      shader_floor.use();
      shader_floor.matrix(shader_floor.view_proj, view_proj);
      shader_floor.vector(shader_floor.scale_world, [level_scale, detail_scale, 0, 0]);
      shader_floor.vector(shader_floor.cam_pos, cam_eye_v);
      shader_floor.vector(shader_floor.time, [t, t * 0.7, 0, 0]);
      // lava_params.x = tiling в координатах level UV (как в 2D: scale = 10 * size / 64).
      // lava_params.y = фазовое время 0..1 (как в 2D scale_time.z), задаёт mix между двумя выборками.
      const lava_tile = (10 * size) / 64;
      const lava_phase = (Date.now() % 1000) / 1000;
      shader_floor.vector(shader_floor.lava_params, [lava_tile, lava_phase, 0, 0]);
      shader_floor.texture(shader_floor.levelmap, levelmap.getId(), 0);
      shader_floor.texture(shader_floor.tex_ground_1, tex_ground1.getId(), 1);
      shader_floor.texture(shader_floor.tex_ground_2, tex_ground2.getId(), 2);
      shader_floor.texture(shader_floor.tex_lava, tex_lava.getId(), 3);
      shader_floor.texture(shader_floor.tex_velocity, tex_velocity.getId(), 4);
      shader_floor.texture(shader_floor.tex_wave, fbo_wave.getTexture(), 5);
      shader_floor.texture(shader_floor.tex_decal, decal_tex, 6);
      shader_floor.texture(shader_floor.tex_lightmap, lightmap_tex, 7);
      shader_floor.texture(shader_floor.tex_visible, visible_tex, 8);
      applyLights(lights_loc_floor);
      bindMesh(floor_mesh);
      gl.drawArrays(gl.TRIANGLES, 0, floor_mesh.count);

      shader_wall.use();
      shader_wall.matrix(shader_wall.view_proj, view_proj);
      shader_wall.vector(shader_wall.scale_world, [level_scale, detail_scale * 0.6, 0, 0]);
      shader_wall.vector(shader_wall.cam_pos, cam_eye_v);
      shader_wall.texture(shader_wall.tex_wall, tex_wall.getId(), 0);
      shader_wall.texture(shader_wall.tex_lightmap, lightmap_tex, 1);
      shader_wall.texture(shader_wall.tex_visible, visible_tex, 2);
      if (fbo_decal_wall)
        shader_wall.texture(shader_wall.tex_wall_decal, fbo_decal_wall.getTexture(), 3);
      else shader_wall.texture(shader_wall.tex_wall_decal, tex_visible_black, 3);
      applyLights(lights_loc_wall);
      bindWallMesh(wall_mesh);
      gl.drawArrays(gl.TRIANGLES, 0, wall_mesh.count);
      unbindWallMesh();

      shader_ceiling.use();
      shader_ceiling.matrix(shader_ceiling.view_proj, view_proj);
      shader_ceiling.vector(shader_ceiling.scale_world, [level_scale, detail_scale, 0, 0]);
      shader_ceiling.vector(shader_ceiling.cam_pos, cam_eye_v);
      shader_ceiling.texture(shader_ceiling.tex_wall, tex_wall.getId(), 0);
      shader_ceiling.texture(shader_ceiling.tex_lightmap, lightmap_tex, 1);
      shader_ceiling.texture(shader_ceiling.tex_visible, visible_tex, 2);
      applyLights(lights_loc_ceiling);
      bindMesh(ceiling_mesh);
      gl.drawArrays(gl.TRIANGLES, 0, ceiling_mesh.count);

      if (bridges_mesh.count > 0) {
        shader_bridge.use();
        shader_bridge.matrix(shader_bridge.view_proj, view_proj);
        shader_bridge.vector(shader_bridge.scale_world, [level_scale, detail_scale * 0.7, 0, 0]);
        shader_bridge.vector(shader_bridge.cam_pos, cam_eye_v);
        shader_bridge.texture(shader_bridge.tex_wall, tex_bridge.getId(), 0);
        shader_bridge.texture(shader_bridge.tex_decal, decal_tex, 1);
        shader_bridge.texture(shader_bridge.tex_lightmap, lightmap_tex, 2);
        shader_bridge.texture(shader_bridge.tex_visible, visible_tex, 3);
        applyLights(lights_loc_bridge);
        bindMesh(bridges_mesh);
        gl.drawArrays(gl.TRIANGLES, 0, bridges_mesh.count);
      }

      unbindMesh();
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
      renderVolumetricFog(state.viewProj3D);
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
      shader_minimap.texture(shader_minimap.levelmap, levelmap.getId(), 0);
      shader_minimap.vector(shader_minimap.pos, [pos.x, pos.y, 0, 0]);
      shader_minimap.vector(shader_minimap.player_angle, [camera.angle || 0, 0, 0, 0]);
      shader_minimap.vector(shader_minimap.time, [t, 0, 0, 0]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    };
  }
}

export { LevelRender3D };
