import { Vector } from '@core/vector.js';
import { describe, it, expect } from 'vitest';


describe('Конструктор Vector', () => {
  it('создаётся из двух чисел', () => {
    const v = new Vector(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('создаётся из массива', () => {
    const v = new Vector([5, 6]);
    expect(v.x).toBe(5);
    expect(v.y).toBe(6);
  });

  it('копирует другой Vector независимо', () => {
    const src = new Vector(7, 8);
    const v = new Vector(src);
    expect(v.x).toBe(7);
    expect(v.y).toBe(8);
    src.x = 99;
    expect(v.x).toBe(7);
  });

  it('toVec возвращает обычный массив', () => {
    expect(new Vector(1, 2).toVec()).toEqual([1, 2]);
  });
});

describe('Мутирующие операции Vector возвращают this', () => {
  it('set/copy/add/sub/mul выстраиваются в цепочку', () => {
    const v = new Vector(0, 0);
    expect(v.set(1, 1)).toBe(v);
    expect(v.add(new Vector(2, 3))).toBe(v);
    expect(v).toMatchObject({ x: 3, y: 4 });
    v.sub(new Vector(1, 1));
    expect(v).toMatchObject({ x: 2, y: 3 });
    v.mul(2);
    expect(v).toMatchObject({ x: 4, y: 6 });
  });

  it('add2/sub2/mul2 работают покомponentно', () => {
    const v = new Vector(1, 1);
    v.add2(2, 3).sub2(1, 1).mul2(2, 4);
    expect(v).toMatchObject({ x: 4, y: 12 });
  });
});

describe('Статические операции Vector не мутируют аргументы', () => {
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

describe('Геометрия Vector', () => {
  it('скалярное произведение', () => {
    expect(new Vector(1, 2).dot(new Vector(3, 4))).toBe(11);
  });

  it('length и length2', () => {
    const v = new Vector(3, 4);
    expect(v.length2()).toBe(25);
    expect(v.length()).toBe(5);
  });

  it('normalize даёт единичную длину', () => {
    const v = new Vector(3, 4).normalize();
    expect(v.length()).toBeCloseTo(1, 10);
    expect(v.x).toBeCloseTo(0.6, 10);
    expect(v.y).toBeCloseTo(0.8, 10);
  });

  it('normalize не трогает нулевой вектор', () => {
    const v = new Vector(0, 0).normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('binormalize даёт перпендикуляр (y, -x)', () => {
    const v = new Vector(1, 0).binormalize();
    expect(v).toMatchObject({ x: 0, y: -1 });
    expect(new Vector(2, 5).dot(Vector.binormalize(new Vector(2, 5)))).toBe(0);
  });

  it('rotate на PI/2 следует знаковой конвенции движка', () => {
    const v = Vector.rotate(new Vector(1, 0), Math.PI / 2);
    expect(v.x).toBeCloseTo(0, 10);
    expect(v.y).toBeCloseTo(-1, 10);
  });

  it('rotate сохраняет длину', () => {
    const v = Vector.rotate(new Vector(3, 4), 1.234);
    expect(v.length()).toBeCloseTo(5, 10);
  });

  it('angle использует atan2(-y, x)', () => {
    expect(new Vector(1, 0).angle()).toBeCloseTo(0, 10);
    expect(new Vector(0, 1).angle()).toBeCloseTo(-Math.PI / 2, 10);
    expect(new Vector(0, -1).angle()).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('Интерполяция Vector', () => {
  it('середина при koef 0.5', () => {
    const r = Vector.interpolate(new Vector(0, 0), new Vector(10, 20), 0.5);
    expect(r).toMatchObject({ x: 5, y: 10 });
  });

  it('концы при koef 0 и 1', () => {
    const from = new Vector(2, 3);
    const to = new Vector(8, 9);
    expect(Vector.interpolate(from, to, 0)).toMatchObject({ x: 2, y: 3 });
    expect(Vector.interpolate(from, to, 1)).toMatchObject({ x: 8, y: 9 });
  });
});
