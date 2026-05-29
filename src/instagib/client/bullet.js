import { config } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { WEAPON, ITEM } from '../server/game/global.js';
import { Event } from '../server/libs/event.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent } from '../server/objects/dynent.js';

class BulletClient {
  constructor(type, pos, angle, power, id, pitch = 0, z) {
    this.type = type;
    this.power = power;
    this.id = id;
    this.pitch = pitch;
    this.dynent = new Dynent(pos, [1, 1], angle);

    const norm_dir = new Vector(-Math.sin(angle), -Math.cos(angle));
    const cos_p = Math.cos(pitch);
    const sin_p = Math.sin(pitch);
    const speed = WEAPON.wea_tabl[type].vel;
    this.dynent.vel = Vector.mul(norm_dir, speed * cos_p);
    this.vz = speed * sin_p;
    this.z = z !== undefined ? z : 1.4;

    this.dead = Date.now() + WEAPON.wea_tabl[type].lifetime;
    this.last_update = Date.now();
  }

  update() {
    const now = Date.now();
    const delta = now - this.last_update;
    this.last_update = now;

    if (now > this.dead) return false;

    if (this.type === WEAPON.PISTOL || this.type >= WEAPON.PLASMA) {
      this.dynent.update(delta);
      this.z += this.vz * delta;

      // Те же 3D-границы, что и на сервере: чтобы клиент не «таскал» снаряд
      // в небо — иначе следующий BULLET_DEAD будет в нелепой точке Z.
      if (this.z < 0 || this.z > 4.0) return false;

      const level = state.gameClient.getLevelRender().getLevel();
      if (this.type === WEAPON.ZENIT) {
        const norm = new Vector(0, 0);
        const tile = level.getNorm(norm, this.dynent.pos);
        if (tile > 128) {
          norm.normalize();
          const dot = norm.dot(this.dynent.vel);
          if (dot > 0) {
            const reflect = norm.mul(2 * dot);
            this.dynent.vel.sub(reflect);
            this.dynent.angle = this.dynent.vel.angle() - Math.PI / 2;
          }
        }
      } else if (level.getCollide(this.dynent.pos) > 128) {
        return false;
      }

      if (this.type === WEAPON.ROCKET) {
        if (state.Q2FX) state.Q2FX.rocketTrail(this.dynent.pos, this.z);
      } else if (this.type === WEAPON.PLASMA && state.Q2FX) {
        state.Q2FX.plasmaTrail(this.dynent.pos, this.power === ITEM.QUAD, this.z);
      } else if (this.type === WEAPON.ZENIT && state.Q2FX) {
        state.Q2FX.zenitTrail(this.dynent.pos, this.z);
      } else if (this.type === WEAPON.PISTOL && state.Q2FX && state.Q2FX.blasterTrail) {
        state.Q2FX.blasterTrail(this.dynent.pos, this.power === ITEM.QUAD, this.z);
      }
    }
    return true;
  }

  render(camera) {
    if (state.Q2FX && state.Q2FX.projectileGlow(camera, this)) return;

    if (this.type === WEAPON.ZENIT) {
      let alpha = (this.dead - Date.now()) / 250;
      if (alpha > 1) alpha = 1;
      this.dynent.render(
        camera,
        state.Weapon.skins[this.type].bullet,
        state.Weapon.shader_noshadow_color,
        {
          vectors: [
            { location: state.Weapon.shader_noshadow_color.color, vec: [1, 1, 1, alpha] },
          ],
        },
      );
    } else if (this.power === ITEM.QUAD && this.type === WEAPON.PLASMA) {
      this.dynent.size.set(1.5, 1.5);
      this.dynent.render(
        camera,
        state.Weapon.skins[this.type].bullet_quad,
        state.Weapon.shader_noshadow_color,
        {
          vectors: [
            { location: state.Weapon.shader_noshadow_color.color, vec: [1, 1, 1, 2.5] },
          ],
        },
      );
    } else {
      this.dynent.render(
        camera,
        state.Weapon.skins[this.type].bullet,
        state.Weapon.shader_noshadow,
      );
    }
  }
}

class BulletLine {
  constructor(type, pos, angle, power, size_y, dest, pitch = 0, dest_z = 1.4) {
    this.type = type;
    this.power = power;
    this.pitch = pitch;
    this.dest_z = dest_z;
    this.dynent = new Dynent(pos, [0.5, size_y], angle);
    this.dest = dest;

    this.norm_dir = new Vector(-Math.sin(angle), -Math.cos(angle));

    this.dead = Date.now() + WEAPON.wea_tabl[type].lifetime;
  }

  update() {
    return Date.now() < this.dead;
  }

  render() {
    // В 3D режиме хитсканы рисуются как лазерный луч в Q2FX и динамические лайты;
    // BulletLine остаётся «логическим» снарядом без собственного спрайта.
  }
}

