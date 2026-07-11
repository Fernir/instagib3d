import { WEAPON, ITEM, EVENT } from '@/global.js';

import { describe, it, expect } from 'vitest';


describe('Таблица WEAPON', () => {
  it('id оружия идут подряд 0..5', () => {
    expect(WEAPON.PISTOL).toBe(0);
    expect(WEAPON.SHAFT).toBe(1);
    expect(WEAPON.RAIL).toBe(2);
    expect(WEAPON.PLASMA).toBe(3);
    expect(WEAPON.ZENIT).toBe(4);
    expect(WEAPON.ROCKET).toBe(5);
  });

  it('для каждого id есть строка статистики с именем', () => {
    for (let id = WEAPON.PISTOL; id <= WEAPON.ROCKET; id++) {
      const row = WEAPON.wea_tabl[id];
      expect(row).toBeDefined();
      expect(typeof row.name).toBe('string');
      expect(row.damage).toBeGreaterThan(0);
      expect(row.period).toBeGreaterThan(0);
    }
  });

  it('FRAME_DELTA_TIME берётся из конфига (50 мс)', () => {
    expect(WEAPON.FRAME_DELTA_TIME).toBe(50);
  });

  it('радиус взрыва ракеты положительный', () => {
    expect(WEAPON.RADIUS_ROCKET).toBeGreaterThan(0);
  });

  it('у каждого оружия задано количество патронов при подборе', () => {
    for (let id = WEAPON.PISTOL; id <= WEAPON.ROCKET; id++) {
      expect(WEAPON.wea_tabl[id].patrons).toBeGreaterThan(0);
    }
  });
});

describe('Таблица ITEM', () => {
  it('массив имён покрывает все предметы', () => {
    expect(ITEM.name).toHaveLength(11);
    expect(ITEM.name[ITEM.LIFE]).toBe('Life');
    expect(ITEM.name[ITEM.QUAD]).toBe('Quad');
    expect(ITEM.name[ITEM.SPEED]).toBe('Speed');
    expect(ITEM.name[ITEM.SHIELD]).toBe('Shield');
  });

  it('id усилений идут после оружия', () => {
    expect(ITEM.LIFE).toBeGreaterThan(WEAPON.ROCKET);
    expect(ITEM.SHIELD).toBeGreaterThan(WEAPON.ROCKET);
    expect(ITEM.QUAD).toBeGreaterThan(WEAPON.ROCKET);
  });
});

describe('Коды EVENT', () => {
  it('уникальны', () => {
    const values = Object.values(EVENT);
    expect(new Set(values).size).toBe(values.length);
  });

  it('содержат основные игровые события', () => {
    expect(EVENT.BOT_RESPAWN).toBeDefined();
    expect(EVENT.BOT_DEAD).toBeDefined();
    expect(EVENT.PAIN).toBeDefined();
    expect(EVENT.BULLET_RESPAWN).toBeDefined();
    expect(EVENT.LINE_SHOOT).toBeDefined();
  });
});
