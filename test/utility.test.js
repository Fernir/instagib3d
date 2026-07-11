import { Random, normalizeAngle } from '@core/utility.js';
import { describe, it, expect } from 'vitest';


describe('Random — детерминированный ГПСЧ', () => {
  it('детерминирован при одинаковом seed', () => {
    const a = new Random(12345);
    const b = new Random(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('даёт разные последовательности для разных seed', () => {
    const a = new Random(1);
    const b = new Random(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('возвращает значения в [0, 1)', () => {
    const r = new Random(42);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('normalizeAngle — нормализация угла', () => {
  it('не меняет углы уже в [0, 2PI)', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 10);
  });

  it('переносит отрицательные углы в [0, 2PI)', () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 10);
  });

  it('переносит углы больше 2PI', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(normalizeAngle(2 * Math.PI + 0.5)).toBeCloseTo(0.5, 10);
  });

  it('всегда возвращает значение в [0, 2PI)', () => {
    for (let a = -50; a <= 50; a += 0.37) {
      const n = normalizeAngle(a);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(2 * Math.PI + 1e-9);
    }
  });
});
