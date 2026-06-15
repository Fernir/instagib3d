import { describe, it, expect, vi } from 'vitest';

import { Event } from '../src/instagib/server/libs/event.js';

describe('Event emitter', () => {
  it('calls a registered listener with params', () => {
    const cb = vi.fn();
    Event.on('evt-basic', cb);
    Event.emit('evt-basic', 1, 'two', { three: 3 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1, 'two', { three: 3 });
  });

  it('calls multiple listeners in registration order', () => {
    const order = [];
    Event.on('evt-order', () => order.push('a'));
    Event.on('evt-order', () => order.push('b'));
    Event.emit('evt-order');
    expect(order).toEqual(['a', 'b']);
  });

  it('emitting an unknown event is a no-op', () => {
    expect(() => Event.emit('evt-never-registered')).not.toThrow();
  });

  it('does not fire listeners of other events', () => {
    const cb = vi.fn();
    Event.on('evt-isolated', cb);
    Event.emit('evt-some-other-event');
    expect(cb).not.toHaveBeenCalled();
  });
});
