import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { Buffer } from '../src/instagib/server/libs/buffer.js';

// Buffer щедро логирует тайминги через Console.info/debug — глушим, чтобы не
// засорять вывод тестов.
let logSpy, infoSpy;
beforeAll(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  logSpy.mockRestore();
  infoSpy.mockRestore();
});

describe('Buffer basics', () => {
  it('reports its size and starts zeroed', () => {
    const b = new Buffer(4);
    expect(b.getSize()).toBe(4);
    for (let i = 0; i < 16; i++) expect(b.getData(i)).toBe(0);
  });

  it('setData/getData round-trip by flat index and by (x,y)', () => {
    const b = new Buffer(4);
    b.setData(2 + 1 * 4, 0.5); // (x=2, y=1)
    expect(b.getData(2, 1)).toBe(0.5);
    expect(b.getData(6)).toBe(0.5);
  });
});

describe('Buffer.bresenham', () => {
  it('rasterizes a horizontal line', () => {
    const b = new Buffer(8);
    b.bresenham(1, 3, 6, 3, 1);
    for (let x = 1; x <= 6; x++) expect(b.getData(x, 3)).toBe(1);
    expect(b.getData(0, 3)).toBe(0);
    expect(b.getData(7, 3)).toBe(0);
  });

  it('ignores points outside the grid without throwing', () => {
    const b = new Buffer(4);
    expect(() => b.bresenham(-5, -5, 10, 10, 1)).not.toThrow();
    // диагональ всё же закрашивает попавшие в сетку точки
    expect(b.getData(0, 0)).toBe(1);
  });
});

describe('Buffer.normalize', () => {
  it('maps min..max onto the requested range', () => {
    const b = new Buffer(2);
    b.setData(0, 2);
    b.setData(1, 4);
    b.setData(2, 6);
    b.setData(3, 8);
    b.normalize(0, 1);
    expect(b.getData(0)).toBeCloseTo(0, 6); // было min
    expect(b.getData(3)).toBeCloseTo(1, 6); // было max
    expect(b.getData(1)).toBeCloseTo(1 / 3, 6);
  });
});

describe('Buffer.clamp', () => {
  it('limits values to [a, b]', () => {
    const b = new Buffer(2);
    b.setData(0, -5);
    b.setData(1, 0.3);
    b.setData(2, 5);
    b.setData(3, 0.7);
    b.clamp(0, 1);
    expect(b.getData(0)).toBe(0);
    expect(b.getData(2)).toBe(1);
    expect(b.getData(1)).toBeCloseTo(0.3, 6);
    expect(b.getData(3)).toBeCloseTo(0.7, 6);
  });
});

describe('Buffer.for_each', () => {
  it('applies a function over every cell with coords', () => {
    const b = new Buffer(3);
    b.for_each((val, i, j) => i + j * 3);
    expect(b.getData(0, 0)).toBe(0);
    expect(b.getData(2, 2)).toBe(8);
    expect(b.getData(1, 0)).toBe(1);
  });
});
