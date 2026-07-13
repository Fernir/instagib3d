import { Event } from '@/core/event.js';
import { normalizeAngle } from '@/core/utility.js';
import { Vector } from '@/core/vector.js';
import { MeshBuilder } from '@/engine/mesh.js';
import { Shader } from '@/engine/shader.js';
import { Weapon } from '@/sim/weapon.js';
import { Dynent } from '@/sim/dynent.js';
import { Level } from '@/sim/level.js';
import { WEAPON } from '@/global.js';
import { describe, expect, it } from 'vitest';

describe('core', () => {
  it('экспортирует базовые типы', () => {
    expect(typeof Vector).toBe('function');
    expect(typeof Event.emit).toBe('function');
    expect(typeof normalizeAngle).toBe('function');
  });
});

describe('engine', () => {
  it('экспортирует WebGL-примитивы', () => {
    expect(typeof Shader).toBe('function');
    expect(typeof MeshBuilder).toBe('function');
  });
});

describe('sim / app', () => {
  it('экспортирует игровые типы', () => {
    expect(typeof Weapon).toBe('function');
    expect(typeof Dynent).toBe('function');
    expect(typeof Level).toBe('function');
    expect(typeof WEAPON).toBe('object');
  });
});
