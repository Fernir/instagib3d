import { SpawnFx } from '@client/spawnfx.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


let nowSpy;
let clock = 0;

beforeEach(() => {
  clock = 1_000_000;
  nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  nowSpy.mockRestore();
});

describe('SpawnFx.botAppearance — появление бота', () => {
  it('без spawnStartTime возвращает полную видимость', () => {
    expect(SpawnFx.botAppearance(0)).toEqual({ alpha: 1, scale: 1, spawning: false });
    expect(SpawnFx.botAppearance(null)).toEqual({ alpha: 1, scale: 1, spawning: false });
  });

  it('в начале анимации spawning=true и scale=0.78', () => {
    const t0 = clock;
    const ap = SpawnFx.botAppearance(t0);
    expect(ap.spawning).toBe(true);
    expect(ap.alpha).toBe(0);
    expect(ap.scale).toBeCloseTo(0.78, 5);
  });

  it('после BOT_IN_START_MS alpha начинает расти', () => {
    const t0 = clock;
    clock = t0 + 500;
    const ap = SpawnFx.botAppearance(t0);
    expect(ap.spawning).toBe(true);
    expect(ap.alpha).toBeGreaterThan(0);
    expect(ap.scale).toBeGreaterThan(0.78);
  });

  it('после SPAWN_ANIM_MS анимация завершена', () => {
    const t0 = clock;
    clock = t0 + 2300;
    expect(SpawnFx.botAppearance(t0)).toEqual({ alpha: 1, scale: 1, spawning: false });
  });

  it('к концу анимации scale стремится к 1', () => {
    const t0 = clock;
    clock = t0 + 2100;
    const ap = SpawnFx.botAppearance(t0);
    expect(ap.spawning).toBe(true);
    expect(ap.scale).toBeCloseTo(1, 1);
    expect(ap.alpha).toBeCloseTo(1, 1);
  });
});

describe('SpawnFx.start — регистрация эффекта', () => {
  it('не бросает исключение при вызове', () => {
    expect(() => SpawnFx.start(1, 2)).not.toThrow();
  });
});
