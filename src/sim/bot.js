import { Event } from '@/core/event.js';
import { state as runtime } from '@/core/runtime-state.js';
import { Vector } from '@/core/vector.js';

import { ITEM, WEAPON } from '@/global.js';

import { bulletKnockbackDir } from './game-events.js';
import { Weapon } from './weapon.js';

import { LAVA_SHORE_FACTOR } from './level.js';

import { Aibot } from './aibot.js';

import { Dynent } from './dynent.js';

function slideBarrierCollision(dynent, knockback_vel, norm, dt, inward) {
  norm.normalize();
  const dot = norm.dot(dynent.vel);
  const blockVel = inward ? dot > 0 : dot < 0;
  if (!blockVel) return;
  dynent.pos.sub(norm.mul(dot * dt));
  const nkb = norm.dot(knockback_vel);
  const blockKb = inward ? nkb > 0 : nkb < 0;
  if (blockKb) knockback_vel.sub(Vector.mul(new Vector(norm), nkb));
}

const KNOCKBACK_PAIN = {
  default: 0.004,
  highDamage: 0.007,
  rocketBase: 0.014,
  rocketScale: 0.048,
  [WEAPON.PLASMA]: 0.008,
  [WEAPON.ZENIT]: 0.011,
  [WEAPON.RAIL]: 0.013,
};
const KNOCKBACK_DEATH = {
  default: 0.022,
  rocketBase: 0.04,
  rocketScale: 0.11,
  [WEAPON.PLASMA]: 0.028,
  [WEAPON.ZENIT]: 0.032,
  [WEAPON.RAIL]: 0.038,
};

function knockStrength(bullet, dist, table) {
  if (bullet.type === WEAPON.ROCKET) {
    const falloff = Math.max(0, 1 - dist / WEAPON.RADIUS_ROCKET);
    return table.rocketBase + falloff * table.rocketScale;
  }
  return table[bullet.type] ?? table.default;
}

function addKnockbackVel(bot, bullet, opponent, table, maxKb, damage = 0) {
  if (!bullet || bullet.type === WEAPON.SHAFT) return;
  const kb = bulletKnockbackDir(bullet, opponent);
  if (!kb) return;
  const dist = bullet.pos ? Vector.sub(bot.dynent.pos, bullet.pos).length() : 0;
  let strength = knockStrength(bullet, dist, table);
  if (damage > 1500 && table.highDamage) strength = table.highDamage;
  bot.knockback_vel.add(Vector.mul(kb, strength));
  const kbLen = bot.knockback_vel.length();
  if (kbLen > maxKb) bot.knockback_vel.mul(maxKb / kbLen);
}

class Bot {
  constructor(game, nick, id, isBot) {
    this.game = game;
    this.nick = nick;
    this.id = id;

    //key controls
    this.key_up = false;
    this.key_left = false;
    this.key_down = false;
    this.key_right = false;
    this.shoot = false;
    this.pitch = 0;

    this.alive = false;
    this.resp_time = 0;

    this.ai = null;

    if (isBot) this.ai = new Aibot(this);

    this.direction = new Vector(0, 0);

    Event.emit('botadded', this);
  }

  respawn() {
    let pos = this.game.level.getRandomPos();
    this.dynent = new Dynent(pos);
    this.health = Bot.HEALTH;
    this.weapon = new Weapon(this);
    this.alive = false;
    this.spawning = true;
    this.spawn_start = Date.now();
    this.invuln_until = 0;
    this.resp_time = 0;
    this.power = 0;
    this.powertime = 0;
    this.shield = false;
    this.last_shoot_time = 0;
    this.speed = this.ai ? Bot.AI_SPEED : Bot.SPEED;
    this.last_update = Date.now();
    this.knockback_vel = new Vector(0, 0);

    Event.emit('botrespawn', this);
  }

  finishSpawn() {
    this.spawning = false;
    this.alive = true;
    this.invuln_until = Date.now() + Bot.SPAWN_INVULN_MS;

    let bot = null;
    do {
      bot = this.collide_bot(0);
      if (bot) {
        bot.pain(Bot.HEALTH + 1, this);
        Event.emit('telefrag', this, bot);
      }
    } while (bot);
  }

  update(time) {
    let dt = time - this.last_update;
    if (dt > 30) {
      return this.update(this.last_update + 30) && this.update(time);
    }
    this.last_update = time;

    if (this.spawning) {
      if (time >= this.spawn_start + Bot.SPAWN_ANIM_MS) this.finishSpawn();
      return true;
    }

    if (!this.alive) {
      this.applyCorpseMotion(dt);
      return true;
    }

    // God mode: keep every weapon stocked to its max each frame, which gives
    // the god player all guns plus effectively infinite ammo (refilled before
    // weapon.shoot() runs below).
    if (runtime.godMode && this.nick === runtime.godNick && this.weapon) {
      for (let t = WEAPON.PISTOL; t <= WEAPON.ROCKET; t++) {
        this.weapon.patrons[t] = WEAPON.wea_tabl[t].patrons;
      }
    }

    if (this.ai) this.ai.update(dt);

    this.direction.set(0, 0);
    if (this.key_up) this.direction.add2(0, -1);
    if (this.key_left) this.direction.add2(-1, 0);
    if (this.key_down) this.direction.add2(0, 1);
    if (this.key_right) this.direction.add2(1, 0);
    this.direction.normalize();

    let sina = Math.sin(this.dynent.angle);
    let cosa = Math.cos(this.dynent.angle);
    let vec = new Vector(
      this.direction.x * cosa + this.direction.y * sina,
      this.direction.y * cosa - this.direction.x * sina,
    );

    this.dynent.vel = Vector.mul(vec, this.speed);
    this.blendKnockbackVel(dt);
    this.dynent.update(dt);
    this.resolveMapCollision(dt);
    this.collide_bot(dt);

    if (this.shoot) this.weapon.shoot();

    //powerup regen
    if (this.power === ITEM.REGEN && time > this.powertime) {
      this.powertime = time + 100;
      this.health += 50;
      if (this.health > Bot.HEALTH) this.health = Bot.HEALTH;
    }

    return true;
  }

