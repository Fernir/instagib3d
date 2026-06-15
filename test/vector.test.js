import { describe, it, expect } from 'vitest';

import { Vector } from '../src/instagib/server/libs/vector.js';

describe('Vector construction', () => {
  it('builds from two numbers', () => {
    const v = new Vector(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('builds from an array', () => {
    const v = new Vector([5, 6]);
    expect(v.x).toBe(5);
    expect(v.y).toBe(6);
  });

  it('copies from another Vector', () => {
    const src = new Vector(7, 8);
    const v = new Vector(src);
    expect(v.x).toBe(7);
    expect(v.y).toBe(8);
    // независимая копия
    src.x = 99;
    expect(v.x).toBe(7);
  });

  it('toVec returns a plain array', () => {
    expect(new Vector(1, 2).toVec()).toEqual([1, 2]);
  });
});

describe('Vector mutating ops return this', () => {
  it('set/copy/add/sub/mul chain', () => {
    const v = new Vector(0, 0);
    expect(v.set(1, 1)).toBe(v);
    expect(v.add(new Vector(2, 3))).toBe(v);
    expect(v).toMatchObject({ x: 3, y: 4 });
    v.sub(new Vector(1, 1));
    expect(v).toMatchObject({ x: 2, y: 3 });
    v.mul(2);
    expect(v).toMatchObject({ x: 4, y: 6 });
  });

  it('add2/sub2/mul2 operate componentwise', () => {
    const v = new Vector(1, 1);
    v.add2(2, 3).sub2(1, 1).mul2(2, 4);
    expect(v).toMatchObject({ x: 4, y: 12 });
  });
});

describe('Vector static ops do not mutate inputs', () => {
  it('add', () => {
    const a = new Vector(1, 2);
    const b = new Vector(3, 4);
    const r = Vector.add(a, b);
    expect(r).toMatchObject({ x: 4, y: 6 });
    expect(a).toMatchObject({ x: 1, y: 2 });
  });

  it('sub/mul/add2/sub2', () => {
    const a = new Vector(10, 10);
    expect(Vector.sub(a, new Vector(4, 6))).toMatchObject({ x: 6, y: 4 });
    expect(Vector.mul(a, 0.5)).toMatchObject({ x: 5, y: 5 });
    expect(Vector.add2(a, 1, 2)).toMatchObject({ x: 11, y: 12 });
    expect(Vector.sub2(a, 1, 2)).toMatchObject({ x: 9, y: 8 });
    expect(a).toMatchObject({ x: 10, y: 10 });
  });
});

describe('Vector geometry', () => {
  it('dot product', () => {
    expect(new Vector(1, 2).dot(new Vector(3, 4))).toBe(11);
  });

  it('length and length2', () => {
    const v = new Vector(3, 4);
    expect(v.length2()).toBe(25);
    expect(v.length()).toBe(5);
  });

  it('normalize gives unit length', () => {
    const v = new Vector(3, 4).normalize();
    expect(v.length()).toBeCloseTo(1, 10);
    expect(v.x).toBeCloseTo(0.6, 10);
    expect(v.y).toBeCloseTo(0.8, 10);
  });

  it('normalize leaves zero vector untouched', () => {
    const v = new Vector(0, 0).normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('binormalize yields perpendicular (y, -x)', () => {
    const v = new Vector(1, 0).binormalize();
    expect(v).toMatchObject({ x: 0, y: -1 });
    // перпендикуляр: dot с исходным = 0
    expect(new Vector(2, 5).dot(Vector.binormalize(new Vector(2, 5)))).toBe(0);
  });

  it('rotate by PI/2 follows engine sign convention', () => {
    const v = Vector.rotate(new Vector(1, 0), Math.PI / 2);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo(-1, 10);
  });

  it('rotate preserves length', () => {
    const v = Vector.rotate(new Vector(3, 4), 1.234);
    expect(v.length()).toBeCloseTo(5, 10);
  });

  it('angle uses atan2(-y, x)', () => {
    expect(new Vector(1, 0).angle()).toBeCloseTo(0, 10);
    expect(new Vector(0, 1).angle()).toBeCloseTo(-Math.PI / 2, 10);
    expect(new Vector(0, -1).angle()).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('Vector interpolate', () => {
  it('midpoint at koef 0.5', () => {
    const r = Vector.interpolate(new Vector(0, 0), new Vector(10, 20), 0.5);
    expect(r).toMatchObject({ x: 5, y: 10 });
  });

  it('endpoints at koef 0 and 1', () => {
    const from = new Vector(2, 3);
    const to = new Vector(8, 9);
    expect(Vector.interpolate(from, to, 0)).toMatchObject({ x: 2, y: 3 });
    expect(Vector.interpolate(from, to, 1)).toMatchObject({ x: 8, y: 9 });
  });
});
