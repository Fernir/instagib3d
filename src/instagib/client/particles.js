import { Shader } from '../engine/shader.js';
import { Texture } from '../engine/texture.js';
import { Console } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { WEAPON, ITEM } from '../server/game/global.js';
import { Buffer } from '../server/libs/buffer.js';
import { Event } from '../server/libs/event.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent } from '../server/objects/dynent.js';

//dir - Vector
class Particle {
  constructor(type, pos, dir) {
    this.dynent = new Dynent(pos, [1, 1], Math.random() * Math.PI * 2);
    this.type = type;
    this.time = Date.now();
    this.lifetime = 400;

    if (type == Particle.RESPAWN) {
      this.dynent.size.set(1.5, 1.5);
      this.lifetime = 500;
    } else if (type & Particle.SPARK) {
      this.dynent.angle = dir.angle() - Math.PI / 2;
      let nap = Vector.mul(dir, 0.5);
      this.dynent.pos.add(nap);
      this.dynent.size.set(2, 2);
      this.lifetime = 300;
      if (Math.random() < 0.5) this.dynent.size.x *= -1;
    } else if (type & Particle.SPLASH) {
      if (type === Particle.SPLASH_LAVA) {
        this.dynent.size.set(2, 2);
        this.lifetime = 400;
      } else if (type === Particle.SPLASH_LAVA_SMALL) {
        this.dynent.size.set(1, 1);
        this.lifetime = 200;
      } else {
        this.dynent.size.set(4, 4);
        this.lifetime = 500;
      }
    }
  }

  update() {
    return Date.now() - this.time <= this.lifetime;
  }

  render(camera) {
    let time = Date.now();
    if (this.type === Particle.RESPAWN) {
      let kadr = (((time - this.time) * 16) / this.lifetime) | 0;
      if (kadr > 16 - 1) kadr = 16 - 1;
      let sx = (3 - ((kadr % 4) | 0)) / 4.0;
      let sy = 1 - ((kadr / 4) | 0) * 0.25;
      let a = (15 - kadr) / 8;
      state.gl.blendFunc(state.gl.ONE, state.gl.ONE);
      this.dynent.render(camera, Particle.tex_respawn, Particle.shader_respawn, {
        vectors: [
          { location: Particle.shader_respawn.dtc, vec: [sx, sy - 0.25, 0, 0] },
          { location: Particle.shader_respawn.color, vec: [1.5 * a, 1.5 * a, 3 * a, 1] },
        ],
      });
      state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);
    } else if (this.type & (Particle.SPARK | Particle.SPLASH)) {
      let alpha = (time - this.time) / this.lifetime;
      let kadr = (((time - this.time) * Particle.COUNT_KADR) / this.lifetime) | 0;
      if (kadr > Particle.COUNT_KADR - 1) kadr = Particle.COUNT_KADR - 1;
      if (kadr < 0) {
        Console.error('Invalid kadr', kadr, '; Date.now =', time, '; this.time =', this.time);
        kadr = 0;
      }

      let color = [1, 1, 1, 1 - alpha];
      let koef = [0, 0.5, 2, 0];
      let tex = Particle.spark_textures[kadr];
      if (this.type === Particle.SPARK) koef = [0.2, 0.4, 4, 0.2];
      if (this.type & Particle.SPLASH) {
        tex = Particle.splash_textures[kadr];
        koef = [0, 0.5, 2, 0];
        if (this.type & (Particle.SPLASH_LAVA | Particle.SPLASH_LAVA_SMALL)) {
          state.gl.blendFunc(state.gl.ONE, state.gl.ONE);
          color = [10 - 10 * alpha, 3 - 3 * alpha, 1 - alpha, 0];
          koef = [0, 0.2, 5, 0];
        }
      }

      this.dynent.render(camera, tex, Particle.shader_particle, {
        vectors: [
          { location: Particle.shader_particle.color, vec: color },
          { location: Particle.shader_particle.koef, vec: koef },
        ],
      });
      if (this.type & (Particle.SPLASH_LAVA | Particle.SPLASH_LAVA_SMALL)) {
        state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);
      }
    }
  }
}


