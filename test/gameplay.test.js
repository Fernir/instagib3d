import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gameplay } from '../src/instagib/server/game/gameplay.js';
import { WEAPON } from '../src/instagib/server/game/global.js';
import { Event } from '../src/instagib/server/libs/event.js';

// gameplay.js навешивает обработчики на общий Event-синглтон при импорте.
// Тесты гоняют логику начисления очков/статистики, эмитя те же события,
// что и реальный игровой цикл.

let nowSpy;
let clock = 1_000_000;

function setNow(t) {
  clock = t;
}

beforeEach(() => {
  clock = 1_000_000;
  nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  nowSpy.mockRestore();
});

function makeBot(id) {
  const bot = { id };
  Event.emit('botadded', bot);
  return bot;
}

function kill(killer, victim, bullet) {
  Event.emit('botdead', victim, killer, bullet, false);
}

describe('gameplay._E (Elo expectation)', () => {
  it('returns half the K-factor for equal scores', () => {
    expect(gameplay._E(1200, 1200)).toBeCloseTo(gameplay.ratingkoef / 2, 10);
  });

  it('is symmetric: _E(a,b) + _E(b,a) === ratingkoef', () => {
    expect(gameplay._E(1500, 1000) + gameplay._E(1000, 1500)).toBeCloseTo(gameplay.ratingkoef, 10);
  });

  it('gives the underdog a larger expected gain', () => {
    const underdog = gameplay._E(1000, 1600);
    const favourite = gameplay._E(1600, 1000);
    expect(underdog).toBeGreaterThan(favourite);
  });
});

describe('gameplay.sortBots', () => {
  it('orders by score descending and assigns rank', () => {
    const a = makeBot(1);
    const b = makeBot(2);
    const c = makeBot(3);
    a.stats.scores = 1000;
    b.stats.scores = 1500;
    c.stats.scores = 1200;

    const sorted = gameplay.sortBots([a, b, c]);

    expect(sorted.map((x) => x.id)).toEqual([2, 3, 1]);
    expect(b.stats.rank).toBe(0);
    expect(c.stats.rank).toBe(1);
    expect(a.stats.rank).toBe(2);
  });
});

describe('botadded initialization', () => {
  it('seeds neutral stats and helper predicates', () => {
    const bot = makeBot(42);
    expect(bot.stats.scores).toBe(1200);
    expect(bot.stats.frag).toBe(0);
    expect(bot.isKiller()).toBe(false);
    expect(bot.isLooser()).toBe(false);
  });
});

describe('botdead scoring', () => {
  it('penalizes self-kills', () => {
    const bot = makeBot(1);
    kill(bot, bot, null);
    expect(bot.stats.selfkill).toBe(1);
    expect(bot.stats.frag).toBe(-1);
    expect(bot.stats.scores).toBe(1200 - 15);
    expect(bot.stats.death).toBe(1);
  });

  it('transfers Elo points on a normal frag', () => {
    const killer = makeBot(1);
    const victim = makeBot(2);
    kill(killer, victim, null);

    expect(killer.stats.frag).toBe(1);
    expect(killer.stats.currentseria).toBe(1);
    expect(killer.stats.scores).toBeCloseTo(1207.5, 6);
    expect(victim.stats.scores).toBeCloseTo(1192.5, 6);
    expect(victim.stats.death).toBe(1);
    expect(victim.stats.currentseria).toBe(0);
  });

  it('marks a killer after killseria frags and doubles the reward', () => {
    const killer = makeBot(1);
    for (let i = 0; i < gameplay.killseria; i++) {
      kill(killer, makeBot(100 + i), null);
    }
    expect(killer.stats.currentseria).toBe(gameplay.killseria);
    expect(killer.stats.killercount).toBe(1);
    expect(killer.stats.i_am_killer).toBe(true);
    expect(killer.isKiller()).toBe(true);
  });

  it('flags a looser after losing looserseria times in a row', () => {
    const victim = makeBot(1);
    for (let i = 0; i < gameplay.looserseria; i++) {
      kill(makeBot(200 + i), victim, null);
    }
    expect(victim.stats.currentantiseria).toBe(gameplay.looserseria);
    expect(victim.stats.loosercount).toBe(1);
    expect(victim.stats.i_am_looser).toBe(true);
    expect(victim.isLooser()).toBe(true);
  });
});

