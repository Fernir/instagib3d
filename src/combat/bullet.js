import { Event } from '@core/event.js';
import { Vector } from '@core/vector.js';
import { Dynent } from '@entity/dynent.js';
import { WEAPON, ITEM } from '@game/global.js';

const SHOOTER_EYE_Z = 1.4;
// Запасная высота дула, если weapon.js не передал muzzleZ (≈ pitch=0, gun чуть
// ниже уровня глаз). При нормальном вызове muzzleZ всегда задан и зависит от
// наклона камеры — снаряд стартует из кончика ствола.
const SHOOTER_GUN_Z = 1.05;
const BOT_HIT_Z_LOW = 0.25;
const BOT_HIT_Z_HIGH = 1.85;
const WALL_TOP_Z = 4.0;

function hitZ(z) {
  return z >= BOT_HIT_Z_LOW && z <= BOT_HIT_Z_HIGH;
}

//pos - Vector
class Bullet {
  constructor(type, pos, angle, owner, pitch = 0, muzzleZ) {
    this.type = type;
    this.owner = owner;
    this.pitch = pitch;
    this.dynent = new Dynent(pos, [1, 1], angle);

    const cos_p = Math.cos(pitch);
    const sin_p = Math.sin(pitch);

    let norm_dir = new Vector(-Math.sin(angle), -Math.cos(angle));
    this.norm_dir = norm_dir;
    this.nap = null;
    this.dest = null;
    this.id = 0;
    this.z = SHOOTER_EYE_Z;
    this.vz = 0;
    this.dest_z = SHOOTER_EYE_Z;

    // Для снарядов z стартует с реальной высоты дула: weapon.js считает её с
    // учётом yaw+pitch, поэтому при стрельбе вверх/вниз trail/glow появляются
    // из кончика ствола. Хитсканы (RAIL/SHAFT) трассируются от глаза.
    if (type !== WEAPON.SHAFT && type !== WEAPON.RAIL) {
      this.z = typeof muzzleZ === 'number' ? muzzleZ : SHOOTER_GUN_Z;
    }

    if (type === WEAPON.SHAFT || type === WEAPON.RAIL) {
      let dest = new Vector(pos);
      let old_tile = 0;
      let cur_z = SHOOTER_EYE_Z;
      let blocked_by_height = false;
      const step_vec = Vector.mul(norm_dir, cos_p || 1);
      const dz_per_step = sin_p;
      for (let len = 1; len < 11; len++) {
        dest.add(step_vec);
        cur_z += dz_per_step;
        if (cur_z < 0 || cur_z > WALL_TOP_Z) {
          blocked_by_height = true;
          break;
        }
        let tile = owner.game.level.getCollide(dest);
        if (tile > 128) {
          let koef = (tile - 128) / (tile - old_tile);
          let err = Vector.mul(step_vec, koef);
          dest.sub(err);
          cur_z -= dz_per_step * koef;
          break;
        }
        old_tile = tile;
      }
      this.dest_z = cur_z;
      if (blocked_by_height) {
        // Луч ушёл в пол/потолок — стрельба «в никуда».
        this.dest = dest;
        this.nap = Vector.sub(dest, pos);
        let len = Vector.sub(dest, pos).length();
        this.dynent.pos.add(dest).mul(0.5);
        this.dynent.size.set(0.5, len);
        Event.emit('lineshoot', this);
        this.dead = Date.now() + WEAPON.wea_tabl[type].lifetime;
        this.last_update = Date.now();
        this.dist_for_rocket = 256;
        this.ai_check = false;
        return;
      }

      //here collide with bot, ray [pos, dest]
      let dist = Vector.sub(dest, pos);
      const total_dz = cur_z - SHOOTER_EYE_Z;
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
              const t = dot_r_dist / Math.max(dd, 1e-6);
              const z_at = SHOOTER_EYE_Z + total_dz * Math.max(0, Math.min(1, t));
              if (hitZ(z_at)) {
                min_dist_for_shaft = rast;
                bot_for_shaft = bot;
              }
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

          const z_at = SHOOTER_EYE_Z + total_dz * t;
          if (!hitZ(z_at)) continue;

          if (type === WEAPON.RAIL) {
            bot.pain(WEAPON.wea_tabl[type].damage, owner, {
              pos: dest,
              type: type,
              norm_dir: norm_dir,
            });
            continue;
          }

          let nap = Vector.mul(dist, t);
          dest = Vector.add(pos, nap);
          let power = owner.power === ITEM.QUAD ? WEAPON.ROCKET + 1 : 0;
          bot.pain(WEAPON.wea_tabl[type + power].damage, owner, {
            pos: dest,
            type: type,
            norm_dir: norm_dir,
          });
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
          norm_dir: norm_dir,
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
      const speed = WEAPON.wea_tabl[type].vel;
      this.dynent.vel = Vector.mul(norm_dir, speed * cos_p);
      this.vz = speed * sin_p;
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

    if (this.type === WEAPON.PISTOL || this.type >= WEAPON.PLASMA) {
      this.dynent.update(delta);
      this.z += this.vz * delta;
      if (this.z < 0 || this.z > WALL_TOP_Z) return false;

      //collide map — рикошетит только предпоследнее оружие (ZENIT);
      // остальные снаряды гибнут/взрываются о стену.
      if (this.z < WALL_TOP_Z) {
        let norm = new Vector(0, 0);
        let tile = this.owner.game.level.getNorm(norm, this.dynent.pos);
        if (tile > 128) {
          norm.normalize();
          let dot = norm.dot(this.dynent.vel);
          if (dot > 0) {
            if (this.type !== WEAPON.ZENIT) return false;
            let reflect = norm.mul(2 * dot);
            this.dynent.vel.sub(reflect);
            this.dynent.angle = this.dynent.vel.angle() - Math.PI / 2;
            this.bounces = (this.bounces || 0) + 1;
            // ZENIT синкает отражение событием (клиент пересоздаёт снаряд).
            Event.emit('bulletrespawn', this, false);
          }
        }
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
        if (dir !== null && hitZ(this.z)) {
          let damage = this.type === WEAPON.ROCKET ? 0 : WEAPON.wea_tabl[this.type].damage;
          bot.pain(damage, this.owner, {
            pos: this.dynent.pos,
            vel: this.dynent.vel,
            norm_dir: this.norm_dir,
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