Event.on('cl_botdead', function (pos) {
  // Кровь — Q2FX.bloodBurst (3D) + лужа в decal.js; здесь только лавовый всплеск.
  const level = state.gameClient.getLevelRender().getLevel();
  if (level.collideLava(pos) && !level.getCollideBridges(pos)) {
    Particle.create(Particle.SPLASH_LAVA, pos, null, 1);
  }
});

Event.on('cl_bulletlinecollide', function (bullet, dest, norm_dir) {
  if (bullet.type === WEAPON.PISTOL) {
    let level = state.gameClient.getLevelRender().getLevel();
    if (level.collideLava(dest) && !level.getCollideBridges(dest)) {
      Particle.create(Particle.SPLASH_LAVA_SMALL, dest, null, 1);
      //guano
    } else {
      let norm = new Vector(norm_dir);
      let tile = level.getCollide(dest);
      if (tile > 100) norm.mul(-1);
      Particle.create(Particle.SPARK, dest, norm, 1);
      let rnd = (Math.random() * 3) | 0;
      state.Weapon.snd_ric[rnd].play(dest);
    }
  }
});

// Видна ли точка для камеры (не за стеной). Звук/декаль рисуем всегда —
// прячем только видимый спрайт взрыва.
function explosionVisible(pos) {
  const cam = state.gameClient && state.gameClient.getCamera ? state.gameClient.getCamera() : null;
  const lr = state.LevelRender;
  if (!cam || !cam.dynent || !lr || !lr.hasLineOfSight) return true;
  return lr.hasLineOfSight(cam.dynent.pos, pos);
}

Event.on('cl_bulletdead', function (bullet) {
  if (bullet.type == WEAPON.PLASMA) {
    let level = state.gameClient.getLevelRender().getLevel();
    if (level.collideLava(bullet.dynent.pos) && !level.getCollideBridges(bullet.dynent.pos)) {
      if (explosionVisible(bullet.dynent.pos))
        Particle.create(Particle.SPLASH_LAVA_SMALL, bullet.dynent.pos, null, 1);
      //guano
    } else {
      let isQuad = bullet.power === ITEM.QUAD;
      // Взрыв рисует Q2FX (процедурный WebGL-фаербол) — спрайт explode.png убран.
      state.Decal.render_decal(
        {
          pos: bullet.dynent.pos,
          pos_z: bullet.z,
          dir: bullet.dynent && bullet.dynent.vel ? bullet.dynent.vel : null,
          angle: Math.random() * Math.PI * 2,
          size: isQuad ? new Vector(1.5, 1.5) : new Vector(1, 1),
        },
        state.Weapon.tex_decal,
        [0, 0, 0, 1],
      );
      state.Weapon.snd_grenade.play(bullet.dynent.pos);
    }
  } else if (bullet.type == WEAPON.ROCKET) {
    // Взрыв рисует Q2FX (процедурный WebGL-фаербол) — спрайт explode.png убран.
    state.Decal.render_decal(
      {
        pos: bullet.dynent.pos,
        pos_z: bullet.z,
        dir: bullet.dynent && bullet.dynent.vel ? bullet.dynent.vel : null,
        angle: Math.random() * Math.PI * 2,
        size: new Vector(3, 3),
      },
      state.Weapon.tex_decal,
      [0, 0, 0, 1],
    );
    state.Weapon.snd_explode.play(bullet.dynent.pos);
  }
});

// static methods

Particle.ready = function () {
  return Particle.tex_respawn.ready();
};

