import { state } from '@core/runtime-state.js';

// Камеро-ориентированные квады (биллборды).
//
// Единичный квад (position.xy в [-1..1]) разворачивается к камере и
// проецируется в clip-space. Результат — матрица mat_pos, которую шейдер
// умножает на position (gl_Position = mat_pos * position).
//
// Скретч-матрицы общие на модуль: рендер однопоточный и синхронный.

const _model = new Float32Array(16);
const _bb = new Float32Array(16);
const _tmp = new Float32Array(16);

export class Billboard {
  // Цилиндрический биллборд (ось Y вертикальна), развёрнутый по yaw камеры:
  // out = viewProj3D · T(x,y,z) · R(yaw) · S(halfW, halfH, 1).
  // flip < 0 зеркалит спрайт по горизонтали.
  static cylindrical(out, yaw, x, y, z, halfW, halfH, flip = 1) {
    const mat4 = state.mat4;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    mat4.identity(_model);
    mat4.translate(_model, _model, [x, y, z]);

    _bb[0] = rx * flip;
    _bb[1] = 0;
    _bb[2] = rz * flip;
    _bb[3] = 0;
    _bb[4] = 0;
    _bb[5] = 1;
    _bb[6] = 0;
    _bb[7] = 0;
    _bb[8] = -rz;
    _bb[9] = 0;
    _bb[10] = rx;
    _bb[11] = 0;
    _bb[12] = 0;
    _bb[13] = 0;
    _bb[14] = 0;
    _bb[15] = 1;

    mat4.multiply(_tmp, _model, _bb);
    mat4.scale(_tmp, _tmp, [halfW, halfH, 1]);
    mat4.multiply(out, state.viewProj3D, _tmp);
    return out;
  }
}
