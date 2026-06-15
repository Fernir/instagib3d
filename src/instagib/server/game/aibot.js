import { Console } from '../../polyfill.js';
import { Event } from '../libs/event.js';
import { normalizeAngle } from '../libs/utility.js';
import { Vector } from '../libs/vector.js';
import { cameraCulling } from '../objects/dynent.js';
import { itemForEach } from '../objects/item.js';

import { ITEM, WEAPON } from './global.js';

// Высота «глаз» стрелка и зона прицеливания (согласованы с bullet.js hitZ).
const SHOOTER_EYE_Z = 1.4;
const AIM_Z_CHEST = 1.25;
const AIM_Z_CHEST_JITTER = 0.07;
const AIM_XY_SPREAD = 0.11;
const PITCH_LIMIT = Math.PI * 0.45;

class Forbidden {
  constructor(max_count) {
    this.max_count = max_count;
    this.waypoints = [];
  }

  push(way) {
    this.waypoints.push(way);
    if (this.waypoints.length > this.max_count) this.waypoints.splice(0, 1);
  }

  clear() {
    this.waypoints.splice(0, this.waypoints.length);
  }

  check(way) {
    for (let i = 0; i < this.waypoints.length; i++) if (this.waypoints[i] === way) return true;
    return false;
  }
}

class Aibot {
  constructor(owner) {
    this.owner = owner;
    // Реакция, поворот, точность — сделали ботов «человечнее»: реагируют дольше,
    // поворачиваются плавнее, стреляют реже.
    this.reaction_time = 350 + ((Math.random() * 450) | 0);
    this.angle_speed = 0.5 + Math.random() * 0.8;
    this.max_angle_speed = 0.5 + Math.random() * 0.8;
    this.accuracy = Math.random() * Math.random();
    // AI-кулдаун между выстрелами (помимо period оружия). Конкретный интервал
    // задаётся при каждом выстреле в STATE_HEAD_BOT.
    this.next_ai_shoot = 0;
    if (owner.nick === 'lyaguha') {
      this.reaction_time = 300;
      this.angle_speed = 1.2;
      this.max_angle_speed = 1.2;
      this.accuracy = 1;
    }
    this.aim_z = AIM_Z_CHEST;
    this.aim_z_until = 0;
  }

  update(dt) {
    let game = this.owner.game;
    let level = game.level;
    let AI = level.getAI();

    function stay(self) {
      self.owner.key_up = false;
      self.owner.key_left = false;
      self.owner.key_down = false;
      self.owner.key_right = false;
    }
    function moveTo(self, pos) {
      let dir = Vector.sub(pos, self.owner.dynent.pos);
      if (dir.length2() < 0.25 * 0.25) return dir;

      stay(self);

      dir.normalize().rotate(self.owner.dynent.angle);
      if (dir.x > Math.cos(Math.PI / 4 + Math.PI / 8)) self.owner.key_right = true;
      if (dir.x < -Math.cos(Math.PI / 4 + Math.PI / 8)) self.owner.key_left = true;
      if (dir.y < -Math.sin(Math.PI / 4 - Math.PI / 8)) self.owner.key_down = true;
      if (dir.y > Math.sin(Math.PI / 4 - Math.PI / 8)) self.owner.key_up = true;
      return null;
    }
    function angleTo(self, pos, koef) {
      let dir_to_pos = Vector.sub(pos, self.owner.dynent.pos);
      let angle = normalizeAngle(dir_to_pos.angle() - Math.PI / 2);
      let delta = normalizeAngle(angle - self.owner.dynent.angle);
      if (delta > Math.PI) delta = delta - 2 * Math.PI;
      koef = koef || self.angle_speed;
      let update_angle = delta * (koef / 20);
      if (update_angle > self.max_angle_speed / 20) update_angle = self.max_angle_speed / 20;
      if (update_angle < -self.max_angle_speed / 20) update_angle = -self.max_angle_speed / 20;
      self.owner.dynent.angle = normalizeAngle(self.owner.dynent.angle + (update_angle * dt) / 16);
      return delta;
    }
    function aimSpread(self) {
      return 0.45 + (1 - self.accuracy) * 0.55;
    }
    function pickAimZone(self) {
      const now = Date.now();
      if (now < self.aim_z_until) return self.aim_z;

      const spread = aimSpread(self);
      self.aim_z = AIM_Z_CHEST + (Math.random() * 2 - 1) * AIM_Z_CHEST_JITTER * spread;
      self.aim_z_until = now + 350 + ((Math.random() * 500) | 0);
      return self.aim_z;
    }
    function jitterTarget2d(self, pos) {
      const spread = aimSpread(self);
      const r = AIM_XY_SPREAD * spread;
      return new Vector(pos.x + (Math.random() * 2 - 1) * r, pos.y + (Math.random() * 2 - 1) * r);
    }
    function aimPitchTo(self, target2d, aimZ, koef) {
      const horiz = Vector.sub(target2d, self.owner.dynent.pos).length();
      if (horiz < 0.05) {
        self.owner.pitch = 0;
        return;
      }

      let targetPitch = Math.atan2(aimZ - SHOOTER_EYE_Z, horiz);
      const spread = 0.035 + (1 - self.accuracy) * 0.055;
      targetPitch += (Math.random() * 2 - 1) * spread;
      targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, targetPitch));

