import { ITEM, WEAPON } from '../game/global.js';
import { Event } from '../libs/event.js';
import { Vector } from '../libs/vector.js';

import { Bullet } from './bullet.js';

class Weapon {
  constructor(owner) {
    this.type = WEAPON.PISTOL;
    this.owner = owner;
    this.next_shoot = 0;

    this.patrons = [1, 0, 0, 0, 0, 0];
  }

  set(type) {
    this.type = type;
  }

  next() {
    for (let type = this.type + 1; type <= WEAPON.ROCKET; type++) {
      if (this.patrons[type] > 0) {
        this.set(type);
        break;
      }
    }
  }

  prev() {
    for (let type = this.type - 1; type >= WEAPON.PISTOL; type--) {
      if (this.patrons[type] > 0) {
        this.set(type);
        break;
      }
    }
  }

  shoot() {
    if (Date.now() > this.next_shoot) {
      if (this.type != WEAPON.PISTOL && this.patrons[this.type] <= 0) {
        this.prev();
        return;
      }

      let Y = 0.9;
      let angle = this.owner.dynent.angle;
      if (this.type === WEAPON.PISTOL) {
        angle += ((Math.random() * 2 - 1) * Math.PI) / 100;
      }

      let sina = Math.sin(angle);
      let cosa = Math.cos(angle);
      let position = Vector.add2(
        this.owner.dynent.pos,
        cosa * 0.25 - sina * Y,
        -cosa * Y - sina * 0.25,
      );

      //for collision
      let center = Vector.add(position, this.owner.dynent.pos).mul(0.5);
      if (this.owner.game.level.getCollide(center) > 128) return;

      Event.emit('shoot', this.owner, this.type);
      if (this.type >= WEAPON.PLASMA) {
        let bul = new Bullet(this.type, position, angle, this.owner);
        bul.ai_check = true;
        bul.id = this.owner.game.getBulletId();
        this.owner.game.bullets.push(bul);
        Event.emit('bulletrespawn', bul, true);
      } else {
        new Bullet(this.type, position, angle, this.owner);
      }
      if (this.type !== WEAPON.SHAFT) {
        if (this.type !== WEAPON.PISTOL) this.patrons[this.type]--;
      } else {
        this.patrons[this.type] -= WEAPON.FRAME_DELTA_TIME;
      }

      let power = this.owner.power === ITEM.QUAD ? WEAPON.ROCKET + 1 : 0;
      if (this.type === WEAPON.ZENIT) {
        let count = power ? 19 : 9;
        for (let i = 0; i < count; i++) {
          let my_angle = angle + ((Math.random() * 2 - 1) * Math.PI) / 15;
          let bul = new Bullet(this.type, position, my_angle, this.owner);
          bul.ai_check = false;
          bul.id = this.owner.game.getBulletId();
          this.owner.game.bullets.push(bul);
          Event.emit('bulletrespawn', bul, false);
        }
      }

      this.next_shoot = Date.now() + WEAPON.wea_tabl[this.type + power].period;
      this.owner.last_shoot_time = Date.now();
    }
  }
}

Event.on('takeweapon', function (bot, type, patrons) {
  bot.weapon.patrons[type] += patrons;
  if (
    (type > bot.weapon.type && bot.weapon.patrons[type] === patrons) ||
    bot.weapon.type === WEAPON.PISTOL
  ) {
    bot.weapon.set(type);
  }
});

//Static methods

Weapon.update = function (game) {
  for (let index = 0; index < game.bullets.length; ) {
    let bullet = game.bullets[index];
    if (bullet.update(Date.now())) {
      index++;
    } else {
      Event.emit('bulletdead', bullet);
      //calc damage with rocket
      if (bullet.type == WEAPON.ROCKET) {
        for (let i = 0; i < bullet.owner.game.bots.length; i++) {
          let bot = bullet.owner.game.bots[i];
          if (!bot.alive) continue;

          let len = Vector.sub(bullet.dynent.pos, bot.dynent.pos).length();
          let damage = (1 - len / WEAPON.RADIUS_ROCKET) * WEAPON.wea_tabl[bullet.type].damage;
          if (damage > 0) {
            bot.pain(damage, bullet.owner, { pos: bullet.dynent.pos, type: bullet.type });
          }
        }
      }
      game.bullets.splice(index, 1);
    }
  }
};

export { Weapon };
