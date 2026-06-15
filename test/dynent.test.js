import { describe, it, expect } from 'vitest';

import { Vector } from '../src/instagib/server/libs/vector.js';
import { Dynent, cameraCulling } from '../src/instagib/server/objects/dynent.js';

describe('Dynent construction', () => {
  it('defaults size to (1,1) and angle to 0', () => {
    const d = new Dynent(new Vector(2, 3));
    expect(d.pos).toMatchObject({ x: 2, y: 3 });
    expect(d.size).toMatchObject({ x: 1, y: 1 });
    expect(d.angle).toBe(0);
    expect(d.vel).toMatchObject({ x: 0, y: 0 });
  });

  it('accepts explicit size and angle', () => {
    const d = new Dynent(new Vector(0, 0), new Vector(2, 4), 1.5);
    expect(d.size).toMatchObject({ x: 2, y: 4 });
    expect(d.angle).toBe(1.5);
  });
});

describe('Dynent.update', () => {
  it('integrates velocity over dt', () => {
    const d = new Dynent(new Vector(0, 0));
    d.vel.set(2, -1);
    d.update(10);
    expect(d.pos).toMatchObject({ x: 20, y: -10 });
  });

  it('does not move when velocity is zero', () => {
    const d = new Dynent(new Vector(5, 5));
    d.update(100);
    expect(d.pos).toMatchObject({ x: 5, y: 5 });
  });
});

describe('Dynent.collide', () => {
  it('returns separation vector when within combined radius', () => {
    const a = new Dynent(new Vector(0, 0), new Vector(2, 2));
    const b = new Dynent(new Vector(1, 0), new Vector(2, 2));
    const r = a.collide(b, 2);
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ x: 1, y: 0 });
  });

  it('returns null when too far apart', () => {
    const a = new Dynent(new Vector(0, 0), new Vector(1, 1));
    const b = new Dynent(new Vector(10, 0), new Vector(1, 1));
    expect(a.collide(b, 1)).toBeNull();
  });
});

describe('Dynent.interpolate', () => {
  it('lerps position', () => {
    const from = new Dynent(new Vector(0, 0), new Vector(1, 1), 0);
    const to = new Dynent(new Vector(10, 0), new Vector(1, 1), 0);
    const d = new Dynent(new Vector(0, 0));
    d.interpolate(from, to, 0.5);
    expect(d.pos.x).toBeCloseTo(5, 10);
  });

  it('takes the short way around the angle wrap', () => {
    // from почти +PI, to почти -PI: разница должна идти коротким путём
    const from = new Dynent(new Vector(0, 0), new Vector(1, 1), Math.PI - 0.1);
    const to = new Dynent(new Vector(0, 0), new Vector(1, 1), -Math.PI + 0.1);
    const d = new Dynent(new Vector(0, 0));
    d.interpolate(from, to, 0.5);
    // короткий путь проходит через PI (≈ ±PI), а не через 0
    expect(Math.abs(d.angle)).toBeGreaterThan(Math.PI - 0.2);
  });
});

describe('cameraCulling', () => {
  const camera = { pos: new Vector(0, 0), angle: 0 };

  it('culls objects far to the side', () => {
    expect(cameraCulling(camera, new Vector(100, 0), new Vector(1, 1))).toBe(true);
  });

  it('keeps objects in front within view box', () => {
    // rotate() инвертирует y: точка перед камерой имеет pos.y < 0 → vec.y > 0
    expect(cameraCulling(camera, new Vector(0, -5), new Vector(1, 1))).toBe(false);
  });

  it('culls objects behind the camera', () => {
    expect(cameraCulling(camera, new Vector(0, 50), new Vector(1, 1))).toBe(true);
  });
});
