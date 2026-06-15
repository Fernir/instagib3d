import { describe, it, expect } from 'vitest';

import { NickGenerator } from '../src/instagib/server/libs/nickGenerator/index.js';

describe('NickGenerator', () => {
  it('accepts prefix lengths 3..5', () => {
    expect(() => new NickGenerator(3)).not.toThrow();
    expect(() => new NickGenerator(4)).not.toThrow();
    expect(() => new NickGenerator(5)).not.toThrow();
  });

  it('defaults to prefix length 3 when omitted', () => {
    expect(() => new NickGenerator()).not.toThrow();
  });

  it('rejects out-of-range prefix lengths', () => {
    expect(() => new NickGenerator(2)).toThrow();
    expect(() => new NickGenerator(6)).toThrow();
  });

  it('generates a non-empty string no longer than requested length', () => {
    const gen = new NickGenerator(3);
    for (let i = 0; i < 50; i++) {
      const nick = gen.gener(8);
      expect(typeof nick).toBe('string');
      expect(nick.length).toBeGreaterThan(0);
      expect(nick.length).toBeLessThanOrEqual(8);
    }
  });

  it('produces only alphabetic characters from the dictionary', () => {
    const gen = new NickGenerator(4);
    for (let i = 0; i < 50; i++) {
      const nick = gen.gener(10);
      expect(nick).toMatch(/^[a-zA-Z]*$/);
    }
  });
});
