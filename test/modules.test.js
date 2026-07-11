
import { Buffer, Event, Random, Vector, createGlobalMat4, normalizeAngle, state } from '@core/index.js';
import { MeshBuilder, Shader, buildWireLineBuffer, isWireframe } from '@engine/index.js';
import { describe, expect, it } from 'vitest';

describe('core — публичный API', () => {
  it('экспортирует базовые типы и утилиты', () => {
    expect(typeof Vector).toBe('function');
    expect(typeof Event.emit).toBe('function');
    expect(typeof Buffer).toBe('function');
    expect(typeof Random).toBe('function');
    expect(typeof normalizeAngle).toBe('function');
    expect(typeof createGlobalMat4).toBe('function');
  });
});

describe('engine — публичный API', () => {
  it('экспортирует WebGL-примитивы', () => {
    expect(typeof Shader).toBe('function');
    expect(typeof MeshBuilder).toBe('function');
    expect(typeof buildWireLineBuffer).toBe('function');
    expect(typeof isWireframe).toBe('function');
  });

  it('isWireframe читает state из core', () => {
    state.wireframe = true;
    state.wireframePass = true;
    expect(isWireframe()).toBe(true);
    state.wireframePass = false;
  });
});