Particle.load = function () {
  Particle.COUNT_KADR = 32;

  function create_spark() {
    let time = Date.now();
    const COUNT_PART = 32;
    const SIZE = 64;
    const LENGTH = 8;

    let ret = [];
    let pos = new Array(COUNT_PART);
    let vel = new Array(COUNT_PART);
    let len = new Array(COUNT_PART);

    for (let i = 0; i < COUNT_PART; i++) {
      let sx = (Math.random() * 2 - 1) * 0.75;
      let sy = -(1 + Math.random()) * 0.75;
      let px = SIZE / 2 + Math.random() * sx * 16 + sx;
      let py = SIZE - 12 + sy;
      pos[i] = new Vector(px, py);
      vel[i] = new Vector(sx, sy);
      len[i] = (Math.random() + 0.5) * LENGTH;
    }

    for (let i = 0; i < Particle.COUNT_KADR; i++) {
      let buf = new Buffer(SIZE);
      for (let j = 0; j < COUNT_PART; j++) {
        let x = pos[j].x | 0;
        let y = pos[j].y | 0;
        buf.bresenham(x, y, (x - vel[j].x * len[j]) | 0, (y - vel[j].y * len[j]) | 0, 1);
        pos[j].add(vel[j]);
      }
      let blured_buf = buf.getGaussian(5);
      let clamped_buf = new Buffer(SIZE);
      clamped_buf.copy(blured_buf);
      clamped_buf.clamp(0, 0.2).normalize(0, 1);
      ret.push(
        Buffer.create_texture(clamped_buf, blured_buf, blured_buf, blured_buf, {
          wrap: state.gl.CLAMP_TO_EDGE,
        }),
      );
    }
    Console.info('Create spark = ', Date.now() - time);
    return ret;
  }
  function create_splash() {
    let time = Date.now();
    const COUNT_PART = 128;
    const SIZE = 64;
    const LENGTH = 16;

    let ret = [];
    let pos = new Array(COUNT_PART);
    let vel = new Array(COUNT_PART);
    let len = new Array(COUNT_PART);

    for (let i = 0; i < COUNT_PART; i++) {
      let sx = Math.random() * 2 - 1;
      let sy = Math.random() * 2 - 1;
      let px = SIZE / 2 + Math.random() * sx * 16 + sx;
      let py = SIZE / 2 + Math.random() * sy * 16 + sy;
      pos[i] = new Vector(px, py);
      vel[i] = new Vector(sx, sy).normalize().mul(0.6);
      len[i] = LENGTH;
    }

    for (let i = 0; i < Particle.COUNT_KADR; i++) {
      let buf = new Buffer(SIZE);
      for (let j = 0; j < COUNT_PART; j++) {
        let x = pos[j].x | 0;
        let y = pos[j].y | 0;
        let koef = ((Particle.COUNT_KADR - i) / Particle.COUNT_KADR) * 2;
        buf.bresenham(x, y, (x - vel[j].x * len[j]) | 0, (y - vel[j].y * len[j]) | 0, koef);
        pos[j].add(vel[j]);
      }
      let blured_buf = buf.getGaussian(4).clamp(0, 1);
      let clamped_buf = new Buffer(SIZE);
      clamped_buf.copy(blured_buf);
      clamped_buf.clamp(0, 0.2).normalize(0, 1);
      ret.push(
        Buffer.create_texture(clamped_buf, blured_buf, blured_buf, blured_buf, {
          wrap: state.gl.CLAMP_TO_EDGE,
        }),
      );
    }
    Console.info('Create splash = ', Date.now() - time);
    return ret;
  }

  Particle.spark_textures = create_spark();
  Particle.splash_textures = create_splash();

  //type — биты выбраны так, чтобы группы (BLOOD/SPLASH/EXPLODE) объединялись через `|`.
  Particle.EXPLODE_ROCKET = 1;
  Particle.EXPLODE_PLASMA = 2;
  Particle.EXPLODE_PLASMA_QUAD = 4096 * 2;
  Particle.EXPLODE =
    Particle.EXPLODE_ROCKET | Particle.EXPLODE_PLASMA | Particle.EXPLODE_PLASMA_QUAD;
  Particle.RESPAWN = 8;
  Particle.SPLASH_LAVA = 256;
  Particle.SPLASH_LAVA_SMALL = 512;
  Particle.SPLASH = Particle.SPLASH_LAVA | Particle.SPLASH_LAVA_SMALL;
  Particle.SPARK = 4096;

  Particle.PARTICLE_LAYER_0 = Particle.SPARK;
  Particle.PARTICLE_LAYER_1 = Particle.RESPAWN | Particle.SPLASH;
  Particle.PARTICLE_LAYER_2 = Particle.EXPLODE;

  Particle.tex_respawn = new Texture('/game/textures/fx/particles/respawn.png');

  Particle.particles = [];

  let vert = Shader.vertexShader(true, false, 'gl_Position');

  let vert_explode =
    '\n\
    attribute vec4 position;\n\
    \n\
    uniform mat4 mat_pos;\n\
    uniform vec4 dtc;\n\
    varying vec4 texcoord;\n\
    varying vec4 koef;\n\
    \n\
    void main()\n\
    {\n\
        gl_Position = mat_pos * position;\n\
        texcoord.xy = position.xy * 0.5 + 0.5;\n\
        texcoord.xy = texcoord.xy * 0.25 + dtc.xy;\n\
        texcoord.zw = gl_Position.xy * 0.5 + 0.5;\n\
        koef = dtc.zzzz;\n\
    }\n';

  let frag_particle =
    '\n\
    #ifdef GL_ES\n\
    // define default precision for float, vec, mat.\n\
    precision highp float;\n\
    #endif\n\
    \n\
    uniform sampler2D tex;\n\
    uniform sampler2D tex_visible;\n\
    uniform vec4 color;\n\
    uniform vec4 koef;\n\
    uniform vec4 fog_uv;\n\
    varying vec4 texcoord;\n\
    \n\
    void main()\n\
    {\n\
        vec4 col = texture2D(tex, texcoord.xy);\n\
        col = (clamp(col.gggg, koef.x, koef.y) - koef.w) * koef.z;\n\
        if (fog_uv.z > 0.5) {\n\
            float mapFog = texture2D(tex_visible, fog_uv.xy).r;\n\
            mapFog = mapFog * mapFog * (3.0 - 2.0 * mapFog);\n\
            float fog = clamp(max(mapFog, fog_uv.w), 0.0, 1.0);\n\
            vec3 fogCol = vec3(0.012, 0.018, 0.032);\n\
            col.rgb = mix(col.rgb, fogCol, fog * 0.92);\n\
            col.a *= (1.0 - fog * 0.95);\n\
        }\n\
        gl_FragColor = col * color;\n\
    }\n';

  Particle.shader_respawn = new Shader(vert_explode, state.Weapon.frag_noshadow_color, [
    'mat_pos',
    'dtc',
    'tex',
    'tex_visible',
    'color',
    'fog_uv',
  ]);
  Particle.shader_particle = new Shader(vert, frag_particle, [
    'mat_pos',
    'tex',
    'tex_visible',
    'color',
    'koef',
    'fog_uv',
  ]);
};

//dir - Vector
Particle.create = function (type, pos, dir, count) {
  for (let i = 0; i < count; i++) {
    let particle = new Particle(type, pos, dir);
    particle.rnd = Math.random();
    Particle.particles.push(particle);
  }
};

Particle.render = function (camera, layer) {
  state.gl.enable(state.gl.BLEND);
  for (let index = 0; index < Particle.particles.length; ) {
    let particle = Particle.particles[index];
    let not_skip = layer === 0 && particle.type & Particle.PARTICLE_LAYER_0;
    not_skip = not_skip || (layer === 1 && particle.type & Particle.PARTICLE_LAYER_1);
    not_skip = not_skip || (layer === 2 && particle.type & Particle.PARTICLE_LAYER_2);
    let deleted = false;
    if (not_skip) {
      particle.render(camera);
      if (!particle.update()) {
        Particle.particles.splice(index, 1);
        deleted = true;
      }
    }
    if (!deleted) index++;
  }
  state.gl.disable(state.gl.BLEND);
};

state.Particle = Particle;
export { Particle };
