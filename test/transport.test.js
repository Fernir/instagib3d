import { Vector } from '@/core/vector.js';

import { EVENT, ITEM, WEAPON } from '@/global.js';

import { GameEvent } from '@/sim/game-events.js';

import { Dynent } from '@/sim/dynent.js';


import { __testing as transport } from '@/net/transport.js';

import { describe, expect, it } from 'vitest';


function makeView(size = 512) {
  return new DataView(new ArrayBuffer(size));
}

function encodeDecodeEvent(event, size = 512) {
  const view = makeView(size);
  const offset = transport.setEvent(view, 0, event);
  const decoded = new GameEvent(0, [0, 0]);
  const decodedOffset = transport.getEvent(view, 0, decoded);
  expect(decodedOffset).toBe(offset);
  return decoded;
}

function makeBot(overrides = {}) {
  return {
    id: 7,
    alive: true,
    shoot: true,
    shield: true,
    power: ITEM.QUAD,
    health: 80,
    dynent: new Dynent(new Vector(12.25, 33.5), new Vector(1, 1), 1.25),
    weapon: {
      type: WEAPON.PLASMA,
      patrons: [1, 7000, 5, 25, 5, 10],
    },
    stats: {
      currentseria: 3,
      currentantiseria: 0,
      i_am_death: 11,
      i_am_kill: 12,
      i_am_multi: 2,
      i_am_killer: true,
      i_am_looser: false,
      i_am_sniper: true,
      i_am_avenger: false,
      i_am_quickkill: true,
      i_am_quickdeath: false,
      i_am_telefraging: true,
      i_am_telefraged: false,
      frag: -4,
      scores: 1321,
      rank: 5,
    },
    ...overrides,
  };
}

describe('transport — кодек строк', () => {
  it('round-trip для латиницы и кириллицы', () => {
    const view = makeView();
    const text = 'rPlayer42 Привет!?';
    const offset = transport.setString(view, 0, text);
    const decoded = transport.getString(view, 0);
    expect(decoded.offset).toBe(offset);
    expect(decoded.str).toBe(text);
  });

  it('заменяет неподдерживаемые символы на ?', () => {
    const view = makeView();
    transport.setString(view, 0, 'ok🙂');
    expect(transport.getString(view, 0).str).toBe('ok??');
  });

  it('обрезает строки до 255 символов', () => {
    const view = makeView(300);
    transport.setString(view, 0, 'a'.repeat(300));
    expect(transport.getString(view, 0).str).toHaveLength(255);
  });
});

describe('transport — fixed-point', () => {
  it('round-trip с точностью 1/256', () => {
    const value = 12.345;
    expect(transport.toFloat(transport.toFixed(value))).toBeCloseTo(12.34375, 10);
  });

  it('поддерживает пользовательский коэффициент для малых знаковых значений', () => {
    const value = -0.123;
    const fixed = transport.toFixed(value, 50 * 256);
    expect(transport.toFloat(fixed, 50 * 256)).toBeCloseTo(value, 3);
  });
});

describe('transport — кодек предметов', () => {
  it('round-trip типа и квантованной позиции', () => {
    const item = {
      type: ITEM.QUAD,
      dynent: new Dynent(new Vector(3.25, 9.75)),
    };
    const view = makeView();
    const offset = transport.setItem(view, 0, item);
    const decoded = new transport.ServerItem();
    const decodedOffset = transport.getItem(view, 0, decoded);

    expect(decodedOffset).toBe(offset);
    expect(decoded.type).toBe(ITEM.QUAD);
    expect(decoded.x).toBeCloseTo(3.25, 10);
    expect(decoded.y).toBeCloseTo(9.75, 10);
  });
});

describe('transport — кодек ботов', () => {
  it('round-trip состояния обычного бота', () => {
    const bot = makeBot({ power: ITEM.REGEN });
    const view = makeView();
    const offset = transport.setBot(view, 0, bot, false, false);
    const decoded = new transport.ServerBot();
    const decodedOffset = transport.getBot(view, 0, decoded, false);

    expect(decodedOffset).toBe(offset);
    expect(decoded.id).toBe(bot.id);
    expect(decoded.weapon).toBe(WEAPON.PLASMA);
    expect(decoded.power).toBe(ITEM.REGEN);
    expect(decoded.alive).toBe(true);
    expect(decoded.shoot).toBe(true);
    expect(decoded.shield).toBe(true);
    expect(decoded.seria).toBe(3);
    expect(decoded.angle).toBeCloseTo(1.25, 2);
    expect(decoded.x).toBeCloseTo(12.25, 10);
    expect(decoded.y).toBeCloseTo(33.5, 10);
    expect(decoded.health_ratio).toBeCloseTo(80 / 3999, 2);
  });

  it('round-trip полей камеры', () => {
    const bot = makeBot();
    const view = makeView();
    const offset = transport.setBot(view, 0, bot, true, true);
    const decoded = new transport.ServerBot();
    const decodedOffset = transport.getBot(view, 0, decoded, true);

    expect(decodedOffset).toBe(offset);
    expect(decoded.life).toBe(2);
    expect(decoded.controlable).toBe(1);
    expect(decoded.i_am_death).toBe(11);
    expect(decoded.i_am_kill).toBe(12);
    expect(decoded.i_am_multi).toBe(2);
    expect(decoded.i_am_killer).toBe(true);
    expect(decoded.i_am_sniper).toBe(true);
    expect(decoded.i_am_quickkill).toBe(true);
    expect(decoded.i_am_telefraging).toBe(true);
    expect(decoded.frag).toBe(-4);
    expect(decoded.scores).toBe(1321);
    expect(decoded.rank).toBe(5);
  });
});

