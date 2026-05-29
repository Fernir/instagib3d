import { Framebuffer } from '../engine/FBO.js';
import { Shader } from '../engine/shader.js';
import { Texture } from '../engine/texture.js';
import { assert } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { Buffer } from '../server/libs/buffer.js';
import { Vector } from '../server/libs/vector.js';

import { BridgesRender } from './bridges.js';
import { Decal } from './decal.js';


class LevelRender
{
constructor(my_level, my_size_class)
{
    let vert = Shader.vertexShader(false, true, "position");
    let vert_simple = Shader.vertexShader(true, false);

    let frag_simple = "\n\
    #ifdef GL_ES\n\
    // define default precision for float, vec, mat.\n\
    precision highp float;\n\
    #endif\n\
    \n\
    uniform sampler2D tex;\n\
    varying vec4 texcoord;\n\
    \n\
    void main()\n\
    {\n\
        vec4 col = texture2D(tex, texcoord.xy);\n\
        gl_FragColor = col;\n\
    }\n";

    let frag_level = "\n\
    #ifdef GL_ES\n\
    // define default precision for float, vec, mat.\n\
    precision highp float;\n\
    #endif\n\
    \n\
    uniform sampler2D levelmap;\n\
    uniform sampler2D tex_walls;\n\
    uniform sampler2D tex_lava;\n\
    uniform sampler2D tex_ground_1;\n\
    uniform sampler2D tex_ground_2;\n\
    uniform sampler2D tex_wall;\n\
    uniform sampler2D tex_visible;\n\
    uniform sampler2D tex_decal;\n\
    uniform vec4 scale;\n\
    varying vec4 texcoord;\n\
    \n\
    void main()\n\
    {\n\
        vec4 level = texture2D(levelmap, texcoord.xy);\n\
        float wall_bin = texture2D(tex_walls, texcoord.xy).r;\n\
        vec4 lava = texture2D(tex_lava, texcoord.zw);\n\
        vec4 visible = texture2D(tex_visible, texcoord.zw);\n\
        vec4 decal = texture2D(tex_decal, texcoord.zw);\n\
        vec4 ground_1 = texture2D(tex_ground_1, texcoord.xy * scale.xy);\n\
        vec4 ground_2 = texture2D(tex_ground_2, texcoord.xy * scale.xy);\n\
        vec4 wall = texture2D(tex_wall, texcoord.xy * scale.xy);\n\
        \n\
        float shadow = clamp((1.0 - visible.g) * 6.0 - 3.0, 0.5, 1.0);\n\
        \n\
        float ground_mask = clamp((ground_2.a - level.b + 0.2) * 2.5, 0.0, 1.0);\n\
        vec4 ground = mix(ground_2, ground_1, ground_mask);\n\
        ground = mix(ground, decal, decal.a);\n\
        \n\
        ground = mix(ground, lava, lava.a) * shadow;\n\
        wall.rgb *= 2.0 * (1.0 - level.g) * shadow;\n\
        float visible_mask = 1.0 - visible.r;\n\
        gl_FragColor = vec4(visible_mask * mix(ground.rgb, wall.rgb, wall_bin), 1.0);\n\
    }\n";

    let frag_level_low = "\n\
    #ifdef GL_ES\n\
    // define default precision for float, vec, mat.\n\
    precision highp float;\n\
    #endif\n\
    \n\
    uniform sampler2D levelmap;\n\
    uniform sampler2D tex_walls;\n\
    uniform sampler2D tex_lava;\n\
    uniform sampler2D tex_ground_1;\n\
    uniform sampler2D tex_wall;\n\
    uniform sampler2D tex_visible;\n\
    uniform vec4 scale;\n\
    varying vec4 texcoord;\n\
    \n\
    void main()\n\
    {\n\
        vec4 level = texture2D(levelmap, texcoord.xy);\n\
        float wall_bin = texture2D(tex_walls, texcoord.xy).r;\n\
        vec4 lava = texture2D(tex_lava, texcoord.xy * scale.xy);\n\
        vec4 visible = texture2D(tex_visible, texcoord.zw);\n\
        vec4 ground = texture2D(tex_ground_1, texcoord.xy * scale.xy);\n\
        vec4 wall = texture2D(tex_wall, texcoord.xy * scale.xy);\n\
        \n\
        float shadow = clamp((1.0 - visible.g) * 6.0 - 3.0, 0.5, 1.0);\n\
        \n\
        wall.rgb *= 2.0 * (1.0 - level.g) * shadow;\n\
        float lava_mask = clamp((level.r * 2.0 - 1.0) * 30.0, 0.0, 1.0);\n\
        float visible_mask = 1.0 - visible.r;\n\
        ground = mix(ground, lava, lava_mask) * shadow;\n\
        gl_FragColor = vec4(visible_mask * mix(ground.rgb, wall.rgb, wall_bin), 1.0);\n\
    }\n";

    let frag_wave = "\n\
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

    let frag_lava = "\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec4 texcoord;\n\
    uniform sampler2D levelmap;\n\
    uniform sampler2D tex_lava;\n\
    uniform sampler2D tex_wave;\n\
    uniform sampler2D tex_velocity;\n\
    uniform vec4 scale_time;\n\
    \n\
    void main(void) \n\
    {\n\
        vec2 scale = scale_time.xy;\n\
        vec2 time = scale_time.zw;\n\
        vec4 lev = texture2D(levelmap, texcoord.xy);\n\
        vec4 vel = texture2D(tex_velocity, texcoord.xy);\n\
        vel = (vel * 2.0 - 1.0) * 0.25;\n\
        vec4 wave = texture2D(tex_wave, texcoord.zw);\n\
        vec4 col1 = texture2D(tex_lava, texcoord.xy * scale.xy + wave.rg * 0.1 + vel.xy * time.x);\n\
        vec4 col2 = texture2D(tex_lava, texcoord.xy * scale.xy + wave.rg * 0.1 - vel.xy + vel.xy * time.x);\n\
        vec4 col = mix(col1, col2, time.x);\n\
        float ng = (wave.b - 0.5) * 0.3;\n\
        float k = clamp(((lev.r + ng) * 2.0 - 1.0) * 10.0, 0.0, 1.0);\n\
        gl_FragColor = vec4(col.rgb * k, k + lev.r);\n\
    }\n";

    let frag_minimap = "\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec4 texcoord;\n\
    uniform sampler2D levelmap;\n\
    uniform vec4 pos;\n\
    \n\
    void main(void) \n\
    {\n\
        vec4 level = texture2D(levelmap, texcoord.xy);\n\
        float koef = clamp(0.05 / length((texcoord.xy * 2.0 - 1.0) - 2.0 * pos.xy), 0.9, 1.0);\n\
        koef = (koef - 0.9) * 10.0;\n\
        level = clamp((level * 2.0 - 1.0) * 1.0, 0.0, 1.0);\n\
        float alpha = (level.g + level.r) * 0.5 + koef;\n\
        gl_FragColor = vec4(level.g + level.r + koef, level.gg + vec2(koef), alpha);\n\
    }\n";

    let vert_visible = "\n\
    attribute vec4 position;\n\
    uniform mat4 mat_tex;\n\
    varying vec4 texcoord;\n\
    \n\
    void main(void) \n\
    {\n\
        gl_Position = position;\n\
        texcoord = mat_tex * position;\n\
        vec4 tc = mat_tex * vec4(0.0, -0.75, 0.0, 1.0);\n\
        texcoord.zw = tc.xy;\n\
    }\n";

    let frag_visible = "\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec4 texcoord;\n\
    uniform sampler2D levelmap;\n\
    //uniform sampler2D shadow;\n\
    \n\
    void main(void) \n\
    {\n\
        vec2 d = (texcoord.zw - texcoord.xy) / 12.0;\n\
        float res = 0.0;\n\
        const float min_val = 0.6;\n\
        vec4 level = texture2D(levelmap, texcoord.xy);\n\
        res += clamp(level.g,                                      min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d).g,       min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 2.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 3.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 4.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 5.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 6.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 7.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 8.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 9.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 10.0).g, min_val, 1.0);\n\
        res += clamp(texture2D(levelmap, texcoord.xy + d * 11.0).g, min_val, 1.0);\n\
        gl_FragColor = vec4((res - min_val * 12.0) * 2.5, level.aaa);\n\
    }\n";

    let vert_pos = Shader.vertexShader(true, false, "gl_Position");

    let frag_pos = "\n\
    #ifdef GL_ES\n\
    // define default precision for float, vec, mat.\n\
    precision highp float;\n\
    #endif\n\
    \n\
    uniform sampler2D tex;\n\
    uniform sampler2D tex_visible;\n\
    uniform sampler2D tex_decal;\n\
    varying vec4 texcoord;\n\
    \n\
    void main()\n\
    {\n\
        vec4 col = texture2D(tex, texcoord.xy);\n\
        vec4 visible = texture2D(tex_visible, texcoord.zw);\n\
        vec4 decal = texture2D(tex_decal, texcoord.zw);\n\
        float shadow = clamp((1.0 - visible.g) * 6.0 - 3.0, 0.5, 1.0);\n\
        col.rgb = mix(col.rgb, decal.rgb, decal.a);\n\
        col.rgb *= (1.0 - visible.r) * shadow;\n\
        gl_FragColor = col;\n\
    }\n";

    let shader_pos = new Shader(vert_pos, frag_pos,
    [
        "mat_pos", "tex", "tex_visible", "tex_decal",
    ]);

    let shader_level = new Shader(vert, frag_level,
    [
        "mat_tex", "levelmap", "tex_walls", "tex_lava", "tex_ground_1",
        "tex_ground_2", "tex_wall", "tex_visible", "tex_decal", "scale",
    ]);
    let shader_level_low = new Shader(vert, frag_level_low,
    [
        "mat_tex", "levelmap", "tex_walls", "tex_lava", "tex_ground_1", "tex_wall", "tex_visible", "scale",
    ]);
    let shader_wave = new Shader(vert, frag_wave,
    [
        "mat_tex", "noise", "scale_time",
    ]);
    let shader_simple = new Shader(vert_simple, frag_simple,
    [
        "mat_pos", "tex",
    ]);
    let shader_lava = new Shader(vert, frag_lava,
    [
        "mat_tex", "levelmap", "tex_velocity", "tex_lava", "tex_wave", "scale_time",
    ]);
    let shader_mininap = new Shader(vert_simple, frag_minimap,
    [
        "mat_pos", "levelmap", "pos",
    ]);
    let shader_visible = new Shader(vert_visible, frag_visible,
    [
        "mat_tex", "levelmap",
    ]);

    let tex_noise = new Texture("/game/textures/fx/noise.png");
    let tex_lava = new Texture("/game/textures/fx/lava.jpg");
    let tex_ground1 = new Texture("/game/textures/fx/tex_grass.jpg");
    let tex_ground2 = null;
    let tex_wall = new Texture("/game/textures/fx/wall.jpg");
    let tex_item_pos = new Texture("/game/textures/fx/item_pos.png");

    Buffer.loadImage("/game/textures/fx/tex_ground.jpg", function(R, G, B)
    {
        let ground_mask = new Buffer(R.getSize());
        ground_mask.perlin(32, 0.5).normalize(0, 1);
        tex_ground2 = Buffer.create_texture(R, G, B, ground_mask);
    });

    let bridgesRender = new BridgesRender(this);

    function ready()
    {
        return tex_ground2 !== null &&
               tex_noise.ready() &&
               tex_lava.ready() &&
               tex_ground1.ready() &&
               tex_ground2.ready() &&
               tex_wall.ready() &&
               tex_item_pos.ready() &&
               bridgesRender.ready();
    }

    let fbo_wave = new Framebuffer(512, 512);
    let fbo_lava = new Framebuffer(512, 512);
    let fbo_visible = new Framebuffer(64, 64);
    LevelRender.tex_visible_id = fbo_visible.getTexture();
    LevelRender.shader_simple = shader_simple;

    let level = my_level.getLevelGener();
    let my_size = level.getSize();

    //mask for ground
    let mask = new Buffer(level.getTextureSize());
    mask.perlin(5 << my_size_class, 0.5).normalize(-5, 6).clamp(0, 1);

    //shadow
    let shadow = new Buffer(level.getTextureSize());
    shadow.shadow(level.getGroundMap(), state.sun_direction);

    let texture = Buffer.create_texture(level.getRiverMap(),
                                        level.getGroundMap(),
                                        mask,
                                        shadow,
                                        { wrap: state.gl.CLAMP_TO_EDGE });
    let walls_buf = level.getWallMap();
    let texture_walls = Buffer.create_texture(walls_buf, walls_buf, walls_buf, walls_buf,
                                              { wrap: state.gl.CLAMP_TO_EDGE, filter: state.gl.NEAREST });
    let decal = new Decal(my_size_class);
    let tex_velocity = Buffer.create_texture(level.getVelocityX(),
                                             level.getVelocityY(),
                                             level.getVelocityX(),
                                             level.getVelocityY(),
                                             { wrap: state.gl.CLAMP_TO_EDGE })

    function calc_position(camera)
    {
        let pos = Vector.mul(camera.pos, 1 / my_size)
                    .mul2(1, -1)
                    .add2(-0.5, 0.5);
        return pos;
    }

    this.ready = ready;
    this.getDecal = function()
    {
        return decal;
    };
    this.getLevel = function()
    {
        return my_level;
    };
    this.render = function(camera)
    {
        if (!ready())
            return;

        assert(camera);
        const koef = 12.0 / my_size;
        const aspect = state.canvas.width / state.canvas.height;
        const h_ratio = 16.0 / 9.0;
        let mat_tex = state.mat4.create();
        let pos = calc_position(camera);
        state.mat4.trans(mat_tex, [0.5, 0.5]);
        state.mat4.trans(mat_tex, pos.toVec());
        state.mat4.rotate(mat_tex, camera.angle);
        if (aspect < h_ratio) state.mat4.scal(mat_tex, [0.5 * aspect * koef, 0.5 * koef]);
        else state.mat4.scal(mat_tex, [0.5 * h_ratio * koef, 0.5 * koef * h_ratio / aspect]);
        let mat = state.mat4.create();
        state.mat4.trans(mat, [0, 0.75]);
        state.mat4.mul(mat_tex, mat_tex, mat);

        //wave
        function render_wave()
        {
            fbo_wave.bind();
                shader_wave.use();
                shader_wave.texture(shader_wave.noise, tex_noise.getId(), 0);
                shader_wave.vector(shader_wave.scale_time,
                    [5 * my_size / 64, 5 * my_size / 64, ((Date.now() / 64) % 1000) / 1000, 0]);
                shader_wave.matrix(shader_wave.mat_tex, mat_tex);
                state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
            fbo_wave.unbind();
        }

        function render_lava()
        {
            fbo_lava.bind();
                shader_lava.use();
                shader_lava.texture(shader_lava.levelmap, texture.getId(), 0);
                shader_lava.texture(shader_lava.tex_lava, tex_lava.getId(), 1);
                shader_lava.texture(shader_lava.tex_wave, fbo_wave.getTexture(), 2);
                shader_lava.texture(shader_lava.tex_velocity, tex_velocity.getId(), 3);
                shader_lava.vector(shader_lava.scale_time, [10 * my_size / 64, 10 * my_size / 64, ((Date.now()) % 1000) / 1000, 0]);
                shader_lava.matrix(shader_lava.mat_tex, mat_tex);
                state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
            fbo_lava.unbind();
        }

        function render_map()
        {
            let shader = state.options.highQuality ? shader_level : shader_level_low;
            shader.use();
            shader.matrix(shader.mat_tex, mat_tex);
            shader.texture(shader.levelmap, texture.getId(), 0);
            if (state.options.highQuality)
                shader.texture(shader.tex_lava, fbo_lava.getTexture(), 1);
            else
                shader.texture(shader.tex_lava, tex_lava.getId(), 1);
            shader.texture(shader.tex_ground_1, tex_ground1.getId(), 2);
            shader.texture(shader.tex_wall, tex_wall.getId(), 3);
            shader.texture(shader.tex_visible, fbo_visible.getTexture(), 4);
            shader.texture(shader.tex_walls, texture_walls.getId(), 7);
            if (state.options.highQuality)
            {
                shader.texture(shader.tex_ground_2, tex_ground2.getId(), 5);
                shader.texture(shader.tex_decal, decal.getDecalTexture(), 6);
            }
            shader.vector(shader.scale, [10 * my_size / 64, 10 * my_size / 64, 0, 0]);
            state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
        }

        function render_visible()
        {
            fbo_visible.bind();
                shader_visible.use();
                shader_visible.texture(shader_visible.levelmap, texture.getId(), 0);
                shader_visible.matrix(shader_visible.mat_tex, mat_tex);
                state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
            fbo_visible.unbind();
        }

        function renderItemPos()
        {
            my_level.getItemPos().forEach(function(item_pos)
            {
                item_pos.render(camera, tex_item_pos, shader_pos,
                {
                    textures: 
                    [
                        {
                            location: shader_pos.tex_decal,
                            id: decal.getDecalTexture(),
                        },
                    ],
                });
            });
        }

        render_visible();
        if (state.options.highQuality)
        {
            decal.render(camera);
            render_wave();
            render_lava();
        }
        render_map();

        state.gl.enable(state.gl.BLEND);
        bridgesRender.render(camera, level.getBridges().getBridges());
        renderItemPos();
        state.gl.disable(state.gl.BLEND);
    };
    this.renderMinimap = function(camera)
    {
        let pos = calc_position(camera);
        state.gl.enable(state.gl.BLEND);
        let mat_pos = state.mat4.create();
        state.mat4.trans(mat_pos, [-0.8, -0.7, 0]);
        state.mat4.scal(mat_pos, [0.3 / (state.canvas.width / state.canvas.height), 0.3, 1]);
        shader_mininap.use();
        shader_mininap.texture(shader_mininap.levelmap, texture.getId(), 0);
        shader_mininap.matrix(shader_mininap.mat_pos, mat_pos);
        shader_mininap.vector(shader_mininap.pos, [pos.x, pos.y, 0, 0]);
        state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
        state.gl.disable(state.gl.BLEND);
    };
}
}   

state.LevelRender = LevelRender;
export { LevelRender };