describe('botdead multikills', () => {
  it('counts double / triple / multi within the multikill window', () => {
    const killer = makeBot(1);

    setNow(50_000); // первый фраг далеко от старта — не quick, не multi
    kill(killer, makeBot(301), null);
    expect(killer.stats.currentmultikill).toBe(0);

    setNow(50_500);
    kill(killer, makeBot(302), null);
    expect(killer.stats.doublekill).toBe(1);
    expect(killer.stats.i_am_multi).toBe(1);

    setNow(51_000);
    kill(killer, makeBot(303), null);
    expect(killer.stats.triplekill).toBe(1);
    expect(killer.stats.i_am_multi).toBe(2);

    setNow(51_500);
    kill(killer, makeBot(304), null);
    expect(killer.stats.multikill).toBe(1);
    expect(killer.stats.i_am_multi).toBe(3);
  });

  it('resets the multikill chain once the window lapses', () => {
    const killer = makeBot(1);
    setNow(50_000);
    kill(killer, makeBot(311), null);
    setNow(50_500);
    kill(killer, makeBot(312), null);
    expect(killer.stats.currentmultikill).toBe(1);

    setNow(60_000); // > multikilltime после предыдущего
    kill(killer, makeBot(313), null);
    expect(killer.stats.currentmultikill).toBe(0);
  });
});

describe('botdead timing bonuses', () => {
  it('awards quickkill when fragging soon after respawn', () => {
    const killer = makeBot(1);
    setNow(100_000);
    Event.emit('botrespawn', killer);
    setNow(100_000 + gameplay.quicktime - 1);
    kill(killer, makeBot(401), null);
    expect(killer.stats.i_am_quickkill).toBe(true);
  });

  it('marks quickdeath when dying soon after respawn', () => {
    const victim = makeBot(1);
    setNow(100_000);
    Event.emit('botrespawn', victim);
    setNow(100_000 + gameplay.quicktime - 1);
    kill(makeBot(402), victim, null);
    expect(victim.stats.i_am_quickdeath).toBe(true);
  });
});

describe('rail sniper tracking', () => {
  const railBullet = { type: WEAPON.RAIL };

  it('does not flag a sniper on a single rail kill', () => {
    const killer = makeBot(1);
    Event.emit('shoot', killer, WEAPON.RAIL);
    kill(killer, makeBot(501), railBullet);
    expect(killer.stats.i_am_sniper).toBe(false);
  });

  it('flags a sniper on consecutive un-missed rail kills', () => {
    const killer = makeBot(1);
    Event.emit('shoot', killer, WEAPON.RAIL);
    kill(killer, makeBot(511), railBullet);
    Event.emit('shoot', killer, WEAPON.RAIL);
    kill(killer, makeBot(512), railBullet);
    expect(killer.stats.snipercount).toBe(1);
    expect(killer.stats.i_am_sniper).toBe(true);
  });

  it('shoot with a non-rail weapon resets the rail counters', () => {
    const killer = makeBot(1);
    Event.emit('shoot', killer, WEAPON.RAIL);
    expect(killer.stats.railshootnumber).toBe(1);
    Event.emit('shoot', killer, WEAPON.ROCKET);
    expect(killer.stats.railshootnumber).toBe(0);
    expect(killer.stats.lastrailkillnumber).toBe(-1);
  });
});

describe('telefrag scoring', () => {
  it('rewards the telefragger and tags both parties', () => {
    const killer = makeBot(1);
    const victim = makeBot(2);
    Event.emit('telefrag', killer, victim);
    expect(killer.stats.telefrag).toBe(1);
    expect(killer.stats.scores).toBe(1215);
    expect(killer.stats.i_am_telefraging).toBe(true);
    expect(victim.stats.telefraged).toBe(1);
    expect(victim.stats.i_am_telefraged).toBe(true);
  });
});
