import { describe, it, expect } from 'vitest';

import { WEAPON, ITEM } from '../src/instagib/server/game/global.js';
import { Vector } from '../src/instagib/server/libs/vector.js';
import { Item } from '../src/instagib/server/objects/item.js';

const game = { bots: [], droped: [] };
const pos = new Vector(1, 1);

describe('Item construction', () => {
  it('derives ammo value from the weapon table for weapon pickups', () => {
    const item = new Item(game, pos, WEAPON.RAIL);
    expect(item.type).toBe(WEAPON.RAIL);
    expect(item.val).toBe(WEAPON.wea_tabl[WEAPON.RAIL].patrons);
    expect(item.alive).toBe(true);
  });

  it('gives non-weapon pickups a zero value by default', () => {
    const item = new Item(game, pos, ITEM.QUAD);
    expect(item.val).toBe(0);
  });

  it('respects an explicit value override', () => {
    const item = new Item(game, pos, WEAPON.PLASMA, 17);
    expect(item.val).toBe(17);
  });

  it('places a dynent at the given position', () => {
    const item = new Item(game, pos, ITEM.LIFE);
    expect(item.dynent.pos).toMatchObject({ x: 1, y: 1 });
  });

  it('picks a random valid type when none is given', () => {
    for (let i = 0; i < 30; i++) {
      const item = new Item(game, pos);
      expect(item.type).toBeGreaterThanOrEqual(1);
      expect(item.type).toBeLessThanOrEqual(ITEM.COUNT);
    }
  });
});
