import { describe, it, expect } from 'vitest';

import { WEAPON } from '../src/instagib/server/game/global.js';
import { Weapon } from '../src/instagib/server/objects/weapon.js';

function makeWeapon() {
  return new Weapon({});
}

describe('Weapon defaults', () => {
  it('starts as pistol with one pistol round', () => {
    const w = makeWeapon();
    expect(w.type).toBe(WEAPON.PISTOL);
    expect(w.patrons).toEqual([1, 0, 0, 0, 0, 0]);
  });
});

describe('Weapon.select', () => {
  it('always allows the pistol', () => {
    const w = makeWeapon();
    w.set(WEAPON.RAIL);
    w.select(WEAPON.PISTOL);
    expect(w.type).toBe(WEAPON.PISTOL);
  });

  it('refuses weapons without ammo', () => {
    const w = makeWeapon();
    w.select(WEAPON.RAIL);
    expect(w.type).toBe(WEAPON.PISTOL);
  });

  it('switches to a weapon that has ammo', () => {
    const w = makeWeapon();
    w.patrons[WEAPON.RAIL] = 5;
    w.select(WEAPON.RAIL);
    expect(w.type).toBe(WEAPON.RAIL);
  });

  it('ignores out-of-range ids', () => {
    const w = makeWeapon();
    w.select(-1);
    w.select(WEAPON.ROCKET + 1);
    expect(w.type).toBe(WEAPON.PISTOL);
  });
});

describe('Weapon.next / prev', () => {
  it('next picks the closest higher weapon with ammo', () => {
    const w = makeWeapon();
    w.patrons[WEAPON.PLASMA] = 10;
    w.next();
    expect(w.type).toBe(WEAPON.PLASMA);
  });

  it('next stays put when nothing higher has ammo', () => {
    const w = makeWeapon();
    w.next();
    expect(w.type).toBe(WEAPON.PISTOL);
  });

  it('prev picks the closest lower weapon with ammo', () => {
    const w = makeWeapon();
    w.patrons[WEAPON.SHAFT] = 100;
    w.set(WEAPON.ROCKET);
    w.prev();
    expect(w.type).toBe(WEAPON.SHAFT);
  });

  it('prev falls back toward the pistol', () => {
    const w = makeWeapon();
    w.set(WEAPON.RAIL);
    w.prev();
    expect(w.type).toBe(WEAPON.PISTOL);
  });
});
