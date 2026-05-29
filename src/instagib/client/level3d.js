import { Framebuffer } from '../engine/FBO.js';
import { Shader } from '../engine/shader.js';
import { Texture } from '../engine/texture.js';
import { state, getMousePitch } from '../runtime-state.js';
import { Buffer } from '../server/libs/buffer.js';
import { Vector } from '../server/libs/vector.js';

class LevelRender3D
{
constructor(my_level, my_size_class)
{
    const gl = state.gl;
    const level = my_level.getLevelGener();
    const raw = level.getRawLevel();
    const size = raw.getSize();
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
    if (state.LevelRender)
    {
        state.LevelRender.tex_visible_id = tex_visible_black;
        state.LevelRender.isFirstPerson3D = true;
        state.LevelRender.eye_height = eye_height;
    }

    const decalRes = Math.min(2048, Math.max(1280, size * 40));
    const fbo_decal_floor = new Framebuffer(decalRes, decalRes);
    fbo_decal_floor.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    fbo_decal_floor.unbind();

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
    const shader_lightmap_paint = new Shader(vert_lightmap_paint, frag_lightmap_paint,
        ['quad', 'color']);

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

    let lastFadeTime = Date.now();
    // Полупериод затухания декалей пола: 45 секунд (медленное «выцветание»).
    const DECAL_HALF_LIFE_MS = 45000;
    function fadeDecalsStep()
    {
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
    }

    const tex_ground1 = new Texture("/game/textures/fx/tex_grass.jpg");
    const tex_wall = new Texture("/game/textures/fx/wall.jpg");
    const tex_lava = new Texture("/game/textures/fx/lava.jpg");
    const tex_bridge = new Texture("/game/textures/fx/wall.jpg");
    const tex_noise = new Texture("/game/textures/fx/noise.png");
    let tex_ground2 = null;

    Buffer.loadImage("/game/textures/fx/tex_ground.jpg", function(R, G, B)
    {
        const ground_mask = new Buffer(R.getSize());
        ground_mask.perlin(32, 0.5).normalize(0, 1);
        tex_ground2 = Buffer.create_texture(R, G, B, ground_mask);
    });

    const mask = new Buffer(level.getTextureSize());
    mask.perlin(5 << my_size_class, 0.5).normalize(-5, 6).clamp(0, 1);

    const shadow = new Buffer(level.getTextureSize());
    shadow.shadow(level.getGroundMap(), state.sun_direction);

    const levelmap = Buffer.create_texture(
        level.getRiverMap(),
        level.getGroundMap(),
        mask,
        shadow,
        { wrap: gl.CLAMP_TO_EDGE });

    // Поле скоростей реки/лавы — задаёт направление течения по позиции (RG = vx, vy).
    // Используется в frag_lava_anim для физически согласованного «потока» как в 2D.
    const tex_velocity = Buffer.create_texture(
        level.getVelocityX(),
        level.getVelocityY(),
        level.getVelocityX(),
        level.getVelocityY(),
        { wrap: gl.CLAMP_TO_EDGE });

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
    uniform sampler2D levelmap;
    uniform vec4 scale_world;
    uniform vec4 time;
    uniform vec4 lava_params; // x = scale, y = time (0..1)
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}

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

