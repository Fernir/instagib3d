import { Texture } from '../engine/texture.js';
import { assert } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent, cameraCulling } from '../server/objects/dynent.js';

Dynent.render = function (camera, texture, shader, pos, size, angle, states) {
    assert(camera);
    assert(texture);
    assert(shader);
    let tex_id = texture instanceof Texture ? texture.getId() : texture;
    if (tex_id === null)
        return;
    if (cameraCulling(camera, pos, new Vector(size)))
        return;

    shader.use();
    shader.texture(shader.tex, tex_id, 0);

    let need_visible = true;
    if (states && states.not_use_visible !== undefined) need_visible = !states.not_use_visible;

    if (need_visible) {
        shader.texture(shader.tex_visible, state.LevelRender.tex_visible_id, 1);
    }

    if (states && states.textures !== undefined) {
        states.textures.forEach(function (tex, index) {
            shader.texture(tex.location, tex.id, index + 2);
        });
    }
    if (states && states.vectors !== undefined) {
        states.vectors.forEach(function (vec) {
            shader.vector(vec.location, vec.vec);
        });
    }

    const aspect = state.canvas.width / state.canvas.height;
    const h_ratio = 16.0 / 9.0;
    const koef = 1.0 / 12.0;
    const mat4 = state.mat4;
    const gl = state.gl;

    let mat_pos = mat4.create();
    mat4.trans(mat_pos, [0, -0.75]);

    if (aspect < h_ratio) mat4.scal(mat_pos, [koef / aspect, koef]);
    else mat4.scal(mat_pos, [koef / h_ratio, koef * aspect / h_ratio]);

    let mat = mat4.create();
    let vec = Vector.sub(pos, camera.pos).mul(2);
    mat4.trans(mat, [vec.x, -vec.y]);
    let rotate = mat4.create();
    mat4.rotate(rotate, -camera.angle);
    mat4.mul(mat, rotate, mat);
    mat4.mul(mat_pos, mat_pos, mat);

    mat4.rotate(mat_pos, angle);
    mat4.scal(mat_pos, size);
    shader.matrix(shader.mat_pos, mat_pos);
    if (states && states.mat_tex !== undefined) shader.matrix(shader.mat_tex, states.mat_tex);
    let count = 4;
    if (states && states.vertices_count !== undefined) count = states.vertices_count;
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
    state.stats.count_dynent_rendering++;
};

