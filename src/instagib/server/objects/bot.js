import { state as runtime } from '../../runtime-state.js';
import { Aibot } from '../game/aibot.js';
import { ITEM, WEAPON } from '../game/global.js';
import { Event } from '../libs/event.js';
import { Vector } from '../libs/vector.js';

import { Dynent } from './dynent.js';
import { Weapon } from './weapon.js';

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
    this.alive = true;
    this.resp_time = 0;
    this.power = 0;
    this.powertime = 0;
    this.shield = false;
    this.last_shoot_time = 0;
    this.speed = this.ai ? Bot.AI_SPEED : Bot.SPEED;
    this.last_update = Date.now();

    Event.emit('botrespawn', this);

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

    if (!this.alive) return true;

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
    this.dynent.update(dt);

    if (this.shoot) this.weapon.shoot();

    //collide map
    function collide_map(self) {
      let norm = self.game.level.collideMap(self.dynent.pos);
      if (norm) {
        norm.normalize();
        let dot = norm.dot(self.dynent.vel);
        if (dot > 0) {
          let delta = norm.mul(dot * dt);
          self.dynent.pos.sub(delta);
        }
      }
      // Velocity projection alone cannot eject from inside a wall — push out along
      // the density gradient when already past the 0.5 iso-surface (tile > 128).
      const tile = self.game.level.getCollide(self.dynent.pos, false);
      if (tile > 128) {
        const grad = new Vector(0, 0);
        self.game.level.getNorm(grad, self.dynent.pos, false);
        if (grad.length2() > 1e-8) {
          grad.normalize();
          const depth = Math.min(0.2, ((tile - 128) / 255) * 0.45);
          self.dynent.pos.sub(grad.mul(depth));
        }
      }
    }

    collide_map(this);
    this.collide_bot(dt);

    //collide_lava
    if (this.game.level.collideLava(this.dynent.pos)) {
      let bridge = this.game.level.getCollideBridges(this.dynent.pos);
      if (bridge === null) this.pain(Bot.HEALTH + 1, this, null, { lava: true });
    }

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

  /*
damage - count HP
opponent - bot, owner bullet
bullet.pos - position of this bullet
bullet.vel - velocity of this bullet
bullet.type - type weapon
param.lava
*/
  pain(damage, opponent, bullet, param) {
    if (runtime.godMode && this.nick === runtime.godNick) {
      Event.emit('botpain', this, bullet);
      return;
    }
    if (this.shield) {
      damage *= 0.5;
      if (bullet && bullet.type === WEAPON.RAIL) {
        this.shield = false;
        damage = 0;
      }
    }
    this.health -= damage;
    if (this.health < 0) {
      this.dead(opponent, bullet, param);
    }
    Event.emit('botpain', this, bullet);
  }

  dead(opponent, bullet, param) {
    this.alive = false;
    this.resp_time = Date.now() + 2000;

    let isLava = param && param.lava !== undefined && param.lava === true;
    Event.emit('botdead', this, opponent, bullet, isLava);
  }
}

Bot.SPEED = 0.008;
Bot.AI_SPEED = 0.0058;
Bot.HEALTH = 3999;

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
