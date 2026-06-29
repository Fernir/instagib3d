import { EVENT, WEAPON } from '../game/global.js';
import { Event } from '../libs/event.js';
import { Vector } from '../libs/vector.js';

function bulletKnockbackDir(bullet, opponent) {
  if (!bullet) return null;
  if (bullet.vel && bullet.vel.length2() > 1e-12) {
    return Vector.normalize(new Vector(bullet.vel));
  }
  if (bullet.norm_dir && bullet.norm_dir.length2() > 1e-12) {
    return Vector.normalize(new Vector(bullet.norm_dir));
  }
  if (bullet.pos && opponent && opponent.dynent) {
    const d = Vector.sub(bullet.pos, opponent.dynent.pos);
    if (d.length2() > 1e-12) return Vector.normalize(d);
  }
  return null;
}

function eventKnockbackMag(bullet, targetPos, kind) {
  let falloff = 0;
  if (bullet.type === WEAPON.ROCKET && bullet.pos) {
    falloff = Math.max(0, 1 - Vector.sub(targetPos, bullet.pos).length() / WEAPON.RADIUS_ROCKET);
  }
  if (kind === 'pain') {
    if (bullet.type === WEAPON.ROCKET) return 0.008 + falloff * 0.028;
    if (bullet.type === WEAPON.PLASMA) return 0.01;
    if (bullet.type === WEAPON.ZENIT) return 0.014;
    return 0.012;
  }
  if (bullet.type === WEAPON.ROCKET) return 0.02 * falloff;
  if (bullet.type === WEAPON.PLASMA) return 0.004;
  if (bullet.type === WEAPON.ZENIT) return 0.01;
  if (bullet.type === WEAPON.RAIL) return 0.008;
  return 0.004;
}

class GameEvent {
  constructor(type, pos, dir, arg1, arg2) {
    this.type = type;
    this.pos = new Vector(pos);
    this.dir = dir ? new Vector(dir) : null;
    this.arg1 = arg1;
    this.arg2 = arg2;
  }
}

Event.on('botrespawn', function (bot) {
  bot.game.events.push(new GameEvent(EVENT.BOT_RESPAWN, bot.dynent.pos, null, bot.id));
});

Event.on('botpain', function (bot, bullet, opponent) {
  if (bullet && bullet.type !== WEAPON.RAIL) {
    const unit = bulletKnockbackDir(bullet, opponent);
    if (!unit) return;
    const mag = eventKnockbackMag(bullet, bot.dynent.pos, 'pain');
    const pos = bullet.type === WEAPON.ROCKET ? bot.dynent.pos : bullet.pos || bot.dynent.pos;
    bot.game.events.push(new GameEvent(EVENT.PAIN, pos, Vector.mul(unit, mag), bot.id));
  }
});

Event.on('botdead', function (bot, killer, bullet) {
  let dir = new Vector(0, 0);
  if (bullet) {
    const unit = bulletKnockbackDir(bullet, killer);
    if (unit) {
      dir = Vector.mul(unit, eventKnockbackMag(bullet, bot.dynent.pos, 'death'));
    }
  }
  bot.game.events.push(new GameEvent(EVENT.BOT_DEAD, bot.dynent.pos, dir, bot.id));
});

Event.on('takeweapon', function (bot) {
  bot.game.events.push(new GameEvent(EVENT.TAKE_WEAPON, bot.dynent.pos, null));
});

Event.on('takehealth', function (bot) {
  bot.game.events.push(new GameEvent(EVENT.TAKE_HEALTH, bot.dynent.pos, null));
});

Event.on('takeshield', function (bot) {
  bot.game.events.push(new GameEvent(EVENT.TAKE_SHIELD, bot.dynent.pos, null));
});

Event.on('takepower', function (bot) {
  bot.game.events.push(new GameEvent(EVENT.TAKE_POWER, bot.dynent.pos, null));
});

Event.on('itemrespawn', function (item) {
  item.game.events.push(new GameEvent(EVENT.ITEM_RESPAWN, item.dynent.pos, null));
});

Event.on('bulletdead', function (bullet) {
  bullet.owner.game.events.push(new GameEvent(EVENT.BULLET_DEAD, bullet.dynent.pos, null, bullet));
});

Event.on('lineshoot', function (bullet) {
  bullet.owner.game.events.push(new GameEvent(EVENT.LINE_SHOOT, bullet.dynent.pos, null, bullet));
});

Event.on('bulletrespawn', function (bullet, sound) {
  bullet.owner.game.events.push(
    new GameEvent(EVENT.BULLET_RESPAWN, bullet.dynent.pos, null, bullet, sound),
  );
});

export { GameEvent, bulletKnockbackDir, eventKnockbackMag };
