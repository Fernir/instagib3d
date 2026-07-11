export function assert(condition, message) {
  if (!condition) {
    message = message || 'Assertion failed';
    Console.error(message);
    if (typeof Error !== 'undefined') {
      throw new Error(message);
    }
    throw message;
  }
}

export const Console = {
  assert,
  html: () => {},
  debug() {},
  info() {},
  error() {},
};

export const config = {
  get(key) {
    const subkeys = key.split(':');
    if (subkeys.length === 2) {
      assert(subkeys[0] === 'game-server');
      if (subkeys[1] === 'item-respawn-time') return 5000;
      if (subkeys[1] === 'update-time') return 50;
      if (subkeys[1] === 'looserseria') return 5;
      if (subkeys[1] === 'killseria') return 5;
      if (subkeys[1] === 'ratingkoef') return 15;
      if (subkeys[1] === 'ratingdiap') return 1000;
      if (subkeys[1] === 'multikilltime') return 2000;
      if (subkeys[1] === 'quicktime') return 2000;
      if (subkeys[1] === 'timeout-for-destroy-room') return 30000;
    }
    assert(false, `Unknown config parameters:${key}`);
  },
};