describe('transport — кодек событий', () => {
  it('round-trip PAIN с направлением и bot id', () => {
    const event = new GameEvent(EVENT.PAIN, [4.5, 8.25], [0.25, -0.125], 42);
    const decoded = encodeDecodeEvent(event);

    expect(decoded.type).toBe(EVENT.PAIN);
    expect(decoded.pos.x).toBeCloseTo(4.5, 10);
    expect(decoded.pos.y).toBeCloseTo(8.25, 10);
    expect(decoded.dir.x).toBeCloseTo(0.25, 3);
    expect(decoded.dir.y).toBeCloseTo(-0.125, 3);
    expect(decoded.botid).toBe(42);
  });

  it('round-trip BULLET_DEAD с 3D-позицией смерти', () => {
    const bullet = {
      id: 321,
      z: 1.375,
      dynent: new Dynent(new Vector(10.5, 12.75)),
    };
    const event = new GameEvent(EVENT.BULLET_DEAD, [0, 0], null, bullet);
    const decoded = encodeDecodeEvent(event);

    expect(decoded.type).toBe(EVENT.BULLET_DEAD);
    expect(decoded.bulletid).toBe(321);
    expect(decoded.pos.x).toBeCloseTo(10.5, 10);
    expect(decoded.pos.y).toBeCloseTo(12.75, 10);
    expect(decoded.z).toBeCloseTo(1.375, 10);
  });

  it('round-trip BOT_RESPAWN с bot id', () => {
    const event = new GameEvent(EVENT.BOT_RESPAWN, [6.5, 9.25], null, 17);
    const decoded = encodeDecodeEvent(event);

    expect(decoded.type).toBe(EVENT.BOT_RESPAWN);
    expect(decoded.pos.x).toBeCloseTo(6.5, 10);
    expect(decoded.pos.y).toBeCloseTo(9.25, 10);
    expect(decoded.botid).toBe(17);
  });

  it('round-trip BULLET_RESPAWN с type, power, pitch и z', () => {
    const bullet = {
      id: 111,
      type: WEAPON.ROCKET,
      pitch: -0.2,
      z: 1.625,
      owner: { power: ITEM.QUAD },
      dynent: new Dynent(new Vector(2, 3), new Vector(1, 1), -0.5),
    };
    const event = new GameEvent(EVENT.BULLET_RESPAWN, [2, 3], null, bullet, true);
    const decoded = encodeDecodeEvent(event);

    expect(decoded.type).toBe(EVENT.BULLET_RESPAWN);
    expect(decoded.bullet_type).toBe(WEAPON.ROCKET);
    expect(decoded.power).toBe(ITEM.QUAD);
    expect(decoded.sound).toBe(0x08);
    expect(decoded.bulletid).toBe(111);
    expect(decoded.angle).toBeGreaterThan(5.7);
    expect(decoded.pitch).toBeCloseTo(-0.2, 2);
    expect(decoded.z).toBeCloseTo(1.625, 10);
  });

  it('round-trip LINE_SHOOT для shaft', () => {
    const bullet = {
      type: WEAPON.SHAFT,
      pitch: 0.15,
      dest: new Vector(20.25, 30.5),
      dest_z: 1.25,
      owner: { id: 17, power: 0 },
      norm_dir: new Vector(0.5, -0.25),
      nap: new Vector(-0.125, 0.375),
      dynent: new Dynent(new Vector(5, 6), new Vector(1, 2.5), 0.75),
    };
    const event = new GameEvent(EVENT.LINE_SHOOT, [5, 6], null, bullet);
    const decoded = encodeDecodeEvent(event);

    expect(decoded.type).toBe(EVENT.LINE_SHOOT);
    expect(decoded.bullet_type).toBe(WEAPON.SHAFT);
    expect(decoded.size_y).toBe(2.5);
    expect(decoded.dest.x).toBeCloseTo(20.25, 10);
    expect(decoded.dest.y).toBeCloseTo(30.5, 10);
    expect(decoded.dest_z).toBeCloseTo(1.25, 10);
    expect(decoded.ownerid).toBe(17);
    expect(decoded.norm_dir.x).toBeCloseTo(0.5, 3);
    expect(decoded.norm_dir.y).toBeCloseTo(-0.25, 3);
    expect(decoded.nap.x).toBeCloseTo(-0.125, 3);
    expect(decoded.nap.y).toBeCloseTo(0.375, 3);
  });
});

describe('transport — строка таблицы лидеров', () => {
  it('добавляет маркер killer/looser к нику и кодирует очки', () => {
    const rowBot = {
      nick: 'Neo',
      stats: { scores: 1500 },
      isKiller: () => true,
      isLooser: () => false,
    };
    const view = makeView();
    const offset = transport.setRow(view, 0, rowBot);
    const decoded = new transport.TableRow();
    const decodedOffset = transport.getRow(view, 0, decoded);

    expect(decodedOffset).toBe(offset);
    expect(decoded.nick).toBe('rNeo');
    expect(decoded.scores).toBe(1500);
  });
});