class BulletShaft {
  constructor(pos, angle, power, size_y, dest, norm_dir, nap, ownerid, time) {
    this.type = WEAPON.SHAFT;
    this.power = power;
    this.dynent = new Dynent(pos, [0.5, size_y], angle);
    this.dest = dest;
    this.nap = nap;
    this.ownerid = ownerid;
    this.norm_dir = norm_dir;
    this.sound = null;
    this.time = time;
    this.my_time = Date.now();
    this.del = false;

    this.new_bul = this;
    this.old_bul = this;
  }

  addBullet(bullet) {
    this.del = false;
    this.power = bullet.power;
    this.sound = bullet.sound;
    this.my_time = Date.now();

    this.old_bul = this.new_bul;
    this.new_bul = bullet;
  }

  update() {
    const new_time = this.new_bul.time;
    const old_time = this.old_bul.time;
    const update_server_time = parseInt(config.get('game-server:update-time'));
    const current_time = new_time + (Date.now() - this.my_time) - update_server_time;
    let koef = (current_time - old_time) / (new_time - old_time);
    if (koef < 0) koef = 0;

    if (this.new_bul !== this.old_bul && this.old_bul !== this) {
      this.dynent.interpolate(this.old_bul.dynent, this.new_bul.dynent, koef);
      this.dynent.size.interpolate(this.old_bul.dynent.size, this.new_bul.dynent.size, koef);
      this.dest.interpolate(this.old_bul.dest, this.new_bul.dest, koef);
      this.nap.interpolate(this.old_bul.nap, this.new_bul.nap, koef);
      this.norm_dir.interpolate(this.old_bul.norm_dir, this.new_bul.norm_dir, koef);
    }

    const bot = state.gameClient.getBotById(this.ownerid);
    if (bot) {
      const Y = 0.9;
      const angle = bot.dynent.angle;
      const sina = Math.sin(angle);
      const cosa = Math.cos(angle);
      const position = Vector.add2(
        bot.dynent.pos,
        cosa * 0.25 - sina * Y,
        -cosa * Y - sina * 0.25,
      );

      this.dynent.pos.copy(position);
      this.norm_dir.set(-sina, -cosa);
      this.nap = Vector.sub(this.dest, position);
      this.dynent.angle = this.nap.angle() - Math.PI / 2;

      const len = this.nap.length();
      this.dynent.pos.add(this.dest).mul(0.5);
      this.dynent.size.set(0.5, len);
    }

    Event.emit('cl_bulletlinecollide', this, this.dest, this.norm_dir);

    if (this.del) {
      state.Weapon.skins[this.type].snd_shoot.snd.stop(this.sound);
    }
    return !this.del;
  }

  render() {
    if (!state.Q2FX || Math.random() >= 0.45) return;
    const owner_x = this.dynent.pos.x * 2 - this.dest.x;
    const owner_z = this.dynent.pos.y * 2 - this.dest.y;
    const sin_a = Math.sin(this.dynent.angle);
    const cos_a = Math.cos(this.dynent.angle);
    const sx = owner_x + (-sin_a * 0.9) + (cos_a * 0.25);
    const sz = owner_z + (-cos_a * 0.9) + (-sin_a * 0.25);
    const c = this.power === ITEM.QUAD
      ? [1.4, 0.5, 0.5, 1]
      : [0.5, 0.75, 1.4, 1];
    const eyeH = (state.LevelRender && state.LevelRender.eye_height) || 1.6;
    const start_y = eyeH - 0.15;
    const end_y = this.dest_z !== undefined && this.dest_z > 0 ? this.dest_z : start_y;
    state.Q2FX.shaftBeam(sx, sz, this.dest.x, this.dest.y, c, start_y, end_y);
  }
}

BulletClient.bullets = [];
BulletLine.bullets = [];
BulletShaft.bullets = [];

BulletClient.remove = function (bullet_id, pos, z) {
  for (let i = 0; i < BulletClient.bullets.length; i++) {
    if (BulletClient.bullets[i].id === bullet_id) {
      const bullet = BulletClient.bullets[i];
      // Серверная точка смерти точнее, чем клиентская экстраполяция:
      // используем её, чтобы декаль/частицы появились в правильной 3D-точке.
      if (pos) {
        bullet.dynent.pos.x = pos.x;
        bullet.dynent.pos.y = pos.y;
      }
      if (typeof z === 'number') bullet.z = z;
      Event.emit('cl_bulletdead', bullet);
      return BulletClient.bullets.splice(i, 1);
    }
  }
};

BulletClient.create = function (bullet) {
  if (bullet.bullet_type === WEAPON.ZENIT) BulletClient.remove(bullet.bulletid);
  const bc = new BulletClient(
    bullet.bullet_type,
    bullet.pos,
    bullet.angle,
    bullet.power,
    bullet.bulletid,
    bullet.pitch || 0,
    bullet.z,
  );
  BulletClient.bullets.push(bc);
  Event.emit('cl_bulletshoot', bc);
  if (bullet.sound) {
    const id = state.Weapon.skins[bullet.bullet_type].snd_shoot.play(bullet.pos);
    if (bullet.power === ITEM.QUAD) {
      state.Weapon.skins[bullet.bullet_type].snd_shoot.snd.rate(2, id);
    }
  }
};

