import { Vector } from '@core/vector.js';
import { Item } from '@entity/item.js';
import { WEAPON, ITEM } from '@game/global.js';
import { describe, it, expect } from 'vitest';


const game = { bots: [], droped: [] };
const pos = new Vector(1, 1);

describe('Создание предмета Item', () => {
  it('берёт количество патронов из таблицы оружия', () => {
    const item = new Item(game, pos, WEAPON.RAIL);
    expect(item.type).toBe(WEAPON.RAIL);
    expect(item.val).toBe(WEAPON.wea_tabl[WEAPON.RAIL].patrons);
    expect(item.alive).toBe(true);
  });

  it('даёт не-оружейным пикапам нулевое значение по умолчанию', () => {
    const item = new Item(game, pos, ITEM.QUAD);
    expect(item.val).toBe(0);
  });

  it('принимает явное переопределение значения', () => {
    const item = new Item(game, pos, WEAPON.PLASMA, 17);
    expect(item.val).toBe(17);
  });

  it('размещает dynent в заданной позиции', () => {
    const item = new Item(game, pos, ITEM.LIFE);
    expect(item.dynent.pos).toMatchObject({ x: 1, y: 1 });
  });

  it('выбирает случайный допустимый тип, если тип не задан', () => {
    for (let i = 0; i < 30; i++) {
      const item = new Item(game, pos);
      expect(item.type).toBeGreaterThanOrEqual(1);
      expect(item.type).toBeLessThanOrEqual(ITEM.COUNT);
    }
  });
});

describe('Типы предметов Item', () => {
  it('оружие имеет type <= WEAPON.ROCKET', () => {
    const item = new Item(game, pos, WEAPON.ROCKET);
    expect(item.type).toBeLessThanOrEqual(WEAPON.ROCKET);
  });

  it('усиления имеют type > WEAPON.ROCKET', () => {
    expect(new Item(game, pos, ITEM.LIFE).type).toBeGreaterThan(WEAPON.ROCKET);
    expect(new Item(game, pos, ITEM.SHIELD).type).toBeGreaterThan(WEAPON.ROCKET);
    expect(new Item(game, pos, ITEM.QUAD).type).toBeGreaterThan(WEAPON.ROCKET);
  });
});
