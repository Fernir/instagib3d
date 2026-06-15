import { describe, it, expect } from 'vitest';

import { createGlobalMat4 } from '../src/instagib/mat4.js';

const m = createGlobalMat4();

function identity() {
  return m.create();
}

describe('createGlobalMat4', () => {
  it('exposes gl-matrix functions plus engine helpers', () => {
    expect(typeof m.create).toBe('function');
    expect(typeof m.multiply).toBe('function');
    expect(typeof m.trans).toBe('function');
    expect(typeof m.scal).toBe('function');
    expect(typeof m.rotate).toBe('function');
  });

  it('create returns the identity matrix', () => {
    const out = identity();
    expect(out[0]).toBe(1);
    expect(out[5]).toBe(1);
    expect(out[10]).toBe(1);
    expect(out[15]).toBe(1);
    expect(out[12]).toBe(0);
  });
});

describe('trans helper', () => {
  it('writes 2D translation into column 3 (z stays 0)', () => {
    const out = identity();
    m.trans(out, [4, 7]);
    expect(out[12]).toBeCloseTo(4, 10);
    expect(out[13]).toBeCloseTo(7, 10);
    expect(out[14]).toBeCloseTo(0, 10);
  });
});

describe('scal helper', () => {
  it('scales x and y, leaves z at 1', () => {
    const out = identity();
    m.scal(out, [2, 3]);
    expect(out[0]).toBeCloseTo(2, 10);
    expect(out[5]).toBeCloseTo(3, 10);
    expect(out[10]).toBeCloseTo(1, 10);
  });
});

describe('rotate helper', () => {
  it('rotates about Z by PI/2', () => {
    const out = identity();
    m.rotate(out, Math.PI / 2);
    // rotateZ: column 0 becomes (cos, sin, 0)
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[4]).toBeCloseTo(-1, 6);
    expect(out[5]).toBeCloseTo(0, 6);
  });
});
