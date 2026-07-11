import { bulletKnockbackDir, eventKnockbackMag } from '@combat/event.js';
import { Vector } from '@core/vector.js';
import { WEAPON } from '@game/global.js';
import {
  bridgeDominantInwardLocal,
  bridgeLavaEdgeInward,
  bridgeLocalPos,
} from '@level/level.js';
import { describe, expect, it } from 'vitest';

describe('bulletKnockbackDir — направление отбрасывания', () => {
  it('предпочитает скорость пули другим подсказкам', () => {
    const bullet = {
      vel: new Vector(3, 4),
      norm_dir: new Vector(-1, 0),
      pos: new Vector(0, 0),
    };
    const opponent = { dynent: { pos: new Vector(10, 0) } };
    const dir = bulletKnockbackDir(bullet, opponent);
    expect(dir.x).toBeCloseTo(0.6, 5);
    expect(dir.y).toBeCloseTo(0.8, 5);
  });

  it('использует norm_dir, если vel нулевая', () => {
    const dir = bulletKnockbackDir({ vel: new Vector(0, 0), norm_dir: new Vector(0, 5) }, null);
    expect(dir.y).toBeCloseTo(1, 5);
  });

  it('использует позицию пули и цели, если vel и norm_dir пусты', () => {
    const bullet = { vel: new Vector(0, 0), pos: new Vector(10, 0) };
    const opponent = { dynent: { pos: new Vector(0, 0) } };
    const dir = bulletKnockbackDir(bullet, opponent);
    expect(dir.x).toBeCloseTo(1, 5);
  });

  it('возвращает null, если направление определить нельзя', () => {
    expect(bulletKnockbackDir(null, null)).toBeNull();
    expect(bulletKnockbackDir({}, null)).toBeNull();
  });
});

describe('eventKnockbackMag — сила отбрасывания', () => {
  const botPos = new Vector(5, 5);

  it('масштабирует отбрасывание ракеты по дистанции (pain)', () => {
    const near = { type: WEAPON.ROCKET, pos: new Vector(5, 5) };
    const far = { type: WEAPON.ROCKET, pos: new Vector(50, 5) };
    expect(eventKnockbackMag(near, botPos, 'pain')).toBeGreaterThan(
      eventKnockbackMag(far, botPos, 'pain'),
    );
  });

  it('ракета даёт больший knockback при смерти, чем plasma', () => {
    const rocket = { type: WEAPON.ROCKET, pos: new Vector(5, 5) };
    const plasma = { type: WEAPON.PLASMA, pos: new Vector(5, 5) };
    expect(eventKnockbackMag(rocket, botPos, 'death')).toBeGreaterThan(
      eventKnockbackMag(plasma, botPos, 'death'),
    );
  });

  it('rail даёт меньший knockback при смерти, чем zenit', () => {
    const rail = { type: WEAPON.RAIL, pos: new Vector(5, 5) };
    const zenit = { type: WEAPON.ZENIT, pos: new Vector(5, 5) };
    expect(eventKnockbackMag(zenit, botPos, 'death')).toBeGreaterThan(
      eventKnockbackMag(rail, botPos, 'death'),
    );
  });
});

describe('bridgeLocalPos — локальные координаты моста', () => {
  it('переводит мировое смещение в локальные координаты моста', () => {
    const bridge = { pos: new Vector(10, 10), angle: Math.PI / 2, size: { x: 4, y: 2 } };
    const local = bridgeLocalPos(new Vector(10, 12), bridge);
    expect(local.x).toBeCloseTo(-2, 5);
    expect(local.y).toBeCloseTo(0, 5);
  });
});

describe('bridgeLavaEdgeInward — край моста у лавы', () => {
  it('блокирует выход, если за краем обнаружена лава', () => {
    const bridge = { pos: new Vector(0, 0), angle: 0, size: { x: 4, y: 2 } };
    const inward = bridgeLavaEdgeInward(new Vector(1.9, 0), bridge, (pos) => (pos.x > 2.2 ? 200 : 0));
    expect(inward.x).toBeCloseTo(-1, 5);
  });

  it('возвращает null, если пробная клетка не лава', () => {
    const bridge = { pos: new Vector(0, 0), angle: 0, size: { x: 4, y: 2 } };
    expect(bridgeLavaEdgeInward(new Vector(1.9, 0), bridge, () => 0)).toBeNull();
  });
});

describe('bridgeDominantInwardLocal — доминирующий внутренний край', () => {
  it('возвращает null вдали от всех краёв', () => {
    expect(bridgeDominantInwardLocal(new Vector(0, 0), 2, 1)).toBeNull();
  });

  it('возвращает направление у правого края моста', () => {
    const inward = bridgeDominantInwardLocal(new Vector(1.85, 0), 2, 1);
    expect(inward).not.toBeNull();
    expect(inward.x).toBeLessThan(0);
  });
});
