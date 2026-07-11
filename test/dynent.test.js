import { Vector } from '@/core/vector.js';

import { Dynent, cameraCulling } from '@/sim/dynent.js';

import { describe, it, expect } from 'vitest';


describe('Конструктор Dynent', () => {
  it('размер по умолчанию (1,1) и угол 0', () => {
    const d = new Dynent(new Vector(2, 3));
    expect(d.pos).toMatchObject({ x: 2, y: 3 });
    expect(d.size).toMatchObject({ x: 1, y: 1 });
    expect(d.angle).toBe(0);
    expect(d.vel).toMatchObject({ x: 0, y: 0 });
  });

  it('принимает явные размер и угол', () => {
    const d = new Dynent(new Vector(0, 0), new Vector(2, 4), 1.5);
    expect(d.size).toMatchObject({ x: 2, y: 4 });
    expect(d.angle).toBe(1.5);
  });
});

describe('Dynent.update', () => {
  it('интегрирует скорость за dt', () => {
    const d = new Dynent(new Vector(0, 0));
    d.vel.set(2, -1);
    d.update(10);
    expect(d.pos).toMatchObject({ x: 20, y: -10 });
  });

  it('не двигается при нулевой скорости', () => {
    const d = new Dynent(new Vector(5, 5));
    d.update(100);
    expect(d.pos).toMatchObject({ x: 5, y: 5 });
  });
});

describe('Dynent.collide', () => {
  it('возвращает вектор разделения при пересечении радиусов', () => {
    const a = new Dynent(new Vector(0, 0), new Vector(2, 2));
    const b = new Dynent(new Vector(1, 0), new Vector(2, 2));
    const r = a.collide(b, 2);
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ x: 1, y: 0 });
  });

  it('возвращает null, если объекты слишком далеко', () => {
    const a = new Dynent(new Vector(0, 0), new Vector(1, 1));
    const b = new Dynent(new Vector(10, 0), new Vector(1, 1));
    expect(a.collide(b, 1)).toBeNull();
  });
});

describe('Dynent.interpolate', () => {
  it('интерполирует позицию', () => {
    const from = new Dynent(new Vector(0, 0), new Vector(1, 1), 0);
    const to = new Dynent(new Vector(10, 0), new Vector(1, 1), 0);
    const d = new Dynent(new Vector(0, 0));
    d.interpolate(from, to, 0.5);
    expect(d.pos.x).toBeCloseTo(5, 10);
  });

  it('интерполирует угол кратчайшим путём через ±PI', () => {
    const from = new Dynent(new Vector(0, 0), new Vector(1, 1), Math.PI - 0.1);
    const to = new Dynent(new Vector(0, 0), new Vector(1, 1), -Math.PI + 0.1);
    const d = new Dynent(new Vector(0, 0));
    d.interpolate(from, to, 0.5);
    expect(Math.abs(d.angle)).toBeGreaterThan(Math.PI - 0.2);
  });
});

describe('cameraCulling — отсечение камерой', () => {
  const camera = { pos: new Vector(0, 0), angle: 0 };

  it('отсекает объекты далеко сбоку', () => {
    expect(cameraCulling(camera, new Vector(100, 0), new Vector(1, 1))).toBe(true);
  });

  it('оставляет объекты впереди в зоне видимости', () => {
    expect(cameraCulling(camera, new Vector(0, -5), new Vector(1, 1))).toBe(false);
  });

  it('отсекает объекты позади камеры', () => {
    expect(cameraCulling(camera, new Vector(0, 50), new Vector(1, 1))).toBe(true);
  });
});
