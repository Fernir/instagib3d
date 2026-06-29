import { describe, expect, it } from 'vitest';

import { WEAPON } from '../src/instagib/server/game/global.js';
import {
  bridgeDominantInwardLocal,
  bridgeLavaEdgeInward,
  bridgeLocalPos,
} from '../src/instagib/server/level/level.js';
import { Vector } from '../src/instagib/server/libs/vector.js';
import { bulletKnockbackDir, eventKnockbackMag } from '../src/instagib/server/objects/event.js';

describe('bulletKnockbackDir', () => {
  it('prefers bullet velocity over other hints', () => {
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

  it('falls back to norm_dir when vel is zero', () => {
    const dir = bulletKnockbackDir({ vel: new Vector(0, 0), norm_dir: new Vector(0, 5) }, null);
    expect(dir.y).toBeCloseTo(1, 5);
  });

  it('returns null when no direction can be inferred', () => {
    expect(bulletKnockbackDir(null, null)).toBeNull();
    expect(bulletKnockbackDir({}, null)).toBeNull();
  });
});

describe('eventKnockbackMag', () => {
  const botPos = new Vector(5, 5);

  it('scales rocket pain knockback by distance', () => {
    const near = { type: WEAPON.ROCKET, pos: new Vector(5, 5) };
    const far = { type: WEAPON.ROCKET, pos: new Vector(50, 5) };
    expect(eventKnockbackMag(near, botPos, 'pain')).toBeGreaterThan(
      eventKnockbackMag(far, botPos, 'pain'),
    );
  });
});

describe('bridgeLocalPos', () => {
  it('transforms world offset into bridge-local coordinates', () => {
    const bridge = { pos: new Vector(10, 10), angle: Math.PI / 2, size: { x: 4, y: 2 } };
    const local = bridgeLocalPos(new Vector(10, 12), bridge);
    expect(local.x).toBeCloseTo(-2, 5);
    expect(local.y).toBeCloseTo(0, 5);
  });
});

describe('bridgeLavaEdgeInward', () => {
  it('blocks exit when lava is detected beyond the edge', () => {
    const bridge = { pos: new Vector(0, 0), angle: 0, size: { x: 4, y: 2 } };
    const inward = bridgeLavaEdgeInward(new Vector(1.9, 0), bridge, (pos) => (pos.x > 2.2 ? 200 : 0));
    expect(inward.x).toBeCloseTo(-1, 5);
  });

  it('returns null when probe tile is not lava', () => {
    const bridge = { pos: new Vector(0, 0), angle: 0, size: { x: 4, y: 2 } };
    expect(bridgeLavaEdgeInward(new Vector(1.9, 0), bridge, () => 0)).toBeNull();
  });
});

describe('bridgeDominantInwardLocal', () => {
  it('returns null when away from all edges', () => {
    expect(bridgeDominantInwardLocal(new Vector(0, 0), 2, 1)).toBeNull();
  });
});
