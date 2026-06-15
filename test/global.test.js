import { describe, it, expect } from 'vitest';

import { WEAPON, ITEM, EVENT } from '../src/instagib/server/game/global.js';

describe('WEAPON table', () => {
  it('weapon ids are sequential 0..5', () => {
    expect(WEAPON.PISTOL).toBe(0);
    expect(WEAPON.SHAFT).toBe(1);
    expect(WEAPON.RAIL).toBe(2);
    expect(WEAPON.PLASMA).toBe(3);
    expect(WEAPON.ZENIT).toBe(4);
    expect(WEAPON.ROCKET).toBe(5);
  });

  it('has a stats row for every weapon id with a name', () => {
    for (let id = WEAPON.PISTOL; id <= WEAPON.ROCKET; id++) {
      const row = WEAPON.wea_tabl[id];
      expect(row).toBeDefined();
      expect(typeof row.name).toBe('string');
      expect(row.damage).toBeGreaterThan(0);
      expect(row.period).toBeGreaterThan(0);
    }
  });

  it('derives FRAME_DELTA_TIME from config (50ms)', () => {
    expect(WEAPON.FRAME_DELTA_TIME).toBe(50);
  });

  it('rocket splash radius is positive', () => {
    expect(WEAPON.RADIUS_ROCKET).toBeGreaterThan(0);
  });
});

describe('ITEM table', () => {
  it('names array covers all item names', () => {
    expect(ITEM.name).toHaveLength(11);
    expect(ITEM.name[ITEM.LIFE]).toBe('Life');
    expect(ITEM.name[ITEM.QUAD]).toBe('Quad');
    expect(ITEM.name[ITEM.SPEED]).toBe('Speed');
  });
});

describe('EVENT codes', () => {
  it('are unique', () => {
    const values = Object.values(EVENT);
    expect(new Set(values).size).toBe(values.length);
  });
});
