import { Event } from '@/core/event.js';

import { WEAPON } from '@/global.js';

import { Weapon } from '@/sim/weapon.js';

import { describe, it, expect } from 'vitest';


function makeWeapon() {
  return new Weapon({});
}

describe('Weapon — значения по умолчанию', () => {
  it('стартовое оружие — пистолет с одним патроном', () => {
    const w = makeWeapon();
    expect(w.type).toBe(WEAPON.PISTOL);
    expect(w.patrons).toEqual([1, 0, 0, 0, 0, 0]);
  });
});

describe('Weapon.select — прямой выбор', () => {
  it('пистолет доступен всегда', () => {
    const w = makeWeapon();
    w.set(WEAPON.RAIL);
    w.select(WEAPON.PISTOL);
    expect(w.type).toBe(WEAPON.PISTOL);
  });

  it('отказывает в оружии без патронов', () => {
    const w = makeWeapon();
    w.select(WEAPON.RAIL);
    expect(w.type).toBe(WEAPON.PISTOL);
  });

  it('переключается на оружие с патронами', () => {
    const w = makeWeapon();
    w.patrons[WEAPON.RAIL] = 5;
    w.select(WEAPON.RAIL);
    expect(w.type).toBe(WEAPON.RAIL);
  });

  it('игнорирует id вне диапазона', () => {
    const w = makeWeapon();
    w.select(-1);
    w.select(WEAPON.ROCKET + 1);
    expect(w.type).toBe(WEAPON.PISTOL);
  });
});

describe('Weapon.next / prev — циклический выбор', () => {
  it('next выбирает ближайшее более мощное оружие с патронами', () => {
    const w = makeWeapon();
    w.patrons[WEAPON.PLASMA] = 10;
    w.next();
    expect(w.type).toBe(WEAPON.PLASMA);
  });

  it('next не меняет оружие, если выше ничего нет', () => {
    const w = makeWeapon();
    w.next();
    expect(w.type).toBe(WEAPON.PISTOL);
  });

  it('prev выбирает ближайшее менее мощное оружие с патронами', () => {
    const w = makeWeapon();
    w.patrons[WEAPON.SHAFT] = 100;
    w.set(WEAPON.ROCKET);
    w.prev();
    expect(w.type).toBe(WEAPON.SHAFT);
  });

  it('prev откатывается к пистолету', () => {
    const w = makeWeapon();
    w.set(WEAPON.RAIL);
    w.prev();
    expect(w.type).toBe(WEAPON.PISTOL);
  });
});

describe('Event takeweapon — подбор оружия', () => {
  it('добавляет патроны и переключает с пистолета', () => {
    const bot = { weapon: makeWeapon() };
    Event.emit('takeweapon', bot, WEAPON.RAIL, 5);
    expect(bot.weapon.patrons[WEAPON.RAIL]).toBe(5);
    expect(bot.weapon.type).toBe(WEAPON.RAIL);
  });

  it('не переключает, если новое оружие слабее текущего', () => {
    const bot = { weapon: makeWeapon() };
    bot.weapon.set(WEAPON.PLASMA);
    bot.weapon.patrons[WEAPON.PLASMA] = 10;
    Event.emit('takeweapon', bot, WEAPON.RAIL, 3);
    expect(bot.weapon.patrons[WEAPON.RAIL]).toBe(3);
    expect(bot.weapon.type).toBe(WEAPON.PLASMA);
  });

  it('переключает на более мощное при первом подборе', () => {
    const bot = { weapon: makeWeapon() };
    bot.weapon.patrons[WEAPON.PLASMA] = 5;
    bot.weapon.set(WEAPON.PLASMA);
    Event.emit('takeweapon', bot, WEAPON.ROCKET, 10);
    expect(bot.weapon.type).toBe(WEAPON.ROCKET);
  });
});
