import {
  buildWallSegments,
  mergeWallSegments,
  splitLongWallSegments,
} from '@client/wallcontours.js';
import { describe, it, expect } from 'vitest';


// Мини-поле плотности: индексирует клетки через floor (как реальный буфер),
// getData -> 1 для стен, 0 для пола. floor важен для пробы нормали в дробной точке.
function field(cells, isWall) {
  return {
    getSize: () => cells,
    getData: (x, y) => (isWall(Math.floor(x), Math.floor(y)) ? 1 : 0),
  };
}

function endpointCounts(segments) {
  const counts = new Map();
  const k = (p) => p[0].toFixed(4) + ',' + p[1].toFixed(4);
  for (const s of segments) {
    counts.set(k(s.p0), (counts.get(k(s.p0)) || 0) + 1);
    counts.set(k(s.p1), (counts.get(k(s.p1)) || 0) + 1);
  }
  return counts;
}

describe('buildWallSegments (marching squares)', () => {
  it('пустое поле -> нет сегментов', () => {
    const g = field(6, () => false);
    expect(buildWallSegments(g, 6, 1).length).toBe(0);
  });

  it('полностью стена -> нет граничных сегментов', () => {
    const g = field(6, () => true);
    expect(buildWallSegments(g, 6, 1).length).toBe(0);
  });

  it('блок стен даёт замкнутый контур (каждый узел используется дважды)', () => {
    // Угловые узлы 2..3 по обеим осям — стена.
    const g = field(6, (x, y) => x >= 2 && x <= 3 && y >= 2 && y <= 3);
    const segs = buildWallSegments(g, 6, 1);
    expect(segs.length).toBeGreaterThan(0);
    for (const [, n] of endpointCounts(segs)) expect(n).toBe(2);
  });

  it('нормали направлены наружу от стены', () => {
    const g = field(6, (x, y) => x >= 2 && x <= 3 && y >= 2 && y <= 3);
    const segs = buildWallSegments(g, 6, 1);
    const cx = 2.5; // центр блока в мир-координатах (середина 1.5..3.5)
    const cz = 2.5;
    for (const s of segs) {
      const mx = (s.p0[0] + s.p1[0]) * 0.5;
      const mz = (s.p0[1] + s.p1[1]) * 0.5;
      const outward = (mx - cx) * s.nx + (mz - cz) * s.nz;
      expect(outward).toBeGreaterThan(0);
    }
  });
});

describe('mergeWallSegments', () => {
  it('блок даёт октагон: 4 прямые стороны + 4 скошенных угла, контур замкнут', () => {
    const g = field(6, (x, y) => x >= 2 && x <= 3 && y >= 2 && y <= 3);
    const merged = mergeWallSegments(buildWallSegments(g, 6, 1));
    expect(merged.length).toBe(8);
    for (const [, n] of endpointCounts(merged)) expect(n).toBe(2);
    // 4 стороны по 1.0 + 4 угла по sqrt(0.5).
    const perimeter = merged.reduce((sum, s) => sum + s.len, 0);
    expect(perimeter).toBeCloseTo(4 + 4 * Math.SQRT1_2, 4);
  });
});

describe('splitLongWallSegments', () => {
  it('режет длинный сегмент на куски не длиннее лимита, сохраняя суммарную длину', () => {
    const seg = { p0: [0, 0], p1: [5, 0], nx: 0, nz: -1, len: 5 };
    const out = splitLongWallSegments([seg], 2);
    expect(out.length).toBe(3); // 2 + 2 + 1
    for (const s of out) expect(s.len).toBeLessThanOrEqual(2 + 1e-9);
    const total = out.reduce((sum, s) => sum + s.len, 0);
    expect(total).toBeCloseTo(5, 6);
  });

  it('короткие сегменты не трогает', () => {
    const seg = { p0: [0, 0], p1: [1, 0], nx: 0, nz: -1, len: 1 };
    const out = splitLongWallSegments([seg], 2);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(seg);
  });
});
