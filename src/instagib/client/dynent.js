import { Texture } from '../engine/texture.js';
import { assert } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { Dynent } from '../server/objects/dynent.js';

function applyCommonShaderState(shader, tex_id, mat_pos, states) {
    shader.use();
    shader.texture(shader.tex, tex_id, 0);
    const need_visible = !(states && states.not_use_visible);
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
    shader.matrix(shader.mat_pos, mat_pos);
    if (states && states.mat_tex !== undefined) shader.matrix(shader.mat_tex, states.mat_tex);
}

function render3DBeam(camera, shader, tex_id, pos, size, angle, states) {
    const half_len = Math.abs(size[1]) * 0.5;
    const half_width = Math.max(Math.abs(size[0]) * 0.5, 0.05);
    const sin_a = Math.sin(angle);
    const cos_a = Math.cos(angle);
    const dir_x = -sin_a;
    const dir_z = -cos_a;
    const eye_height = (state.LevelRender && state.LevelRender.eye_height) || 1.6;
    const beam_y = eye_height - 0.2;

    const start_x = pos.x - dir_x * half_len;
    const start_z = pos.y - dir_z * half_len;
    const end_x = pos.x + dir_x * half_len;
    const end_z = pos.y + dir_z * half_len;
    const mid_x = (start_x + end_x) * 0.5;
    const mid_z = (start_z + end_z) * 0.5;

    const beam_half_x = (end_x - start_x) * 0.5;
    const beam_half_z = (end_z - start_z) * 0.5;

    const to_cam_x = camera.pos.x - mid_x;
    const to_cam_y = eye_height - beam_y;
    const to_cam_z = camera.pos.y - mid_z;

    let side_x = -beam_half_z * to_cam_y;
    let side_y = beam_half_z * to_cam_x - beam_half_x * to_cam_z;
    let side_z = beam_half_x * to_cam_y;
    let side_len = Math.sqrt(side_x * side_x + side_y * side_y + side_z * side_z);
    if (side_len < 0.0001) {
        side_x = 0; side_y = 1; side_z = 0; side_len = 1;
    }
    const k = half_width / side_len;
    side_x *= k; side_y *= k; side_z *= k;

    const model = new Float32Array(16);
    model[0] = beam_half_x; model[1] = 0; model[2] = beam_half_z; model[3] = 0;
    model[4] = side_x;       model[5] = side_y; model[6] = side_z; model[7] = 0;
    model[8] = 0;            model[9] = 0;     model[10] = 1;     model[11] = 0;
    model[12] = mid_x;       model[13] = beam_y; model[14] = mid_z; model[15] = 1;

    const mat4 = state.mat4;
    const mat_pos = mat4.create();
    mat4.multiply(mat_pos, state.viewProj3D, model);

    applyCommonShaderState(shader, tex_id, mat_pos, states);

    const gl = state.gl;
    const count = states && states.vertices_count !== undefined ? states.vertices_count : 4;
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
    state.stats.count_dynent_rendering++;
}

function render3DBillboard(camera, shader, tex_id, pos, size, angle, states) {
    const yaw = camera.angle;
    const dx = pos.x - camera.pos.x;
    const dz = pos.y - camera.pos.y;
    const forward_x = -Math.sin(yaw);
    const forward_z = -Math.cos(yaw);
    const view_z = dx * forward_x + dz * forward_z;
    if (view_z < 0.05) return;

    const sx = Math.abs(size[0]);
    const sy = Math.abs(size[1]);
    if (sy > sx * 3.0) {
        return render3DBeam(camera, shader, tex_id, pos, size, angle || 0, states);
    }

    const right_x = Math.cos(yaw);
    const right_z = -Math.sin(yaw);

    const flip = size[0] < 0 ? -1 : 1;
    const eye_height = (state.LevelRender && state.LevelRender.eye_height) || 1.6;
    const y_anchor = (states && states.y_anchor) || 'feet';
    const y_offset = states && states.y_offset !== undefined ? states.y_offset : 0;
    let center_y;
    if (y_anchor === 'eye') center_y = eye_height + y_offset;
    else if (y_anchor === 'floor') center_y = y_offset;
    else center_y = sy * 0.5 + y_offset;

    const mat4 = state.mat4;
    const model = mat4.create();
    mat4.identity(model);
    mat4.translate(model, model, [pos.x, center_y, pos.y]);
    const bb = new Float32Array([
        right_x * flip, 0, right_z * flip, 0,
        0, 1, 0, 0,
        -right_z, 0, right_x, 0,
        0, 0, 0, 1,
    ]);
    const tmp = mat4.create();
    mat4.multiply(tmp, model, bb);
    mat4.scale(tmp, tmp, [sx * 0.5, sy * 0.5, 1]);

    const mat_pos = mat4.create();
    mat4.multiply(mat_pos, state.viewProj3D, tmp);

    applyCommonShaderState(shader, tex_id, mat_pos, states);

    const gl = state.gl;
    const count = states && states.vertices_count !== undefined ? states.vertices_count : 4;
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
    state.stats.count_dynent_rendering++;
}

Dynent.render = function (camera, texture, shader, pos, size, angle, states) {
    assert(camera);
    assert(texture);
    assert(shader);
    const tex_id = texture instanceof Texture ? texture.getId() : texture;
    if (tex_id === null) return;
    render3DBillboard(camera, shader, tex_id, pos, size, angle, states);
};
