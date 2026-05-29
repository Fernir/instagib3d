import { WEAPON, ITEM } from '../game/global.js';
import { Event } from '../libs/event.js';
import { Vector } from '../libs/vector.js';

import { Dynent } from './dynent.js';

//pos - Vector
class Bullet {
  constructor(type, pos, angle, owner) {
    this.type = type;
    this.owner = owner;
    this.dynent = new Dynent(pos, [1, 1], angle);

    let norm_dir = new Vector(-Math.sin(angle), -Math.cos(angle));
    this.norm_dir = norm_dir;
    this.nap = null;
    this.dest = null;
    this.id = 0;

    if (type <= WEAPON.RAIL) {
      let dest = new Vector(pos);
      let old_tile = 0;
      for (let len = 1; len < 11; len++) {
        dest.add(norm_dir);
        let tile = owner.game.level.getCollide(dest);
        if (tile > 128) {
          let koef = (tile - 128) / (tile - old_tile);
          let err = Vector.mul(norm_dir, koef);
          dest.sub(err);
          break;
        }
        old_tile = tile;
      }

      //here collide with bot, ray [pos, dest]
      let dist = Vector.sub(dest, pos);
      let min_dist_for_shaft = 256;
      let bot_for_shaft = null;
      for (let i = 0; i < owner.game.bots.length; i++) {
        let bot = owner.game.bots[i];
        if (bot === owner) continue;
        if (!bot.alive) continue;

        let R = Vector.sub(bot.dynent.pos, pos);
        let rr = R.dot(R);
        let dot_r_dist = R.dot(dist);
        let dd = dist.dot(dist);

        if (type == WEAPON.SHAFT) {
          let rast = Math.sqrt(rr);
          let length = Math.sqrt(dd);
          if (rast < length && rast < min_dist_for_shaft && dot_r_dist > 0) {
            let norm = Vector.binormalize(dist).normalize();
            let rnorm = Vector.normalize(R);
            let r = Math.abs(norm.dot(rnorm));
            if (r < 0.33) {
              min_dist_for_shaft = rast;
              bot_for_shaft = bot;
            }
          }
        } else {
          let rad = bot.dynent.size.x * 0.5;
          let D = 4 * dot_r_dist * dot_r_dist - 4 * dd * rr + 4 * dd * rad;
          if (D < 0) continue;

          let sD = Math.sqrt(D);
          let t = (2 * dot_r_dist - sD) / (2 * dd);
          if (t < 0 && (2 * dot_r_dist + sD) / (2 * dd) > 0) t = 0.01;
          if (t < 0 || t > 1) continue;

          if (type === WEAPON.RAIL) {
            bot.pain(WEAPON.wea_tabl[type].damage, owner, { pos: dest, type: type });
            continue;
          }

          let nap = Vector.mul(dist, t);
          dest = Vector.add(pos, nap);
          let power = owner.power === ITEM.QUAD ? WEAPON.ROCKET + 1 : 0;
          bot.pain(WEAPON.wea_tabl[type + power].damage, owner, { pos: dest, type: type });
          break;
        }
      }

      if (bot_for_shaft !== null) {
        let nap = new Vector(bot_for_shaft.dynent.pos);
        nap.sub(pos);
        let radius = Vector.normalize(nap).mul(bot_for_shaft.dynent.size.x * 0.5);
        nap.sub(radius);
        this.dynent.angle = nap.angle() - Math.PI / 2;
        dest = Vector.add(pos, nap);
        this.nap = nap;

        let power = owner.power === ITEM.QUAD ? WEAPON.ROCKET + 1 : 0;
        bot_for_shaft.pain(WEAPON.wea_tabl[type + power].damage * WEAPON.FRAME_DELTA_TIME, owner, {
          pos: dest,
          type: WEAPON.SHAFT,
        });
      } else {
        this.nap = Vector.sub(dest, pos);
      }

      let len = Vector.sub(dest, pos).length();
      this.dynent.pos.add(dest).mul(0.5);
      this.dynent.size.set(0.5, len);
      this.dest = dest;

      Event.emit('lineshoot', this);
    } else {
      this.dynent.vel = Vector.mul(norm_dir, WEAPON.wea_tabl[type].vel);
    }

    this.dead = Date.now() + WEAPON.wea_tabl[type].lifetime;
    this.last_update = Date.now();
    this.dist_for_rocket = 256;
    this.ai_check = false;
  }

  update(time) {
    let delta = time - this.last_update;
    if (delta > 20) {
      return this.update(this.last_update + 20) && this.update(time);
    } else if (delta < 20) return true;

    this.last_update = time;

    if (time > this.dead) return false;

    if (this.type >= WEAPON.PLASMA) {
      this.dynent.update(delta);

      //collide map
      if (this.type === WEAPON.ZENIT) {
        let norm = new Vector(0, 0);
        let tile = this.owner.game.level.getNorm(norm, this.dynent.pos);
        if (tile > 128) {
          norm.normalize();
          let dot = norm.dot(this.dynent.vel);
          if (dot > 0) {
            let reflect = norm.mul(2 * dot);
            this.dynent.vel.sub(reflect);
            this.dynent.angle = this.dynent.vel.angle() - Math.PI / 2;
            Event.emit('bulletrespawn', this, false);
          }
        }
      } else {
        if (this.owner.game.level.getCollide(this.dynent.pos) > 128) return false;
      }

      //collide bot
      let min_dist = 256;
      for (let i = 0; i < this.owner.game.bots.length; i++) {
        let bot = this.owner.game.bots[i];
        if (!bot.alive) continue;

        let radius = WEAPON.wea_tabl[this.type].radius;
        if (bot !== this.owner && this.owner.power === ITEM.QUAD) {
          radius = WEAPON.wea_tabl[this.type + WEAPON.ROCKET + 1].radius;
        }
        let dir = bot.dynent.collide(this.dynent, radius);
        if (dir !== null) {
          let damage = this.type === WEAPON.ROCKET ? 0 : WEAPON.wea_tabl[this.type].damage;
          bot.pain(damage, this.owner, {
            pos: this.dynent.pos,
            vel: this.dynent.vel,
            type: this.type,
          });
          return false;
        }

        //for rocket
        if (this.type === WEAPON.ROCKET) {
          let time_bot = bot.last_update;
          let dt = this.last_update - time_bot;
          let bot_pos = Vector.add(bot.dynent.pos, Vector.mul(bot.dynent.vel, dt));
          let dist = Vector.sub(bot_pos, this.dynent.pos).length();
          if (bot !== this.owner && dist < min_dist) min_dist = dist;
        }
      }

      if (this.type === WEAPON.ROCKET) {
        let dist = Vector.sub(this.owner.dynent.pos, this.dynent.pos).length();
        if (dist > WEAPON.RADIUS_ROCKET && min_dist < WEAPON.RADIUS_ROCKET) {
          if (min_dist < this.dist_for_rocket) this.dist_for_rocket = min_dist;
          else return false;
        }
      }
    }
    return true;
  }
}

export { Bullet };