Event.on('frame', () => {
  BulletShaft.bullets.forEach((bullet) => {
    bullet.del = true;
  });
});

BulletShaft.create = function (server_time, bullet) {
  const bul = new BulletShaft(
    bullet.pos,
    bullet.angle,
    bullet.power,
    bullet.size_y,
    bullet.dest,
    bullet.norm_dir,
    bullet.nap,
    bullet.ownerid,
    server_time,
  );
  for (let i = 0; i < BulletShaft.bullets.length; i++) {
    if (BulletShaft.bullets[i].ownerid === bullet.ownerid) {
      bul.sound = BulletShaft.bullets[i].sound;
      state.Weapon.skins[bul.type].snd_shoot.volume(bul.dynent.pos, bul.sound);
      if (bul.power === ITEM.QUAD) {
        state.Weapon.skins[bul.type].snd_shoot.snd.rate(2, bul.sound);
      } else {
        state.Weapon.skins[bul.type].snd_shoot.snd.rate(1, bul.sound);
      }
      BulletShaft.bullets[i].addBullet(bul);
      return;
    }
  }
  bul.sound = state.Weapon.skins[bul.type].snd_shoot.play(bul.dynent.pos);
  BulletShaft.bullets.push(bul);
};

BulletLine.create = function (server_time, bullet) {
  if (bullet.bullet_type === WEAPON.SHAFT) return BulletShaft.create(server_time, bullet);

  const bul = new BulletLine(
    bullet.bullet_type,
    bullet.pos,
    bullet.angle,
    bullet.power,
    bullet.size_y,
    bullet.dest,
    bullet.pitch || 0,
    bullet.dest_z,
  );
  BulletLine.bullets.push(bul);
  const norm_dir = new Vector(-Math.sin(bullet.angle), -Math.cos(bullet.angle));
  Event.emit('cl_bulletlinecollide', bul, bullet.dest, norm_dir);
  Event.emit('cl_lineshoot', bul);
};

function renderBullets(camera, bullets, need_emit) {
  for (let index = 0; index < bullets.length; ) {
    const bullet = bullets[index];
    if (bullet.update()) {
      bullet.render(camera);
      index++;
    } else {
      if (need_emit) Event.emit('cl_bulletdead', bullet);
      bullets.splice(index, 1);
    }
  }
}

BulletClient.render = function (camera) {
  const gl = state.gl;
  gl.enable(gl.BLEND);
  renderBullets(camera, BulletClient.bullets, true);
  renderBullets(camera, BulletLine.bullets, false);
  renderBullets(camera, BulletShaft.bullets, false);
  gl.disable(gl.BLEND);
};

// Параметры свечения снарядов вдоль их траектории — вызывается каждый кадр
// ПЕРЕД рендером уровня, чтобы лайты успели попасть в шейдеры пола/стен.
const PROJECTILE_LIGHTS = {
  [WEAPON.PISTOL]: { color: [1.0, 0.95, 0.35], intensity: 1.2, radius: 4.5 },
  [WEAPON.PLASMA]: { color: [0.45, 0.75, 1.6], intensity: 1.3, radius: 5.5 },
  [WEAPON.ROCKET]: { color: [1.6, 0.7, 0.25], intensity: 1.4, radius: 6.5 },
  [WEAPON.ZENIT]:  { color: [1.0, 0.4, 1.4],  intensity: 1.1, radius: 5.0 },
};
BulletClient.collectLights = function (levelRender) {
  if (!levelRender || !levelRender.addDynamicLight) return;
  // Живые снаряды — наивысший приоритет (priority=2).
  for (let i = 0; i < BulletClient.bullets.length; i++) {
    const b = BulletClient.bullets[i];
    const spec = PROJECTILE_LIGHTS[b.type];
    if (!spec) continue;
    const z = b.z !== undefined ? b.z : 1.4;
    levelRender.addDynamicLight(
      b.dynent.pos.x, z, b.dynent.pos.y,
      spec.color, spec.intensity, spec.radius, 2);
  }
  // BulletLine — короткоживущие хитсканы: пара вспышек у дула и точки попадания.
  // Приоритет 1 — ниже снарядов, но выше факелов.
  const now = Date.now();
  for (let i = 0; i < BulletLine.bullets.length; i++) {
    const b = BulletLine.bullets[i];
    const lifetime = WEAPON.wea_tabl[b.type].lifetime;
    const elapsed = lifetime - (b.dead - now);
    const fade = Math.max(0, 1 - elapsed / 120);
    if (fade <= 0) continue;
    const muzzle_color = b.type === WEAPON.RAIL ? [1.2, 0.5, 1.4] : [1.0, 0.9, 0.4];
    levelRender.addDynamicLight(
      b.dynent.pos.x, 1.4, b.dynent.pos.y,
      muzzle_color, 1.4 * fade, 4.0, 1);
    if (b.dest) {
      levelRender.addDynamicLight(
        b.dest.x, b.dest_z || 1.4, b.dest.y,
        muzzle_color, 0.9 * fade, 3.5, 1);
    }
  }
};

state.BulletClient = BulletClient;
state.BulletLine = BulletLine;
