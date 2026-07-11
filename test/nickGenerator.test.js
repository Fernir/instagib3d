import { NickGenerator } from '@core/nickGenerator/index.js';
import { describe, it, expect } from 'vitest';


describe('NickGenerator — генератор ников', () => {
  it('принимает длину префикса 3..5', () => {
    expect(() => new NickGenerator(3)).not.toThrow();
    expect(() => new NickGenerator(4)).not.toThrow();
    expect(() => new NickGenerator(5)).not.toThrow();
  });

  it('по умолчанию длина префикса 3', () => {
    expect(() => new NickGenerator()).not.toThrow();
  });

  it('отклоняет длину префикса вне диапазона', () => {
    expect(() => new NickGenerator(2)).toThrow();
    expect(() => new NickGenerator(6)).toThrow();
  });

  it('генерирует непустую строку не длиннее запрошенной', () => {
    const gen = new NickGenerator(3);
    for (let i = 0; i < 50; i++) {
      const nick = gen.gener(8);
      expect(typeof nick).toBe('string');
      expect(nick.length).toBeGreaterThan(0);
      expect(nick.length).toBeLessThanOrEqual(8);
    }
  });

  it('использует только буквы из словаря', () => {
    const gen = new NickGenerator(4);
    for (let i = 0; i < 50; i++) {
      const nick = gen.gener(10);
      expect(nick).toMatch(/^[a-zA-Z]*$/);
    }
  });
});