        gl_FragColor = vec4(col, 1.0);
    }`;

    const frag_wall = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex_wall;
    uniform vec4 scale_world;
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying float v_height;
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}

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

        gl_FragColor = vec4(albedo * lighting, 1.0);
    }`;

    const frag_ceiling = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex_wall;
    uniform vec4 scale_world;
    varying vec3 v_world_pos;
    varying vec2 v_uv;
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}

    void main()
    {
        vec4 wall = texture2D(tex_wall, v_uv);
        vec3 albedo = wall.rgb * 0.45;
        vec2 uv_level = vec2(v_world_pos.x * scale_world.x, 1.0 - v_world_pos.z * scale_world.x);
        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        // Потолок далеко от факелов — даём приглушённый вклад.
        lighting += sample_static_lightmap(uv_level) * 0.45;
        lighting += accum_dyn_lights(v_world_pos, vec3(0.0, -1.0, 0.0));
        gl_FragColor = vec4(albedo * lighting, 1.0);
    }`;

    const frag_bridge = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex_wall;
    uniform sampler2D tex_decal;
    uniform vec4 scale_world;
    varying vec3 v_world_pos;
    varying vec2 v_world;
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying float v_height;
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}

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

    const shader_floor = new Shader(vert_world, frag_floor,
        ["view_proj", "levelmap", "tex_ground_1", "tex_ground_2", "tex_lava",
         "tex_velocity", "tex_wave", "tex_decal", "tex_lightmap", "scale_world",
         "time", "lava_params", "dyn_light_count"]);
    const shader_wall = new Shader(vert_world, frag_wall,
        ["view_proj", "tex_wall", "tex_lightmap", "scale_world", "dyn_light_count"]);
    const shader_ceiling = new Shader(vert_world, frag_ceiling,
        ["view_proj", "tex_wall", "tex_lightmap", "scale_world", "dyn_light_count"]);
    const shader_bridge = new Shader(vert_world, frag_bridge,
        ["view_proj", "tex_wall", "tex_decal", "tex_lightmap", "scale_world", "dyn_light_count"]);
    const shader_minimap = new Shader(vert_minimap, frag_minimap,
        ["mat_pos", "levelmap", "pos", "player_angle", "time"]);

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

    const frag_wave_2d = "\n\
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
    }\n";

    const shader_wave_3d = new Shader(vert_wave_fs, frag_wave_2d,
        ["noise", "scale_time"]);

    function renderLavaAnimation()
    {
        if (!tex_noise.ready()) return;

        const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
        const prevBlend = gl.isEnabled(gl.BLEND);
        const prevCull  = gl.isEnabled(gl.CULL_FACE);
        const prevMask  = gl.getParameter(gl.DEPTH_WRITEMASK);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.depthMask(false);

        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        const t_wave = ((Date.now() / 64) % 1000) / 1000;
        const sc_wave = 5 * size / 64;

        fbo_wave.bind();
            shader_wave_3d.use();
            shader_wave_3d.texture(shader_wave_3d.noise, tex_noise.getId(), 0);
            shader_wave_3d.vector(shader_wave_3d.scale_time,
                [sc_wave, sc_wave, t_wave, 0]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        fbo_wave.unbind();

        if (prevDepth) gl.enable(gl.DEPTH_TEST);
        if (prevBlend) gl.enable(gl.BLEND);
        if (prevCull)  gl.enable(gl.CULL_FACE);
        gl.depthMask(prevMask);
    }

    // --- 3D-decal для стен (правильные quad'ы, а не вертикальная проекция) ---
    const vert_wall_decal = `
    attribute vec3 position;
    attribute vec2 texuv;
    uniform mat4 view_proj;
    varying vec2 v_uv;
    varying vec3 v_world_pos;
    void main()
    {
        v_uv = texuv;
        v_world_pos = position;
        gl_Position = view_proj * vec4(position, 1.0);
    }`;
    // Шейдер декали стены — теперь домножает цвет на освещение поверхности,
    // чтобы декали (кровь, следы попаданий) не светились в тёмных коридорах.
    const frag_wall_decal = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform sampler2D tex;
    uniform vec4 color;
    uniform vec4 scale_world;
    uniform vec4 decal_normal; // xyz = world-space нормаль грани, на которой лежит декаль
    varying vec2 v_uv;
    varying vec3 v_world_pos;
    ${LIGHTS_GLSL}
    ${STATIC_LIGHTMAP_GLSL}

    void main()
    {
        vec4 col = texture2D(tex, v_uv);
        float a = col.r * color.a;
        if (a < 0.01) discard;

        vec2 uv_level = vec2(v_world_pos.x * scale_world.x, 1.0 - v_world_pos.z * scale_world.x);
        vec3 lighting = vec3(${AMBIENT_BASE.toFixed(2)});
        lighting += sample_static_lightmap(uv_level);
        lighting += accum_dyn_lights(v_world_pos, decal_normal.xyz);

        // Premultiplied alpha: src.rgb уже умножен на a; добавляем lighting.
        gl_FragColor = vec4(color.rgb * a * lighting, a);
    }`;
    const shader_wall_decal = new Shader(vert_wall_decal, frag_wall_decal,
        ['view_proj', 'tex', 'color', 'scale_world', 'decal_normal',
         'tex_lightmap', 'dyn_light_count']);
    const wall_decal_uv_loc = shader_wall_decal.attrib('texuv');
    const lights_loc_wall_decal = lightLocs(shader_wall_decal);

    const WALL_DECAL_MAX = 256;
    // Декаль держится долго на полной яркости, затем ~30 с плавно гаснет по alpha.
    const WALL_DECAL_TTL_MS = 90000;
    const WALL_DECAL_FADE_MS = 30000;
    // Каждая декаль: { pos:[x,y,z], normal:[nx,ny,nz], size, color:[r,g,b,a], texId, bornAt }
    const wall_decals = [];
    const wall_decal_vbo = gl.createBuffer();
    const wall_decal_buf = new Float32Array(WALL_DECAL_MAX * 6 * 5); // 6 vertex × (pos3 + uv2)

    // --- Стенные декали: привязка к граням тайлов (как makeWallMesh) ------------
    // Сервер считает коллизию по билинейно-сглаженной карте, а визуальные стены
    // выровнены по целым тайлам — поэтому точка dest может отстоять от плоскости
    // стены до ~0.5 тайла. Берём грань только если она в пределах MAX_PLANE_DIST
    // И направление выстрела заметно ориентировано против её нормали (если dir
    // задан). Без этих условий декаль «уезжает» на соседнюю далёкую стену и
    // выглядит будто висит в воздухе.
    function resolveWallFace(posX, posY, dirX, dirY)
    {
        const MAX_PLANE_DIST = 0.55;
        const ix = Math.floor(posX);
        const iy = Math.floor(posY);
        let best = null;
        let bestScore = -1e9;
        const dx = dirX || 0;
        const dy = dirY || 0;
        const hasDir = (dx * dx + dy * dy) > 1e-8;

        function tryFace(nx, ny, planeVal, axis)
        {
            const dist = axis === 'x' ? Math.abs(posX - planeVal) : Math.abs(posY - planeVal);
            if (dist > MAX_PLANE_DIST) return;

            const align = hasDir ? -(dx * nx + dy * ny) : 1;
            if (hasDir && align < 0.2) return;

            const score = (MAX_PLANE_DIST - dist) * 6 + align * 4;
            if (score > bestScore)
            {
                bestScore = score;
                best = { nx, ny, planeVal, axis };
            }
        }

        for (let oy = -1; oy <= 1; oy++)
        {
            for (let ox = -1; ox <= 1; ox++)
            {
                const tx = ix + ox;
                const ty = iy + oy;
                if (!isWall(tx, ty)) continue;
                if (!isWall(tx, ty - 1)) tryFace(0, -1, ty,     'y');
                if (!isWall(tx, ty + 1)) tryFace(0,  1, ty + 1, 'y');
                if (!isWall(tx - 1, ty)) tryFace(-1, 0, tx,     'x');
                if (!isWall(tx + 1, ty)) tryFace(1,  0, tx + 1, 'x');
            }
        }
        return best;
    }

    // Проверка: под точкой есть реальный пол (не лава без моста, не внутренность стены,
    // не за границей карты). Без неё декали «зависают» там, где пол не отрисован.
    function hasFloorAt(pos)
    {
        if (pos.x < 0 || pos.y < 0 || pos.x >= size || pos.y >= size) return false;
        if (my_level.getCollide(pos, false) > 100) return false;
        if (my_level.collideLava(pos) && !my_level.getCollideBridges(pos)) return false;
        return true;
    }

    function dirFromDynent(dir)
    {
        if (!dir) return { x: 0, y: 0 };
        const x = typeof dir.x === 'number' ? dir.x : (Array.isArray(dir) ? dir[0] : 0);
        const y = typeof dir.y === 'number' ? dir.y : (Array.isArray(dir) ? dir[1] : 0);
        // Нормализуем — снарядные vel имеют крошечную длину (speed≈0.02),
        // и тогда align в resolveWallFace оказывается ≈0 и реджектит грань.
        const len = Math.sqrt(x * x + y * y);
        if (len < 1e-6) return { x: 0, y: 0 };
        return { x: x / len, y: y / len };
    }

    // Клиппинг декали по продолжению стены: не даём «висеть в воздухе» рядом с углом.
    // Возвращает максимальные сдвиги в направлениях ±basis_tangent (negT/posT).
    // Знак basis_tangent зависит от ориентации стены — см. buildWallDecalBasis.
    function clipWallDecalExtents(face, posX, posY, size)
    {
        const STEP = 0.08;
        let wallTileX = 0, emptyTileX = 0, wallTileY = 0, emptyTileY = 0;
        let tSignX = 0, tSignY = 0;
        if (face.axis === 'x')
        {
            wallTileX  = face.nx > 0 ? Math.floor(face.planeVal) - 1 : Math.floor(face.planeVal);
            emptyTileX = face.nx > 0 ? Math.floor(face.planeVal)     : Math.floor(face.planeVal) - 1;
            // basis tangent = (0,0, nx>0?+1:-1) в engine. engine +Z ↔ world +Y.
            tSignY = face.nx > 0 ? 1 : -1;
        }
        else
        {
            wallTileY  = face.ny > 0 ? Math.floor(face.planeVal) - 1 : Math.floor(face.planeVal);
            emptyTileY = face.ny > 0 ? Math.floor(face.planeVal)     : Math.floor(face.planeVal) - 1;
            // basis tangent = (nz>0?-1:+1, 0, 0) где nz = ny. engine +X ↔ world +X.
            tSignX = face.ny > 0 ? -1 : 1;
        }

        function isContinuousAt(stepDist)
        {
            if (face.axis === 'x')
            {
                const ty = Math.floor(posY + tSignY * stepDist);
                return isWall(wallTileX, ty) && !isWall(emptyTileX, ty);
            }
            const tx = Math.floor(posX + tSignX * stepDist);
            return isWall(tx, wallTileY) && !isWall(tx, emptyTileY);
        }

        let posT = 0, negT = 0;
        for (let d = STEP; d <= size + 1e-3; d += STEP)
        {
            if (isContinuousAt(d)) posT = d; else break;
        }
        for (let d = STEP; d <= size + 1e-3; d += STEP)
        {
            if (isContinuousAt(-d)) negT = d; else break;
        }
        if (negT < 0.02 && posT < 0.02) { negT = posT = Math.min(size, 0.05); }
        return { negT, posT, negU: size, posU: size };
    }

    function spawnWallDecal(pos, posZ, face, size, color, texId, angle)
    {
        if (!texId || !face) return;
        const offset = 0.04;
        let px, pz;
        if (face.axis === 'x')
        {
            px = face.planeVal + face.nx * offset;
            pz = pos.y;
        }
        else
        {
            px = pos.x;
            pz = face.planeVal + face.ny * offset;
        }
        let py = (posZ !== undefined && posZ !== null)
            ? posZ
            : ((state.LevelRender && state.LevelRender.eye_height) || 1.6);
        py = Math.max(0.04, Math.min(wall_height - 0.04, py));

        const ext = clipWallDecalExtents(face, pos.x, pos.y, size);
        ext.negU = Math.max(0, Math.min(size, py));
        ext.posU = Math.max(0, Math.min(size, wall_height - py));

        while (wall_decals.length >= WALL_DECAL_MAX) wall_decals.shift();
        wall_decals.push({
            pos: [px, py, pz],
            normal: [face.nx, 0, face.ny],
            angle: angle || 0,
            size: size,
            ext: ext,
            color: [color[0], color[1], color[2], color[3] !== undefined ? color[3] : 1],
            texId: texId,
            bornAt: Date.now(),
        });
    }

    function buildWallDecalBasis(n)
    {
        let tx, ty, tz, ux, uy, uz;
        if (n[1] > 0.5)
        {
            tx = 1; ty = 0; tz = 0;
            ux = 0; uy = 0; uz = 1;
            return { tx, ty, tz, ux, uy, uz };
        }
        const nx = n[0], nz = n[2];
        if (Math.abs(nx) >= 0.5)
        {
            tz = nx > 0 ? 1 : -1;
            tx = 0; ty = 0;
        }
        else
        {
            tx = nz > 0 ? -1 : 1;
            ty = 0; tz = 0;
        }
        ux = 0; uy = 1; uz = 0;
        return { tx, ty, tz, ux, uy, uz };
    }

    function spawnFloorDecal(pos, size, color, texId, angle)
    {
        if (!texId) return;
        const py = 0.04;
        while (wall_decals.length >= WALL_DECAL_MAX) wall_decals.shift();
        wall_decals.push({
            pos: [pos.x, py, pos.y],
            normal: [0, 1, 0],
            angle: angle || 0,
            size: size,
            color: [color[0], color[1], color[2], color[3] !== undefined ? color[3] : 1],
            texId: texId,
            bornAt: Date.now(),
        });
    }

    function buildWallDecalsMesh()
    {
        // Возвращаем суммарное число живых декалей и заполненный wall_decal_buf.
        const now = Date.now();
        let alive = 0;
        // Чистим протухшие в начале (без сохранения порядка не страшно).
        for (let i = wall_decals.length - 1; i >= 0; i--)
        {
            if (now - wall_decals[i].bornAt > WALL_DECAL_TTL_MS)
                wall_decals.splice(i, 1);
        }
        for (let i = 0; i < wall_decals.length; i++)
        {
            const d = wall_decals[i];
            const n = d.normal;
            const b = buildWallDecalBasis(n);
            let tx = b.tx, ty = b.ty, tz = b.tz;
            let ux = b.ux, uy = b.uy, uz = b.uz;
            const ang = d.angle || 0;
            if (ang !== 0)
            {
                const cr = Math.cos(ang), sr = Math.sin(ang);
                const ntx = tx * cr + ux * sr;
                const nty = ty * cr + uy * sr;
                const ntz = tz * cr + uz * sr;
                const nux = -tx * sr + ux * cr;
                const nuy = -ty * sr + uy * cr;
                const nuz = -tz * sr + uz * cr;
                tx = ntx; ty = nty; tz = ntz;
                ux = nux; uy = nuy; uz = nuz;
            }
            const s = d.size;
            const p = d.pos;
            // Асимметричные сдвиги от центра вдоль tangent (t) и up (u).
            const e = d.ext || { negT: s, posT: s, negU: s, posU: s };
            const tN = e.negT, tP = e.posT, uN = e.negU, uP = e.posU;
            const corners = [
                [p[0] - tx*tN - ux*uN, p[1] - ty*tN - uy*uN, p[2] - tz*tN - uz*uN],
                [p[0] + tx*tP - ux*uN, p[1] + ty*tP - uy*uN, p[2] + tz*tP - uz*uN],
                [p[0] + tx*tP + ux*uP, p[1] + ty*tP + uy*uP, p[2] + tz*tP + uz*uP],
                [p[0] - tx*tN + ux*uP, p[1] - ty*tN + uy*uP, p[2] - tz*tN + uz*uP],
            ];
            // UV пропорционально срезу полной декали [-s..+s] -> асимметричные edges.
            const inv2s = 1 / (2 * s);
            const u0 = (s - tN) * inv2s, u1 = (s + tP) * inv2s;
            const v0 = (s - uN) * inv2s, v1 = (s + uP) * inv2s;
            const uvs = [[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
            const tri = [0,1,2, 0,2,3];
            const off = alive * 6 * 5;
            for (let j = 0; j < 6; j++)
            {
                const c = corners[tri[j]];
                const u = uvs[tri[j]];
                wall_decal_buf[off + j*5 + 0] = c[0];
                wall_decal_buf[off + j*5 + 1] = c[1];
                wall_decal_buf[off + j*5 + 2] = c[2];
                wall_decal_buf[off + j*5 + 3] = u[0];
                wall_decal_buf[off + j*5 + 4] = u[1];
            }
            alive++;
        }
        return alive;
    }

    function renderWallDecals(view_proj)
    {
        if (wall_decals.length === 0) return;
        const count = buildWallDecalsMesh();
        if (count === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, wall_decal_vbo);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array(wall_decal_buf.buffer, 0, count * 6 * 5),
            gl.DYNAMIC_DRAW);

        // Decals — двусторонние спрайты на стенах. Любое отсечение по обратной
        // грани спрячет половину из-за случайного winding'а — отключаем cull.
        const cullWasEnabled = gl.isEnabled(gl.CULL_FACE);
        gl.disable(gl.CULL_FACE);

        gl.enable(gl.BLEND);
        // Premultiplied alpha — как при отрисовке в FBO пола.
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);

        shader_wall_decal.use();
        shader_wall_decal.matrix(shader_wall_decal.view_proj, view_proj);
        // Освещение декалей: те же уровневые UV и lightmap, что у пола/стен.
        const level_scale = 1 / size;
        shader_wall_decal.vector(shader_wall_decal.scale_world, [level_scale, 0, 0, 0]);
        shader_wall_decal.texture(shader_wall_decal.tex_lightmap, fbo_lightmap.getTexture(), 1);
        applyLights(lights_loc_wall_decal);

        const stride = 5 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(wall_decal_uv_loc);
        gl.vertexAttribPointer(wall_decal_uv_loc, 2, gl.FLOAT, false, stride, 3 * 4);

        const now = Date.now();
        for (let i = 0; i < wall_decals.length; i++)
        {
            const d = wall_decals[i];
            const age = now - d.bornAt;
            const left = WALL_DECAL_TTL_MS - age;
            // Почти весь срок — полная непрозрачность, в конце линейное затухание.
            let fade = 1.0;
            if (left < WALL_DECAL_FADE_MS)
                fade = Math.max(0, left / WALL_DECAL_FADE_MS);
            shader_wall_decal.texture(shader_wall_decal.tex, d.texId, 0);
            shader_wall_decal.vector(shader_wall_decal.color,
                [d.color[0], d.color[1], d.color[2], (d.color[3] !== undefined ? d.color[3] : 1) * fade]);
            shader_wall_decal.vector(shader_wall_decal.decal_normal,
                [d.normal[0], d.normal[1], d.normal[2], 0]);
            gl.drawArrays(gl.TRIANGLES, i * 6, 6);
        }

        gl.disableVertexAttribArray(wall_decal_uv_loc);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.depthMask(true);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.BLEND);
        if (cullWasEnabled) gl.enable(gl.CULL_FACE);
    }

    const uv_loc = shader_floor.attrib("texuv");
    const normal_loc = shader_floor.attrib("normal");

    // Получаем uniform-локации массивов лайтов для каждого шейдера.
    function lightLocs(shader)
    {
        return {
            pos: shader.getLocation("dyn_light_pos[0]"),
            col: shader.getLocation("dyn_light_col[0]"),
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

    function applyLights(locs)
    {
        gl.uniform1i(locs.count, active_light_count);
        gl.uniform4fv(locs.pos, light_pos_buf);
        gl.uniform4fv(locs.col, light_col_buf);
    }

    function isWall(x, y)
    {
        if (x < 0 || y < 0 || x >= size || y >= size) return true;
        return raw.getData(x, y) > 0.5;
    }

    function pushVertex(out, x, y, z, u, v, nx, ny, nz)
    {
        out.push(x, y, z, u, v, nx, ny, nz);
    }

    function pushQuad(out, a, b, c, d, n, uv)
    {
        const tri = [a, b, c, a, c, d];
        const uvs = [[0, 0], [uv[0], 0], [uv[0], uv[1]], [0, 0], [uv[0], uv[1]], [0, uv[1]]];
        for (let i = 0; i < 6; i++)
        {
            pushVertex(out, tri[i][0], tri[i][1], tri[i][2], uvs[i][0], uvs[i][1], n[0], n[1], n[2]);
        }
    }

    function pushBox(out, center, halfSize, angle, uvScale)
    {
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const hx = halfSize[0];
        const hy = halfSize[1];
        const hz = halfSize[2];

        function rot(x, y, z)
        {
            return [
                center[0] + x * cosA - z * sinA,
                center[1] + y,
                center[2] + x * sinA + z * cosA,
            ];
        }

        const p000 = rot(-hx, -hy, -hz);
        const p100 = rot( hx, -hy, -hz);
        const p010 = rot(-hx,  hy, -hz);
        const p110 = rot( hx,  hy, -hz);
        const p001 = rot(-hx, -hy,  hz);
        const p101 = rot( hx, -hy,  hz);
        const p011 = rot(-hx,  hy,  hz);
        const p111 = rot( hx,  hy,  hz);

        const nx = [cosA, 0, sinA];
        const nz = [-sinA, 0, cosA];

        pushQuad(out, p011, p111, p110, p010, [0, 1, 0], uvScale);
        pushQuad(out, p000, p100, p101, p001, [0, -1, 0], uvScale);
        pushQuad(out, p001, p011, p010, p000, [-nx[0], 0, -nx[2]], [uvScale[0], hy * 2]);
        pushQuad(out, p100, p110, p111, p101, [nx[0], 0, nx[2]], [uvScale[0], hy * 2]);
        pushQuad(out, p000, p010, p110, p100, [-nz[0], 0, -nz[2]], [uvScale[0], hy * 2]);
        pushQuad(out, p101, p111, p011, p001, [nz[0], 0, nz[2]], [uvScale[0], hy * 2]);
    }

    function makeMesh(vertices)
    {
        if (vertices.length === 0) return { buffer: null, count: 0 };
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        return { buffer: buffer, count: vertices.length / 8 };
    }

    function makeFloorMesh()
    {
        const out = [];
        const tex_repeat = size / 4;
        pushQuad(out,
            [0, 0, 0], [size, 0, 0], [size, 0, size], [0, 0, size],
            [0, 1, 0], [tex_repeat, tex_repeat]);
        return makeMesh(out);
    }

    function makeCeilingMesh()
    {
        const out = [];
        const tex_repeat = size / 8;
        pushQuad(out,
            [0, wall_height, size], [size, wall_height, size],
            [size, wall_height, 0], [0, wall_height, 0],
            [0, -1, 0], [tex_repeat, tex_repeat]);
        return makeMesh(out);
    }

    function makeWallMesh()
    {
        const out = [];
        for (let y = 0; y < size; y++)
        {
            for (let x = 0; x < size; x++)
            {
                if (!isWall(x, y)) continue;
                const x0 = x, x1 = x + 1, z0 = y, z1 = y + 1;
                const uv = [1, wall_height];
                if (!isWall(x, y - 1))
                    pushQuad(out, [x1, 0, z0], [x0, 0, z0], [x0, wall_height, z0], [x1, wall_height, z0], [0, 0, -1], uv);
                if (!isWall(x, y + 1))
                    pushQuad(out, [x0, 0, z1], [x1, 0, z1], [x1, wall_height, z1], [x0, wall_height, z1], [0, 0, 1], uv);
                if (!isWall(x - 1, y))
                    pushQuad(out, [x0, 0, z0], [x0, 0, z1], [x0, wall_height, z1], [x0, wall_height, z0], [-1, 0, 0], uv);
                if (!isWall(x + 1, y))
                    pushQuad(out, [x1, 0, z1], [x1, 0, z0], [x1, wall_height, z0], [x1, wall_height, z1], [1, 0, 0], uv);
            }
        }
        return makeMesh(out);
    }

    function makeBridgesMesh()
    {
        const out = [];
        const bridges = level.getBridges().getBridges();
        const plank_thick = 0.22;
        for (let i = 0; i < bridges.length; i++)
        {
            const br = bridges[i];
            const halfLen = br.size.x * 0.5 + 1.0;
            const halfWid = br.size.y * 0.5;
            const a = -br.angle;
            pushBox(out,
                [br.pos.x, plank_thick * 0.5, br.pos.y],
                [halfLen, plank_thick * 0.5, halfWid],
                a,
                [halfLen * 0.6, halfWid * 0.6]);
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
    function torchHash(ix, iy)
    {
        let h = ((ix | 0) * 73856093) ^ ((iy | 0) * 19349663);
        h = (h ^ (h >>> 13)) * 2654435761;
        return ((h >>> 0) / 4294967295);
    }

    // Каждый факел получает свой цвет/яркость/радиус, но в общем тёплом «жёлтом» спектре.
    // hue от тёплого оранжевого (~hot) до бледно-жёлтого/неонового (~cool).
    function buildTorch(x, z)
    {
        const r1 = torchHash(x * 31, z * 17);
        const r2 = torchHash(x * 53 + 7, z * 41 + 3);
        const r3 = torchHash(x * 11 + 5, z * 23 + 9);
        // Палитра — от насыщенно-оранжевого до неоново-жёлтого.
        const palette = [
            [1.00, 0.55, 0.20], // огненный
            [1.00, 0.72, 0.28], // тёплый янтарный
            [1.00, 0.92, 0.35], // жёлтый
            [1.00, 0.98, 0.55], // лимонный неон
            [1.00, 0.62, 0.18], // углей
        ];
        const idx = Math.min(palette.length - 1, Math.floor(r1 * palette.length));
        const color = palette[idx];
        // С большим радиусом интенсивность нужно мягче, иначе пересвет.
        const intensity = 0.55 + r2 * 0.65; // 0.55..1.20
        const radius = TORCH_RADIUS * (0.75 + r3 * 0.5); // ~9.75..16.25
        return { color, intensity, radius };
    }

    function makeStaticLights()
    {
        const list = [];
        for (let y = 0; y < size; y++)
        {
            for (let x = 0; x < size; x++)
            {
                if (!isWall(x, y)) continue;
                // Северная грань тайла (face -Z), идём шагом по X.
                if (!isWall(x, y - 1) && (((x + y * 7) % TORCH_STEP) === 0))
                    list.push([x + 0.5, TORCH_Y, y - 0.05]);
                if (!isWall(x, y + 1) && (((x + y * 7) % TORCH_STEP) === 5))
                    list.push([x + 0.5, TORCH_Y, y + 1.05]);
                if (!isWall(x - 1, y) && (((y + x * 7) % TORCH_STEP) === 0))
                    list.push([x - 0.05, TORCH_Y, y + 0.5]);
                if (!isWall(x + 1, y) && (((y + x * 7) % TORCH_STEP) === 5))
                    list.push([x + 1.05, TORCH_Y, y + 0.5]);
            }
        }
        // Прикрепим вариативные параметры (цвет/яркость/радиус) детерминированно по координате.
        return list.map(function(p) {
            const t = buildTorch(p[0] * 16 | 0, p[2] * 16 | 0);
            return { pos: p, color: t.color, intensity: t.intensity, radius: t.radius };
        });
    }
    const static_lights = makeStaticLights();


    // --- Запекаем статические факелы в lightmap (один раз при инициализации) ---
    function bakeStaticLightmap()
    {
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

        for (let i = 0; i < static_lights.length; i++)
        {
            const item = static_lights[i];
            const p = item.pos;
            const ndc_x = (p[0] / size) * 2 - 1;
            const ndc_y = 1 - (p[2] / size) * 2;
            const halfNdc = item.radius / size;
            shader_lightmap_paint.vector(shader_lightmap_paint.quad,
                [ndc_x, ndc_y, halfNdc, halfNdc]);
            shader_lightmap_paint.vector(shader_lightmap_paint.color,
                [item.color[0], item.color[1], item.color[2], item.intensity]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        fbo_lightmap.unbind();
    }
    bakeStaticLightmap();

    // --- Динамические лайты (снаряды и пр.) -----------------------------------
    const dyn_lights = [];
    function clearDynamicLights()
    {
        dyn_lights.length = 0;
    }
    // priority=2 — живой снаряд; priority=1 — короткая вспышка (muzzle/impact);
    // priority=0 — всё остальное. Чем выше — тем раньше попадает в активный список.
    function addDynamicLight(x, y, z, color, intensity, radius, priority)
    {
        dyn_lights.push([
            x, y, z, radius,
            color[0], color[1], color[2], intensity,
            priority !== undefined ? priority : 2,
        ]);
    }
    // Заполняет light_pos_buf/light_col_buf активными лайтами.
    // Динамические (снаряды, вспышки) ВСЕГДА имеют приоритет — иначе летящая ракета
    // в коридоре с факелами вытесняется из top-8 и перестаёт освещать сцену.
    // Оставшиеся слоты дозабиваем ближайшими к камере факелами.
    function writeLight(slot, px, py, pz, r, cr, cg, cb, inten)
    {
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
    function selectActiveLights(camera)
    {
        const cx = camera.pos.x;
        const cz = camera.pos.y;
        // Все статические факелы уже в lightmap — здесь только динамические лайты.
        // Сортируем по приоритету (priority) и по близости к камере.
        const sortedDyn = dyn_lights.slice();
        sortedDyn.sort(function(a, b) {
            if (a[8] !== b[8]) return b[8] - a[8];
            const ad = (a[0] - cx) * (a[0] - cx) + (a[2] - cz) * (a[2] - cz);
            const bd = (b[0] - cx) * (b[0] - cx) + (b[2] - cz) * (b[2] - cz);
            return ad - bd;
        });
        const n = Math.min(sortedDyn.length, MAX_LIGHTS);
        for (let i = 0; i < n; i++)
        {
            const d = sortedDyn[i];
            writeLight(i, d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]);
        }
        for (let i = n; i < MAX_LIGHTS; i++)
        {
            light_pos_buf[i * 4 + 3] = 0;
            light_col_buf[i * 4 + 3] = 0;
        }
        active_light_count = n;
    }

    function bindMesh(mesh)
    {
        const stride = 8 * 4;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(uv_loc);
        gl.vertexAttribPointer(uv_loc, 2, gl.FLOAT, false, stride, 3 * 4);
        gl.enableVertexAttribArray(normal_loc);
        gl.vertexAttribPointer(normal_loc, 3, gl.FLOAT, false, stride, 5 * 4);
    }

    function unbindMesh()
    {
        gl.disableVertexAttribArray(uv_loc);
        gl.disableVertexAttribArray(normal_loc);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    function buildViewProjection(camera)
    {
        const mat4 = state.mat4;
        const aspect = state.canvas.width / state.canvas.height;
        const projection = mat4.create();
        const view = mat4.create();
        const view_proj = mat4.create();
        const pitch = getMousePitch();
        const yaw = camera.angle;
        const cp = Math.cos(pitch);

        const eye = [camera.pos.x, eye_height, camera.pos.y];
        const forward = [
            -Math.sin(yaw) * cp,
            Math.sin(pitch),
            -Math.cos(yaw) * cp,
        ];
        const target = [
            eye[0] + forward[0],
            eye[1] + forward[1],
            eye[2] + forward[2],
        ];

        mat4.perspective(projection, Math.PI * 0.42, aspect, 0.05, size * 2);
        mat4.lookAt(view, eye, target, [0, 1, 0]);
        mat4.mul(view_proj, projection, view);
        return view_proj;
    }

    function calc_minimap_position(camera)
    {
        return Vector.mul(camera.pos, 1 / size).mul2(1, -1).add2(-0.5, 0.5);
    }

    this.isFirstPerson3D = true;
    this.eye_height = eye_height;
    this.tex_visible_id = tex_visible_black;
    this.levelmapTexId = null;
    this.levelSize = size;
    this.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
    this.clearDynamicLights = clearDynamicLights;
    this.addDynamicLight = addDynamicLight;
    this.getActiveLights = function() {
        return { pos: light_pos_buf, col: light_col_buf, count: active_light_count };
    };
    this.getLightmapTexId = function() { return fbo_lightmap.getTexture(); };
    this.getLevelInvSize = function() { return 1 / size; };
    if (state.LevelRender)
    {
        state.LevelRender.levelmapTexId = null;
        state.LevelRender.levelSize = size;
        state.LevelRender.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
        state.LevelRender.clearDynamicLights = clearDynamicLights;
        state.LevelRender.addDynamicLight = addDynamicLight;
        state.LevelRender.getActiveLights = this.getActiveLights;
        state.LevelRender.getLightmapTexId = this.getLightmapTexId;
        state.LevelRender.getLevelInvSize = this.getLevelInvSize;
    }
    this.ready = function()
    {
        return tex_ground2 !== null
            && tex_ground1.ready()
            && tex_ground2.ready()
            && tex_wall.ready()
            && tex_bridge.ready()
            && tex_lava.ready()
            && tex_noise.ready();
    };
    this.getLevel = function()
    {
        return my_level;
    };
    const decalAdapter = {
        render_decal: function(dynent, tex, color, _sh_add) {
            if (!tex || !tex.getId || !tex.getId()) return;
            const d = dirFromDynent(dynent.dir);
            const face = resolveWallFace(dynent.pos.x, dynent.pos.y, d.x, d.y);
            const sz = Math.max(dynent.size.x, dynent.size.y) * 0.5;
            if (face) {
                spawnWallDecal(
                    dynent.pos, dynent.pos_z, face, sz, color, tex.getId(), dynent.angle || 0);
                return;
            }
            // Нет ближайшей стены — кладём на пол, но только если он там есть.
            if (!hasFloorAt(dynent.pos)) return;
            spawnFloorDecal(dynent.pos, sz, color, tex.getId(), dynent.angle || 0);
        },
        getDecalTexture: function() {
            return fbo_decal_floor.getTexture();
        },
    };
    this.getDecal = function() { return decalAdapter; };
    this.beginFrame = function(camera)
    {
        state.viewProj3D = buildViewProjection(camera);
        state.LevelRender.tex_visible_id = tex_visible_black;
        state.LevelRender.eye_height = eye_height;
        state.LevelRender.levelmapTexId = levelmap.getId();
        state.LevelRender.levelSize = size;
        state.LevelRender.sunDir = [state.sun_direction.x, -0.8, state.sun_direction.y];
        selectActiveLights(camera);
    };
    this.render = function(camera)
    {
        if (!this.ready()) return;

        // Затухание декалей: каждый кадр FBO мультиплицируется на коэффициент.
        fadeDecalsStep();

        // Анимированный поток лавы — отдельный pre-pass в FBO, тот же шейдер, что в 2D.
        renderLavaAnimation();

        // Активные точечные лайты (динамика). Статика уже запечена в lightmap.
        this.beginFrame(camera);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, state.canvas.width, state.canvas.height);
        gl.clearColor(0.08, 0.10, 0.13, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);

        const view_proj = state.viewProj3D;
        const detail_scale = 10 * size / 64 / size;
        const level_scale = 1 / size;
        const t = (Date.now() % 100000) * 0.001;

        const decal_tex = fbo_decal_floor.getTexture();
        const lightmap_tex = fbo_lightmap.getTexture();

        shader_floor.use();
        shader_floor.matrix(shader_floor.view_proj, view_proj);
        shader_floor.vector(shader_floor.scale_world, [level_scale, detail_scale, 0, 0]);
        shader_floor.vector(shader_floor.time, [t, t * 0.7, 0, 0]);
        // lava_params.x = tiling в координатах level UV (как в 2D: scale = 10 * size / 64).
        // lava_params.y = фазовое время 0..1 (как в 2D scale_time.z), задаёт mix между двумя выборками.
        const lava_tile = 10 * size / 64;
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
        applyLights(lights_loc_floor);
        bindMesh(floor_mesh);
        gl.drawArrays(gl.TRIANGLES, 0, floor_mesh.count);

        shader_wall.use();
        shader_wall.matrix(shader_wall.view_proj, view_proj);
        shader_wall.vector(shader_wall.scale_world, [level_scale, detail_scale * 0.6, 0, 0]);
        shader_wall.texture(shader_wall.tex_wall, tex_wall.getId(), 0);
        shader_wall.texture(shader_wall.tex_lightmap, lightmap_tex, 1);
        applyLights(lights_loc_wall);
        bindMesh(wall_mesh);
        gl.drawArrays(gl.TRIANGLES, 0, wall_mesh.count);

        shader_ceiling.use();
        shader_ceiling.matrix(shader_ceiling.view_proj, view_proj);
        shader_ceiling.vector(shader_ceiling.scale_world, [level_scale, detail_scale, 0, 0]);
        shader_ceiling.texture(shader_ceiling.tex_wall, tex_wall.getId(), 0);
        shader_ceiling.texture(shader_ceiling.tex_lightmap, lightmap_tex, 1);
        applyLights(lights_loc_ceiling);
        bindMesh(ceiling_mesh);
        gl.drawArrays(gl.TRIANGLES, 0, ceiling_mesh.count);

        if (bridges_mesh.count > 0)
        {
            shader_bridge.use();
            shader_bridge.matrix(shader_bridge.view_proj, view_proj);
            shader_bridge.vector(shader_bridge.scale_world, [level_scale, detail_scale * 0.7, 0, 0]);
            shader_bridge.texture(shader_bridge.tex_wall, tex_bridge.getId(), 0);
            shader_bridge.texture(shader_bridge.tex_decal, decal_tex, 1);
            shader_bridge.texture(shader_bridge.tex_lightmap, lightmap_tex, 2);
            applyLights(lights_loc_bridge);
            bindMesh(bridges_mesh);
            gl.drawArrays(gl.TRIANGLES, 0, bridges_mesh.count);
        }

        unbindMesh();

        // 3D-decals на стенах — рисуем после непрозрачной геометрии с blending.
        renderWallDecals(view_proj);
    };
    this.beginSpritePass = function()
    {
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
    };
    this.endSpritePass = function()
    {
        gl.depthMask(true);
        gl.disable(gl.DEPTH_TEST);
    };
    this.renderMinimap = function(camera)
    {
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