      koef = koef || self.angle_speed;
      let delta = targetPitch - (self.owner.pitch || 0);
      let updatePitch = delta * (koef / 20);
      const maxStep = self.max_angle_speed / 20;
      if (updatePitch > maxStep) updatePitch = maxStep;
      if (updatePitch < -maxStep) updatePitch = -maxStep;
      self.owner.pitch = (self.owner.pitch || 0) + (updatePitch * dt) / 16;
    }
    function decayPitch(self) {
      const p = self.owner.pitch || 0;
      if (Math.abs(p) < 0.002) {
        self.owner.pitch = 0;
        return;
      }
      const step = (self.max_angle_speed / 20) * (dt / 16);
      if (p > 0) self.owner.pitch = Math.max(0, p - step);
      else self.owner.pitch = Math.min(0, p + step);
    }
    function aimAt(self, target2d, aimZ, koef) {
      const delta = angleTo(self, target2d, koef);
      aimPitchTo(self, target2d, aimZ, koef);
      return delta;
    }
    function findItem(self) {
      let my_pos = self.owner.dynent.pos;
      let finded = false;
      let min_dir = 256 * 256;
      let item_priority = [];
      item_priority[ITEM.SPEED] = 1;
      item_priority[ITEM.QUAD] = 2;
      item_priority[ITEM.REGEN] = 3;
      let priority = item_priority[self.owner.power] || 0;

      if (self.item && self.item.alive) {
        min_dir = Vector.sub(my_pos, self.item.dynent.pos).length2();
        finded = true;
      }

      itemForEach(game, function (item) {
        let prior = item_priority[item.type] || 0;
        if (prior > 0 && prior < priority) return;
        if (
          cameraCulling(
            self.owner.dynent,
            item.dynent.pos,
            item.dynent.size,
            Aibot.OBJECT_VISIBLE_OFFSET_X,
            Aibot.OBJECT_VISIBLE_OFFSET_TOP,
            Aibot.OBJECT_VISIBLE_OFFSET_BOTTOM,
          )
        )
          return;

        let item_pos = item.dynent.pos;
        let len = Vector.sub(my_pos, item_pos).length2();

        if (len < min_dir && AI.isVisible(my_pos, item_pos, 1.5, AI.OBJECT_VISIBLE_DIST)) {
          min_dir = len;
          self.item = item;
          finded = true;
        }
      });
      return finded;
    }
    function botVisible(self, dynent) {
      if (
        cameraCulling(
          self.owner.dynent,
          dynent.pos,
          dynent.size,
          Aibot.OBJECT_VISIBLE_OFFSET_X,
          Aibot.OBJECT_VISIBLE_OFFSET_TOP,
          Aibot.OBJECT_VISIBLE_OFFSET_BOTTOM,
        )
      )
        return false;

      return AI.botVisible(self.owner.dynent.pos, dynent.pos);
    }
    function findBot(self) {
      if (self.bot) {
        if (botVisible(self, self.bot.dynent)) {
          self.bot_last_visible_time = Date.now();
          return true;
        }
        if (Date.now() < self.bot_last_visible_time + 500) return true;
      }

      for (let i = 0; i < game.bots.length; i++) {
        let bot = game.bots[i];
        if (bot === self.owner || !bot.alive) continue;

        if (botVisible(self, bot.dynent)) {
          self.bot_last_visible_time = Date.now();
          self.bot = bot;
          return true;
        }
      }
      return false;
    }
    function findShootedBot(self) {
      if (self.bot) return false;

      for (let i = 0; i < game.bots.length; i++) {
        let bot = game.bots[i];
        if (bot === self.owner || !bot.alive) continue;
        if (Date.now() > bot.last_shoot_time + 500) continue;

        if (AI.botVisible(self.owner.dynent.pos, bot.dynent.pos)) {
          self.shooted_bot = bot;
          return true;
        }
      }
      return false;
    }
    function findBullet(self) {
      let a = self.owner.dynent.pos;
      let v = self.owner.dynent.vel;
      let danger_pos = null;
      let danger_time = 5000;
      for (let i = 0; i < game.bullets.length; i++) {
        let bullet = game.bullets[i];
        if (bullet.ai_check && bullet.owner !== self.owner) {
          if (!botVisible(self, bullet.dynent)) continue;

          let b = bullet.dynent.pos;
          let w = bullet.dynent.vel;
          let t = (a.dot(w) + b.dot(v) - a.dot(v) - b.dot(w)) / Vector.sub(v, w).length2();
          let A = Vector.add(a, Vector.mul(v, t));
          let B = Vector.add(b, Vector.mul(w, t));
          let distance = Vector.sub(A, B).length2();

          let bullet_table = [0, 0, 0, 0.5, 3, WEAPON.RADIUS_ROCKET];

          let min_distance = bullet_table[bullet.type];
          if (distance < min_distance * min_distance && t < danger_time) {
            danger_time = t;
            danger_pos = B;
          }
        }
      }
      if (danger_pos) {
        self.danger_pos = danger_pos;
        return true;
      }
      return false;
    }
    function findObject(self) {
      let item_finded = findItem(self);
      let bot_finded = findBot(self);
      let bul_finded = findBullet(self);
      let shb_finded = findShootedBot(self);
      if (item_finded || bot_finded || bul_finded) {
        self.state = Aibot.STATE_CHECK_OBJECT;
      }

      if (bul_finded) {
        let my_pos = self.owner.dynent.pos;
        self.point = Vector.add(my_pos, Vector.sub(my_pos, self.danger_pos).normalize());
        self.state_move = Aibot.STATE_MOVE_TO_POINT_SAFE;
      } else if (item_finded) {
        self.point = new Vector(self.item.dynent.pos);
        self.state_move = Aibot.STATE_MOVE_TO_POINT;
      } else if (bot_finded) {
        self.state_move = Aibot.STATE_ATTACK;
      }

      if (bot_finded) {
        self.bot_point = {
          pos: new Vector(self.bot.dynent.pos),
          vel: new Vector(self.bot.dynent.vel),
          time: Date.now(),
        };
        self.state_head = Aibot.STATE_HEAD_BOT;
        let random_vector = new Vector(2 * Math.random() - 1, 2 * Math.random() - 1);
        random_vector.mul(3 * (1 - self.accuracy));
        self.bot_point.pos.add(random_vector);
      } else if (shb_finded) {
        self.state_head = Aibot.STATE_HEAD_SHOOTED;
        self.point_head = new Vector(self.shooted_bot.dynent.pos);
      } else if (item_finded) {
        self.state_head = Aibot.STATE_HEAD_POINT;
        self.point_head = self.point;
      }
      return item_finded || bot_finded || bul_finded;
    }
    function checkNext(self) {
      let ret = false;
      let my_pos = self.owner.dynent.pos;
      let dir_to_master = Vector.sub(my_pos, self.waypoint_master.pos);
      let len = dir_to_master.length2();
      if (len < 1 || AI.isVisible(my_pos, self.waypoint_next.pos)) {
        self.forbidden.push(self.waypoint_master);
        self.waypoint_master = self.waypoint_next;

        let radius = self.waypoint_master.isBridge() ? 1 : self.waypoint_master.dist;
        self.diff = new Vector(radius, 0).rotate(Math.PI * 2 * Math.random());
        chooseNext(self, false);
        ret = true;
      }
      return ret;
    }
    function getMostFronted(self, ways) {
      let pos = self.owner.dynent.pos;
      let dir = new Vector(-Math.sin(self.owner.dynent.angle), -Math.cos(self.owner.dynent.angle));
      let max_dot = -2;
      let way_with_max_dot = null;
      ways.forEach(function (way) {
        let to = Vector.sub(way.pos, pos).normalize();
        let dot = to.dot(dir);
        if (dot > max_dot) {
          max_dot = dot;
          way_with_max_dot = way;
        }
      });
      return way_with_max_dot;
    }
    function resetMaster(self, way) {
      self.waypoint_master = way;
      self.forbidden = new Forbidden(5);
      self.diff = null;
      chooseNext(self, true);
      self.state_move = Aibot.STATE_MOVE_TO_MASTER;
      self.state_head = Aibot.STATE_HEAD_SMOOTH_WAYPOINT;
      self.state = Aibot.STATE_CHECK_NEXT;
    }
    function resetState(self) {
      let ways = AI.getVisibleWaypoint(self.owner.dynent);
      if (ways.length > 0) {
        let way = getMostFronted(self, ways);
        Console.assert(way);
        resetMaster(self, way);
      } else {
        self.state = Aibot.STATE_FIND_MASTER;
      }
    }
    function chooseNext(self, fronted_next, protect) {
      let next = [];
      self.waypoint_master.next.forEach(function (n) {
        if (!self.forbidden.check(n)) next.push(n);
      });

      if (next.length === 0) {
        Console.assert(protect === undefined);
        self.forbidden.clear();
        chooseNext(self, fronted_next, 'protect');
      } else {
        if (fronted_next) {
          self.waypoint_next = getMostFronted(self, next);
        } else {
          let id = (Math.random() * next.length) | 0;
          self.waypoint_next = next[id];
        }
      }
    }
    function safeMove(self) {
      let pos = new Vector(self.owner.dynent.pos);
      let safe = level.getSafetyDir(pos);
      if (safe) {
        let dir = Vector.normalize(self.owner.dynent.vel);
        if (dir.dot(safe) > 0) {
          let random_vector = new Vector(2 * Math.random() - 1, 2 * Math.random() - 1).mul(0.5);
          safe.mul(-1).normalize().add(random_vector);
          pos.add(safe);
          return pos;
        }
      }
      return null;
    }
    function moveToPoint(self, point) {
      let dir = moveTo(self, point);
      if (dir) {
        point.add(dir.normalize());
      }
    }
    function chooseWeapon(self, prior_rocket = 5) {
      let prior = [0, 2, 3, 1, 4, prior_rocket];
      let type_with_max_prior = WEAPON.PISTOL;
      for (let w = WEAPON.PISTOL; w <= WEAPON.ROCKET; w++) {
        if (self.owner.weapon.patrons[w] > 0 && prior[w] > prior[type_with_max_prior]) {
          type_with_max_prior = w;
        }
      }
      self.owner.weapon.set(type_with_max_prior);
    }
    function calcDirection(a, b, v, len) {
      let A = v.length2() - len * len;
      let dir = Vector.sub(b, a);
      let B = 2 * v.dot(dir);
      let C = dir.length2();
      let D = B * B - 4 * A * C;
      if (D < 0) return 0;
      let sqrtD = Math.sqrt(D);
      let t = (-B - sqrtD) / (2 * A);
      return t;
    }

    let ai_update = false;
    if (Date.now() > this.reaction) {
      ai_update = true;
      this.reaction = Date.now() + this.reaction_time;
    }

    switch (this.state) {
      case Aibot.STATE_AFTER_RESPAWN: {
        this.state_move = Aibot.STATE_MOVE_STAY;
        this.state_head = Aibot.STATE_HEAD_STAY;
        if (ai_update) {
          this.state = Aibot.STATE_FIND_MASTER;
        }
        break;
      }
      case Aibot.STATE_FIND_MASTER: {
        this.state_move = Aibot.STATE_MOVE_GRADIENT;
        this.state_head = Aibot.STATE_HEAD_FRONT;
        let ways = AI.getVisibleWaypoint(this.owner.dynent);
        if (ways.length > 0) {
          let id = (Math.random() * ways.length) | 0;
          resetMaster(this, ways[id]);
        } else if (ai_update) {
          findObject(this);
        }
        break;
      }
      case Aibot.STATE_CHECK_NEXT: {
        checkNext(this);
        if (ai_update) {
          findObject(this);
        }
        break;
      }
      case Aibot.STATE_CHECK_OBJECT: {
        if (ai_update) {
          if (this.bot && !this.bot.alive) {
            this.bot = null;
          }
          if (this.item && !this.item.alive) {
            this.item = null;
          }
          if (!findObject(this)) {
            resetState(this);
          }
          chooseWeapon(this);
        }
        break;
      }
    }

    switch (this.state_move) {
      case Aibot.STATE_MOVE_STAY:
        stay(this);
        break;
      case Aibot.STATE_MOVE_TO_MASTER: {
        let vec = new Vector(this.waypoint_master.pos);
        if (this.diff) {
          let dir = Vector.sub(vec, this.owner.dynent.pos);
          let len = dir.length() - 1;
          let radius = this.diff.length();
          if (len < radius) {
            vec.add(Vector.mul(this.diff, len / radius));
          }
        }
        moveTo(this, vec);
        break;
      }
      case Aibot.STATE_MOVE_TO_POINT: {
        moveToPoint(this, this.point);
        break;
      }
      case Aibot.STATE_MOVE_TO_POINT_SAFE: {
        let pos = safeMove(this);
        if (pos) this.point = pos;
        moveToPoint(this, this.point);
        break;
      }
      case Aibot.STATE_MOVE_GRADIENT: {
        let my_pos = new Vector(this.owner.dynent.pos);
        let grad = AI.getGradient(my_pos);
        my_pos.add(grad);
        moveTo(this, my_pos);
        break;
      }
      case Aibot.STATE_ATTACK: {
        if (Date.now() > this.attack_time) {
          this.attack_time = Date.now() + 500 + 1500 * Math.random();
          let my_pos = this.owner.dynent.pos;
          let dir = Vector.sub(this.bot_point.pos, my_pos).binormalize();
          if (Math.random() < 0.5) dir.mul(-1);
          this.attack_point = Vector.add(my_pos, dir);
        }
        let pos = safeMove(this);
        if (pos) this.attack_point = pos;
        Console.assert(this.attack_point);
        moveToPoint(this, this.attack_point);
        break;
      }
    }

    this.owner.shoot = false;
    switch (this.state_head) {
      case Aibot.STATE_HEAD_STAY:
        decayPitch(this);
        break;
      case Aibot.STATE_HEAD_FRONT: {
        let pos = Vector.add(this.owner.dynent.pos, this.owner.direction);
        aimAt(this, pos, AIM_Z_CHEST, 0.75);
        break;
      }
      case Aibot.STATE_HEAD_WAYPOINT: {
        let pos = this.waypoint_next ? this.waypoint_next.pos : this.waypoint_master.pos;
        aimAt(this, pos, AIM_Z_CHEST);
        break;
      }
      case Aibot.STATE_HEAD_SMOOTH_WAYPOINT: {
        let pos = this.waypoint_next ? this.waypoint_next.pos : this.waypoint_master.pos;
        let delta = aimAt(this, pos, AIM_Z_CHEST, 0.75);
        if (Math.abs(delta) < Math.PI / 6) this.state_head = Aibot.STATE_HEAD_WAYPOINT;
        break;
      }
      case Aibot.STATE_HEAD_POINT: {
        aimAt(this, jitterTarget2d(this, this.point_head), pickAimZone(this), 0.75);
        break;
      }
      case Aibot.STATE_HEAD_SHOOTED: {
        let delta = aimAt(this, jitterTarget2d(this, this.point_head), pickAimZone(this));
        if (Math.abs(delta) < Math.PI / 12) {
          if (this.waypoint_next || this.waypoint_master)
            this.state_head = Aibot.STATE_HEAD_SMOOTH_WAYPOINT;
          else {
            Console.error('Wyapoint == null');
            this.state_head = Aibot.STATE_HEAD_FRONT;
          }
        }
        break;
      }
      case Aibot.STATE_HEAD_BOT: {
        let my_pos = this.owner.dynent.pos;
        let delta = Date.now() - this.bot_point.time;
        let bot_speed = Vector.mul(this.bot_point.vel, delta);
        let bot_pos = Vector.add(this.bot_point.pos, bot_speed);

        if (this.owner.weapon.type >= WEAPON.PLASMA) {
          let t = calcDirection(
            my_pos,
            bot_pos,
            this.bot_point.vel,
            WEAPON.wea_tabl[this.owner.weapon.type].vel,
          );
          let new_bot_pos = Vector.add(bot_pos, Vector.mul(this.bot_point.vel, t));
          if (AI.isVisible(new_bot_pos, bot_pos, 1.5)) bot_pos = new_bot_pos;
        }

        const aimZ = pickAimZone(this);
        let delta_angle = aimAt(this, jitterTarget2d(this, bot_pos), aimZ, this.angle_speed * 3);
        let need_shoot = false;
        if (this.owner.weapon.type === WEAPON.SHAFT) {
          need_shoot = delta_angle > -0.32 && delta_angle < 0.22;
        } else {
          let my_dir = new Vector(
            Math.sin(this.owner.dynent.angle),
            Math.cos(this.owner.dynent.angle),
          );
          let dir_to_bot = Vector.sub(bot_pos, my_pos);
          let binorm = Vector.normalize(dir_to_bot).binormalize();
          let rast = binorm.dot(my_dir) * dir_to_bot.length();

          let bullet_table = [
            { left: -0.8, right: 0.4 },
            { left: -1.5, right: 1 },
            { left: -0.8, right: 0.4 },
            { left: -0.88, right: 0.37 },
            { left: -1.3, right: 0.7 },
            { left: -1.3, right: 0.7 },
          ];

          let bullet_table_elem = bullet_table[this.owner.weapon.type];
          need_shoot = rast > bullet_table_elem.left && rast < bullet_table_elem.right;
          if (
            this.owner.weapon.type === WEAPON.ROCKET &&
            dir_to_bot.length() < WEAPON.RADIUS_ROCKET
          ) {
            chooseWeapon(this, -1);
            need_shoot = true;
          }
        }

        if (need_shoot) {
          // Дополнительная AI-задержка между выстрелами — чтобы боты стреляли
          // не так часто, как только что прицелились. Зависит от accuracy:
          // высокая точность → короче пауза, низкая → дольше.
          const now = Date.now();
          if (now >= this.next_ai_shoot) {
            this.owner.shoot = AI.botVisible(this.owner.dynent.pos, [bot_pos.x, bot_pos.y]);
            if (this.owner.shoot) {
              const base = 380;
              const variance = 360 + (1 - this.accuracy) * 320;
              this.next_ai_shoot = now + base + Math.random() * variance;
            }
          } else {
            this.owner.shoot = false;
          }
        }
        break;
      }
    }

    // ── СТОП-НА-ВЫСТРЕЛ ─────────────────────────────────────────────────
    // Как в Quake 2 (cl_pmove/anim): пока проигрывается анимация выстрела,
    // бот замирает на месте и не бежит. На каждый «жмак» курка обновляем
    // окно заморозки на длительность attack-анимации, и в этом окне
    // принудительно гасим клавиши движения, какими бы их ни выставил
    // предыдущий шаг (move-state, стрейф во время атаки).
    {
      const now = Date.now();
      if (this.owner.shoot) {
        // ~8 кадров anim.fps=15 ≈ 530 мс; для медленных пушек берём
        // длительность их «outlay» из таблицы, но не больше 600 мс,
        // чтобы бот не превращался в неподвижную мишень.
        const lifetime = WEAPON.wea_tabl[this.owner.weapon.type].lifetime || 0;
        const hold = Math.min(600, Math.max(400, lifetime));
        this.shoot_freeze_until = now + hold;
      }
      if (this.shoot_freeze_until && now < this.shoot_freeze_until) {
        this.owner.key_up = false;
        this.owner.key_down = false;
        this.owner.key_left = false;
        this.owner.key_right = false;
      }
    }
  }
}