  collide_bot(dt) {
    let res = null;
    for (let i = 0; i < this.game.bots.length; i++) {
      let bot = this.game.bots[i];
      if (bot === this) continue;
      if (!bot.alive) continue;

      let norm = this.dynent.collide(bot.dynent, bot.dynent.size.x);
      if (norm !== null) {
        norm.normalize();
        let dot = norm.dot(this.dynent.vel);
        if (dot > 0) {
          let delta = norm.mul(dot * dt);
          this.dynent.pos.sub(delta);
        }
        res = bot;
      }
    }
    return res;
  }

  resolveMapCollision(dt) {
    const wallNorm = this.game.level.collideMap(this.dynent.pos);
    if (wallNorm) slideBarrierCollision(this.dynent, this.knockback_vel, wallNorm, dt, true);

    const barrier = this.game.level.collideLavaBarrier(this.dynent.pos);
    if (barrier) {
      slideBarrierCollision(
        this.dynent,
        this.knockback_vel,
        barrier.norm,
        dt,
        barrier.kind !== 'bridge',
      );
      if (barrier.kind === 'shore') {
        const lavaTile = this.game.level.getCollide(this.dynent.pos, true);
        if (lavaTile > LAVA_SHORE_FACTOR) {
          const depth = Math.min(0.35, ((lavaTile - LAVA_SHORE_FACTOR) / 255) * 0.9);
          this.dynent.pos.sub(barrier.norm.normalize().mul(depth));
        }
      }
    }
    const tile = this.game.level.getCollide(this.dynent.pos, false);
    if (tile > 128) {
      const grad = new Vector(0, 0);
      this.game.level.getNorm(grad, this.dynent.pos, false);
      if (grad.length2() > 1e-8) {
        grad.normalize();
        const depth = Math.min(0.2, ((tile - 128) / 255) * 0.45);
        this.dynent.pos.sub(grad.mul(depth));
      }
    }
  }

  blendKnockbackVel(dt, maxSpeed = 0.055) {
    if (this.knockback_vel.length2() < 1e-12) return;
    this.dynent.vel.x += this.knockback_vel.x;
    this.dynent.vel.y += this.knockback_vel.y;
    this.knockback_vel.mul(Math.pow(0.76, dt / 16));
    const kbLen = this.knockback_vel.length();
    if (kbLen > maxSpeed) this.knockback_vel.mul(maxSpeed / kbLen);
    else if (kbLen < 0.00035) this.knockback_vel.set(0, 0);
  }

  applyCorpseMotion(dt) {
    if (this.knockback_vel.length2() < 1e-12) return;
    this.dynent.vel.set(this.knockback_vel.x, this.knockback_vel.y);
    this.dynent.update(dt);
    this.resolveMapCollision(dt);
    this.knockback_vel.mul(Math.pow(0.72, dt / 16));
    const kbLen = this.knockback_vel.length();
    if (kbLen > 0.09) this.knockback_vel.mul(0.09 / kbLen);
    else if (kbLen < 0.0003) this.knockback_vel.set(0, 0);
  }

  applyDeathKnockback(bullet, opponent) {
    addKnockbackVel(this, bullet, opponent, KNOCKBACK_DEATH, 0.1);
  }

  applyKnockback(bullet, damage, opponent) {
    addKnockbackVel(this, bullet, opponent, KNOCKBACK_PAIN, 0.058, damage);
  }

  pain(damage, opponent, bullet) {
    if (runtime.godMode && this.nick === runtime.godNick) {
      Event.emit('botpain', this, bullet, opponent);
      return;
    }
    if (this.spawning || (this.invuln_until && Date.now() < this.invuln_until)) return;
    if (this.shield) {
      damage *= 0.5;
      if (bullet && bullet.type === WEAPON.RAIL) {
        this.shield = false;
        damage = 0;
      }
    }
    if (bullet && damage > 0) {
      this.applyKnockback(bullet, damage, opponent);
    }
    this.health -= damage;
    if (this.health < 0) {
      this.dead(opponent, bullet);
    }
    Event.emit('botpain', this, bullet, opponent);
  }

  dead(opponent, bullet) {
    this.alive = false;
    this.resp_time = Date.now() + 2000;
    this.applyDeathKnockback(bullet, opponent);
    Event.emit('botdead', this, opponent, bullet);
  }
}

Bot.SPEED = 0.008;
Bot.AI_SPEED = 0.0058;
Bot.HEALTH = 3999;
Bot.SPAWN_ANIM_MS = 2200;
Bot.SPAWN_INVULN_MS = 3000;

Event.on('takehealth', function (bot) {
  bot.health = Bot.HEALTH;
});

Event.on('takeshield', function (bot) {
  bot.shield = true;
});

Event.on('takepower', function (bot, type) {
  bot.power = type;
  const base = bot.ai ? Bot.AI_SPEED : Bot.SPEED;
  if (type === ITEM.SPEED) {
    bot.speed = base * 1.5;
  } else {
    bot.speed = base;
  }
});

export { Bot };
