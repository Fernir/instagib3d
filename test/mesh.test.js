import { state } from '@core/runtime-state.js';
import { buildWireLineBuffer, isWireframe } from '@engine/mesh.js';
import { describe, it, expect } from 'vitest';


describe('buildWireLineBuffer — буфер рёбер wireframe', () => {
  it('строит линии из одного треугольника (3 рёбра)', () => {
    const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const wire = buildWireLineBuffer(verts, 3);
    expect(wire.count).toBe(6); // 3 ребра × 2 вершины
    expect(wire.data.length).toBe(18);
  });

  it('дедуплицирует общие рёбра соседних треугольников', () => {
    const verts = [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0,
    ];
    const wire = buildWireLineBuffer(verts, 3);
    // 2 треугольника = 6 рёбер, но 1 общее → 5 уникальных = 10 вершин линий
    expect(wire.count).toBe(10);
  });

  it('склеивает рёбра с одинаковыми координатами, но разными индексами', () => {
    const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
    const wire = buildWireLineBuffer(verts, 3);
    expect(wire.count).toBeLessThan(12);
  });

  it('возвращает пустой буфер для пустого меша', () => {
    const wire = buildWireLineBuffer([], 3);
    expect(wire.count).toBe(0);
  });
});

describe('isWireframe — флаг wireframe-режима', () => {
  it('false, если wireframe выключен', () => {
    state.wireframe = false;
    state.wireframePass = false;
    expect(isWireframe()).toBe(false);
  });

  it('false, если wireframe включён, но не в 3D-проходе', () => {
    state.wireframe = true;
    state.wireframePass = false;
    expect(isWireframe()).toBe(false);
  });

  it('true только когда wireframe и wireframePass активны', () => {
    state.wireframe = true;
    state.wireframePass = true;
    expect(isWireframe()).toBe(true);
    state.wireframePass = false;
  });
});