Event.on('botrespawn', function (bot) {
  if (bot.ai) {
    bot.ai.state = Aibot.STATE_AFTER_RESPAWN;
    bot.ai.state_move = Aibot.STATE_MOVE_STAY;
    bot.ai.state_head = Aibot.STATE_HEAD_STAY;
    bot.ai.reaction = Date.now() + bot.ai.reaction_time;
    bot.ai.item = null;
    bot.ai.bot = null;
    bot.ai.bot_last_visible_time = 0;
    bot.ai.shooted_bot = null;
    bot.ai.danger_pos = null;
    bot.ai.shoot_freeze_until = 0;
    bot.ai.point = null;
    bot.ai.bot_point = null;
    bot.ai.waypoint_master = null;
    bot.ai.waypoint_next = null;
    bot.ai.diff = null;
    bot.ai.forbidden = null;
    bot.ai.attack_time = 0;
    bot.ai.attack_point = null;
    bot.ai.aim_z = AIM_Z_CHEST;
    bot.ai.aim_z_until = 0;
    bot.pitch = 0;
  }
});

Aibot.OBJECT_VISIBLE_OFFSET_X = 9;
Aibot.OBJECT_VISIBLE_OFFSET_TOP = 9;
Aibot.OBJECT_VISIBLE_OFFSET_BOTTOM = -0.5;

//think
Aibot.STATE_AFTER_RESPAWN = 0;
Aibot.STATE_FIND_MASTER = 1;
Aibot.STATE_CHECK_NEXT = 2;
Aibot.STATE_CHECK_OBJECT = 3;

//movement
Aibot.STATE_MOVE_STAY = 0;
Aibot.STATE_MOVE_TO_MASTER = 1;
Aibot.STATE_MOVE_TO_POINT = 2;
Aibot.STATE_MOVE_TO_POINT_SAFE = 3;
Aibot.STATE_MOVE_GRADIENT = 4;
Aibot.STATE_ATTACK = 5;

//head
Aibot.STATE_HEAD_STAY = 0;
Aibot.STATE_HEAD_FRONT = 1;
Aibot.STATE_HEAD_WAYPOINT = 2;
Aibot.STATE_HEAD_SMOOTH_WAYPOINT = 3;
Aibot.STATE_HEAD_POINT = 4;
Aibot.STATE_HEAD_SHOOTED = 5;
Aibot.STATE_HEAD_BOT = 6;

export { Aibot };
