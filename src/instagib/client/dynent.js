import { Billboard } from '../engine/billboard.js';
import { Texture } from '../engine/texture.js';
import { assert } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { Dynent } from '../server/objects/dynent.js';

function applyCommonShaderState(shader, tex_id, mat_pos, states) {
  shader.use();
  shader.texture(shader.tex, tex_id, 0);
  // Туман войны отключён — спрайты не затемняются картой видимости.
  if (shader.fog_uv) {
    shader.vector(shader.fog_uv, [0, 0, 0, 0]);
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
    side_x = 0;
    side_y = 1;
    side_z = 0;
    side_len = 1;
  }
  const k = half_width / side_len;
  side_x *= k;
  side_y *= k;
  side_z *= k;

  const model = new Float32Array(16);
  model[0] = beam_half_x;
  model[1] = 0;
  model[2] = beam_half_z;
  model[3] = 0;
  model[4] = side_x;
  model[5] = side_y;
  model[6] = side_z;
  model[7] = 0;
  model[8] = 0;
  model[9] = 0;
  model[10] = 1;
  model[11] = 0;
  model[12] = mid_x;
  model[13] = beam_y;
  model[14] = mid_z;
  model[15] = 1;

  const mat4 = state.mat4;
  const mat_pos = mat4.create();
  mat4.multiply(mat_pos, state.viewProj3D, model);

  applyCommonShaderState(shader, tex_id, mat_pos, states);

  const gl = state.gl;
  const count = states && states.vertices_count !== undefined ? states.vertices_count : 4;
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, count);
  state.stats.count_dynent_rendering++;
}

// Draws a camera-facing quad between two arbitrary 3D points p0/p1 (each is
// [worldX, height, worldZ]). Unlike render3DBeam it honours the real Y of both
// endpoints, so it can be used to build bent/animated beams (e.g. lightning).
function renderSegmentBeam(camera, shader, tex_id, p0, p1, width, states) {
  const eye_height = (state.LevelRender && state.LevelRender.eye_height) || 1.6;
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const len = Math.sqrt(ax * ax + ay * ay + az * az);
  if (len < 0.0001) return;

  const mx = (p0[0] + p1[0]) * 0.5;
  const my = (p0[1] + p1[1]) * 0.5;
  const mz = (p0[2] + p1[2]) * 0.5;

  const dx = ax / len;
  const dy = ay / len;
  const dz = az / len;

  const to_cam_x = camera.pos.x - mx;
  const to_cam_y = eye_height - my;
  const to_cam_z = camera.pos.y - mz;

  // side = dir x toCam  (perpendicular to the beam axis, facing the camera)
  let side_x = dy * to_cam_z - dz * to_cam_y;
  let side_y = dz * to_cam_x - dx * to_cam_z;
  let side_z = dx * to_cam_y - dy * to_cam_x;
  let side_len = Math.sqrt(side_x * side_x + side_y * side_y + side_z * side_z);
  if (side_len < 0.0001) {
    side_x = 0;
    side_y = 1;
    side_z = 0;
    side_len = 1;
  }
  const k = (width * 0.5) / side_len;
  side_x *= k;
  side_y *= k;
  side_z *= k;

  const model = new Float32Array(16);
  model[0] = ax * 0.5;
  model[1] = ay * 0.5;
  model[2] = az * 0.5;
  model[3] = 0;
  model[4] = side_x;
  model[5] = side_y;
  model[6] = side_z;
  model[7] = 0;
  model[8] = 0;
  model[9] = 0;
  model[10] = 1;
  model[11] = 0;
  model[12] = mx;
  model[13] = my;
  model[14] = mz;
  model[15] = 1;

  const mat4 = state.mat4;
  const mat_pos = mat4.create();
  mat4.multiply(mat_pos, state.viewProj3D, model);

  applyCommonShaderState(shader, tex_id, mat_pos, states);

  const gl = state.gl;
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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

  const flip = size[0] < 0 ? -1 : 1;
  const eye_height = (state.LevelRender && state.LevelRender.eye_height) || 1.6;
  const y_anchor = (states && states.y_anchor) || 'feet';
  const y_offset = states && states.y_offset !== undefined ? states.y_offset : 0;
  let center_y;
  if (y_anchor === 'eye') center_y = eye_height + y_offset;
  else if (y_anchor === 'floor') center_y = y_offset;
  else center_y = sy * 0.5 + y_offset;

  const mat_pos = state.mat4.create();
  Billboard.cylindrical(mat_pos, yaw, pos.x, center_y, pos.y, sx * 0.5, sy * 0.5, flip);

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

Dynent.renderSegmentBeam = function (camera, texture, shader, p0, p1, width, states) {
  assert(camera);
  assert(texture);
  assert(shader);
  const tex_id = texture instanceof Texture ? texture.getId() : texture;
  if (tex_id === null) return;
  renderSegmentBeam(camera, shader, tex_id, p0, p1, width, states);
};
