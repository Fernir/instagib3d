import { Event } from '@/core/event.js';

import { EVENT } from '@/global.js';

import { GameEvent } from '@/sim/game-events.js';

import { describe, it, expect, vi } from 'vitest';


describe('Event — шина событий', () => {
  it('вызывает зарегистрированный обработчик с параметрами', () => {
    const cb = vi.fn();
    Event.on('evt-basic', cb);
    Event.emit('evt-basic', 1, 'two', { three: 3 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1, 'two', { three: 3 });
  });

  it('вызывает несколько обработчиков в порядке регистрации', () => {
    const order = [];
    Event.on('evt-order', () => order.push('a'));
    Event.on('evt-order', () => order.push('b'));
    Event.emit('evt-order');
    expect(order).toEqual(['a', 'b']);
  });

  it('emit неизвестного события — безопасный no-op', () => {
    expect(() => Event.emit('evt-never-registered')).not.toThrow();
  });

  it('не вызывает обработчики других событий', () => {
    const cb = vi.fn();
    Event.on('evt-isolated', cb);
    Event.emit('evt-some-other-event');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('GameEvent — игровое событие', () => {
  it('сохраняет тип, позицию и направление', () => {
    const ev = new GameEvent(EVENT.PAIN, [4, 8], [1, 0], 42);
    expect(ev.type).toBe(EVENT.PAIN);
    expect(ev.pos).toMatchObject({ x: 4, y: 8 });
    expect(ev.dir).toMatchObject({ x: 1, y: 0 });
    expect(ev.arg1).toBe(42);
  });

  it('dir может быть null', () => {
    const ev = new GameEvent(EVENT.TAKE_HEALTH, [0, 0], null);
    expect(ev.dir).toBeNull();
  });

  it('копирует позицию в Vector', () => {
    const ev = new GameEvent(EVENT.ITEM_RESPAWN, [3, 7]);
    expect(ev.pos.x).toBe(3);
    expect(ev.pos.y).toBe(7);
  });
});
