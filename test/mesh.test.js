import { MeshBuilder } from '@/engine/mesh.js';

import { describe, it, expect } from 'vitest';

describe('MeshBuilder', () => {
  it('накапливает вершины', () => {
    const b = new MeshBuilder();
    b.vertex(0, 0, 0, 0, 0, 0, 1, 0);
    expect(b.vertices.length).toBe(8);
  });

  it('quad добавляет 6 вершин (2 треугольника)', () => {
    const b = new MeshBuilder();
    b.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 1]);
    expect(b.vertices.length).toBe(48);
  });
});
