import { createGlobalMat4 } from '@core/mat4.js';
import { describe, it, expect } from 'vitest';


const m = createGlobalMat4();

function identity() {
  return m.create();
}

describe('createGlobalMat4 — обёртка gl-matrix', () => {
  it('экспортирует функции gl-matrix и хелперы движка', () => {
    expect(typeof m.create).toBe('function');
    expect(typeof m.multiply).toBe('function');
    expect(typeof m.trans).toBe('function');
    expect(typeof m.scal).toBe('function');
    expect(typeof m.rotate).toBe('function');
  });

  it('create возвращает единичную матрицу', () => {
    const out = identity();
    expect(out[0]).toBe(1);
    expect(out[5]).toBe(1);
    expect(out[10]).toBe(1);
    expect(out[15]).toBe(1);
    expect(out[12]).toBe(0);
  });
});

describe('trans — 2D-сдвиг', () => {
  it('записывает сдвиг в столбец 3 (z остаётся 0)', () => {
    const out = identity();
    m.trans(out, [4, 7]);
    expect(out[12]).toBeCloseTo(4, 10);
    expect(out[13]).toBeCloseTo(7, 10);
    expect(out[14]).toBeCloseTo(0, 10);
  });
});

describe('scal — масштаб', () => {
  it('масштабирует x и y, z остаётся 1', () => {
    const out = identity();
    m.scal(out, [2, 3]);
    expect(out[0]).toBeCloseTo(2, 10);
    expect(out[5]).toBeCloseTo(3, 10);
    expect(out[10]).toBeCloseTo(1, 10);
  });
});

describe('rotate — поворот', () => {
  it('поворачивает вокруг Z на PI/2', () => {
    const out = identity();
    m.rotate(out, Math.PI / 2);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[4]).toBeCloseTo(-1, 6);
    expect(out[5]).toBeCloseTo(0, 6);
  });
});

describe('multiply — умножение матриц', () => {
  it('trans * scal комбинирует сдвиг и масштаб', () => {
    const a = identity();
    m.trans(a, [10, 0]);
    const b = identity();
    m.scal(b, [2, 2]);
    const out = identity();
    m.multiply(out, a, b);
    expect(out[0]).toBeCloseTo(2, 6);
    expect(out[12]).toBeCloseTo(10, 6);
  });
});
