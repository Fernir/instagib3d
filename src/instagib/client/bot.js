import { Shader } from '../engine/shader.js';
import { Texture } from '../engine/texture.js';
import { Console, config, assert } from '../polyfill.js';
import { state, getMouseAngle } from '../runtime-state.js';
import { ITEM } from '../server/game/global.js';
import { Event } from '../server/libs/event.js';
import { Vector } from '../server/libs/vector.js';
import { Bot } from '../server/objects/bot.js';
import { Dynent, cameraCulling } from '../server/objects/dynent.js';

import { Sound } from './sound.js';
import { WeaponClient } from './weapon.js';


class BotClient {
  constructor(server_time, serverBot, isCamera) {
    this.id = serverBot.id;
    this.controlable = serverBot.controlable;
    const skinid = this.id % BotClient.skinnames.length;
    this.skin = BotClient.skinnames[skinid];
    this.old_frame_dynent = null;
    this.new_frame_dynent = new Dynent([serverBot.x, serverBot.y], [1, 1], serverBot.angle);
    this.old_frame_time = 0;
    this.new_frame_time = server_time;
    this.dynent = new Dynent([serverBot.x, serverBot.y], [1, 1], serverBot.angle);
    this.weapon = new WeaponClient(serverBot.weapon, serverBot.shoot);

    this.begin_of_walk = 0;
    this.leg_angle = 0;
    this.key_up = false;
    this.key_right = false;
    this.key_down = false;
    this.key_left = false;
    this.seria = 0;
    this.seriaVisibleUntil = 0;

    this.addFrame(server_time, serverBot, isCamera);
  }

  addFrame(server_time, serverBot, isCamera) {
    assert(this.id === serverBot.id);
    this.old_frame_dynent = this.new_frame_dynent;
    this.new_frame_dynent = new Dynent([serverBot.x, serverBot.y], [1, 1], serverBot.angle);
    this.old_frame_time = this.new_frame_time;
    this.new_frame_time = server_time;
    this.my_time = Date.now();

    this.alive = serverBot.alive;
    this.power = serverBot.power;
    this.shield = serverBot.shield;
    this.weapon.setType(serverBot.weapon);
    if (serverBot.shoot) this.weapon.shoot();
    if (serverBot.seria !== this.seria) {
      this.seria = serverBot.seria;
      this.seriaVisibleUntil = this.seria === 0 ? 0 : Date.now() + 2000;
    }

    this.life = serverBot.life;
    this.patrons = serverBot.patrons;

    if (isCamera) {
      if (serverBot.i_am_death) Event.emit('cl_death', this.id, serverBot.i_am_death);
      if (serverBot.i_am_kill && serverBot.i_am_kill !== this.id)
        Event.emit('cl_kill', serverBot.i_am_kill);
      if (serverBot.i_am_multi) Event.emit('cl_multi', serverBot.i_am_multi);
      if (serverBot.i_am_killer) Event.emit('cl_killer');
      if (serverBot.i_am_looser) Event.emit('cl_looser');
      if (serverBot.i_am_sniper) Event.emit('cl_sniper');
      if (serverBot.i_am_avenger) Event.emit('cl_avenger');
      if (serverBot.i_am_quickkill) Event.emit('cl_quickkill');
      if (serverBot.i_am_quickdeath) Event.emit('cl_quickdeath');
      if (serverBot.i_am_telefraging) Event.emit('cl_telefraging');
      if (serverBot.i_am_telefraged) Event.emit('cl_telefraged');
      this.frag = serverBot.frag;
      this.scores = serverBot.scores;
      this.rank = serverBot.rank;
    }

    const dir = Vector.sub(this.new_frame_dynent.pos, this.old_frame_dynent.pos);
    this.speed = dir.length() / (this.new_frame_time - this.old_frame_time);
    this.direction = dir.normalize().rotate(this.new_frame_dynent.angle);
    this.direction.y *= -1;
    this.direction.mul(100);
    this.direction.x = this.direction.x | 0;
    this.direction.y = this.direction.y | 0;
  }

  update() {
    const new_time = this.new_frame_time;
    const old_time = this.old_frame_time;
    const update_server_time = parseInt(config.get('game-server:update-time'));
    const current_time = new_time + (Date.now() - this.my_time) - update_server_time;
    let koef = new_time === old_time ? 0 : (current_time - old_time) / (new_time - old_time);
    if (koef < 0) koef = 0;

    this.dynent.interpolate(this.old_frame_dynent, this.new_frame_dynent, koef);

    if (this.controlable) {
      this.dynent.angle = getMouseAngle();
    }

    if (this.speed < BotClient.SPEED * 0.5) {
      this.begin_of_walk = 0;
    } else if (this.begin_of_walk === 0) {
      this.begin_of_walk = Date.now();
    }
  }

  renderShadow(camera) {
    if (!this.alive) return;

    const pos = Vector.sub(this.dynent.pos, state.sun_direction);
    Dynent.render(
      camera,
      BotClient.skins[this.skin].sh_body,
      BotClient.shader_shadow,
      pos,
      [1.2, 1.2],
      this.dynent.angle,
    );
    this.weapon.renderShadow(camera, this);
  }

  render(camera) {
    if (!this.alive) return;

    const self = this;
    const gl = state.gl;

    const renderLeg = (val, dx) => {
      const sina = Math.sin(self.dynent.angle);
      const cosa = Math.cos(self.dynent.angle);
      const ca = Math.cos(self.leg_angle);
      const sa = Math.sin(self.leg_angle);
      const x = BotClient.skins[self.skin].x + dx;

      if (val < 0.5) {
        if (val > 0.25) val = 0.5 - val;
        const pos = Vector.add2(
          self.dynent.pos,
          cosa * (x - val * 2 * sa) - sina * (-0.3 + val * 2 * ca),
          -cosa * (-0.3 + val * 2 * ca) - sina * (x - val * 2 * sa),
        );
        Dynent.render(
          camera,
          BotClient.skins[self.skin].leg,
          BotClient.shader_bot,
          pos,
          [1, val * 4],
          self.dynent.angle + self.leg_angle,
        );
      } else {
        val -= 0.5;
        if (val > 0.25) val = 0.5 - val;
        const pos = Vector.add2(
          self.dynent.pos,
          cosa * (x + val * 2 * sa) + sina * (0.2 + val * 2 * ca),
          cosa * (0.2 + val * 2 * ca) - sina * (x + val * 2 * sa),
        );
        Dynent.render(
          camera,
          BotClient.skins[self.skin].legback,
          BotClient.shader_bot,
          pos,
          [1, val * 4],
          self.dynent.angle + self.leg_angle,
        );
      }
    };

    const haloRender = () => {
      if (!self.power) return;
      let color = [1, 0.5, 0.5, 0];
      if (self.power === ITEM.REGEN) color = [0.5, 1, 0.5, 0];
      else if (self.power === ITEM.SPEED) color = [0.5, 0.5, 1, 0];

      gl.blendFunc(gl.ONE, gl.ONE);
      Dynent.render(
        camera,
        BotClient.skins[self.skin].sh_body,
        BotClient.shader_halo,
        self.dynent.pos,
        [1.2, 1.2],
        self.dynent.angle,
        { vectors: [{ location: BotClient.shader_halo.color, vec: color }] },
      );
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    };

    const shieldRender = () => {
      if (!self.shield) return;
      const color = [0.5, 0.5, 1, 0];
      gl.blendFunc(gl.ONE, gl.ONE);
      const renderState = {
        vectors: [
          {
            location: state.Weapon.shader_noshadow_color.color,
            vec: color,
          },
        ],
      };
      Dynent.render(
        camera,
        BotClient.tex_shield,
        state.Weapon.shader_noshadow_color,
        self.dynent.pos,
        [2, 2],
        0,
        renderState,
      );
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    };

    const renderBody = () => {
      if (cameraCulling(camera, self.dynent.pos, self.dynent.size)) return;
      const speed = self.power === ITEM.SPEED ? BotClient.SPEED * 1.5 : BotClient.SPEED;
      const period = (500 * BotClient.SPEED) / speed;
      const time = Date.now();
      let step = (time - self.begin_of_walk) / period;
      if (self.begin_of_walk === 0) step = 0;
      let val = step - (step | 0);

      let angle = self.direction.angle() + Math.PI / 2;
      if (angle > Math.PI / 2) angle -= Math.PI;
      else if (angle < -Math.PI / 2) angle += Math.PI;
      self.leg_angle += (angle - self.leg_angle) * 0.2;

      renderLeg(val, 0);
      val += 0.5;
      if (val >= 1) val -= 1;
      renderLeg(val, 0.4);

      haloRender();
      self.dynent.render(camera, BotClient.skins[self.skin].body, BotClient.shader_bot);
      shieldRender();
    };

    renderBody();
    this.weapon.render(camera, this);
  }

  renderStats(camera) {
    if (cameraCulling(camera, this.dynent.pos, this.dynent.size)) return;

    const pos = Vector.sub(this.dynent.pos, camera.pos);
    const sina = Math.sin(camera.angle);
    const cosa = Math.cos(camera.angle);
    pos.set(cosa * pos.x - sina * pos.y, -cosa * pos.y - sina * pos.x);

    const aspect = state.canvas.width / state.canvas.height;
    const h_ratio = 16.0 / 9.0;
    const koef = 2.0 / 12.0;

    if (aspect < h_ratio) pos.mul2(koef / aspect, koef);
    else pos.mul2(koef / h_ratio, (koef * aspect) / h_ratio);

    pos.add2(0, -0.55);
    if (this.dynent !== camera) {
      const nick = state.gameClient.getNickById(this.id);
      state.text.render(pos.toVec(), 2, nick, 1, { visibile: true, center: true, alpha: 2 });
    }
    pos.add2(0.07, -0.2);
    if (Date.now() < this.seriaVisibleUntil) {
      if (this.seria > 0) {
        state.text.render(pos.toVec(), 3, '#r+' + this.seria, 2, { visibile: true, alpha: 2 });
      } else if (this.seria < 0) {
        state.text.render(pos.toVec(), 3, '#w' + this.seria, 2, { visibile: true, alpha: 2 });
      }
    }
  }
}

BotClient.isMutant = function (id) {
  const skinid = id % BotClient.skinnames.length;
  const skin = BotClient.skinnames[skinid];
  return skin === 'vazovsky' || skin === 'lyaguha';
};

BotClient.ready = function () {
  for (let i = 0; i < BotClient.skins.length; i++) {
    if (!BotClient.skins[i].ready()) return false;
  }
  return BotClient.tex_shield.ready();
};

BotClient.load = function () {
  const gl = state.gl;

  function LoadSkin(name, x) {
    const path = '/game/textures/skins/' + name + '/';
    const skin = {
      body: new Texture(path + 'body.png', { wrap: gl.CLAMP_TO_EDGE }),
      leg: new Texture(path + 'leg.png', { wrap: gl.CLAMP_TO_EDGE }),
      legback: new Texture(path + 'legback.png', { wrap: gl.CLAMP_TO_EDGE }),
      sh_body: new Texture(path + 'sh_body.png', { wrap: gl.CLAMP_TO_EDGE }),
      x,
    };
    skin.ready = function () {
      return this.body.ready() && this.leg.ready() && this.legback.ready() && this.sh_body.ready();
    };
    BotClient.skins[name] = skin;
    BotClient.skinnames.push(name);
  }

  BotClient.tex_shield = new Texture('/game/textures/fx/botshield.png', {
    wrap: gl.CLAMP_TO_EDGE,
  });
  BotClient.skins = {};
  BotClient.skinnames = [];
  LoadSkin('blue_man', -0.2);
  LoadSkin('red_man', -0.2);
  LoadSkin('negr', -0.2);
  LoadSkin('vazovsky', -0.35);
  LoadSkin('lyaguha', -0.35);

  Console.addCommand('skins', 'all available skins', function () {
    for (const s in BotClient.skins) {
      Console.debug(s);
    }
  });

  const vert = Shader.vertexShader(true, false, 'gl_Position');

  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex;
    uniform sampler2D tex_visible;
    varying vec4 texcoord;

    void main()
    {
        vec4 col = texture2D(tex, texcoord.xy);
        vec4 visible = texture2D(tex_visible, texcoord.zw);
        float shadow = clamp((1.0 - visible.g) * 6.0 - 3.0, 0.5, 1.0);
        float contur = abs(col.a * 2.0 - 1.0);
        col.rgb *= (1.0 - visible.r) * shadow * contur;
        gl_FragColor = col;
    }`;

  const frag_shadow = `
    #ifdef GL_ES
    precision highp float;
    #endif

    varying vec4 texcoord;
    uniform sampler2D tex;
    uniform sampler2D tex_visible;

    void main()
    {
        float alpha = texture2D(tex, texcoord.xy).a;
        vec4 visible = texture2D(tex_visible, texcoord.zw);
        float shadow = clamp((1.0 - visible.g) * 6.0 - 3.0, 0.5, 1.0);
        shadow = (shadow - 0.5) * 2.0;
        alpha *= 0.5 * shadow;
        gl_FragColor = vec4(1.0 - alpha);
    }`;

  const frag_halo = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex;
    uniform sampler2D tex_visible;
    uniform vec4 color;
    varying vec4 texcoord;

    void main()
    {
        vec4 col = texture2D(tex, texcoord.xy);
        vec4 visible = texture2D(tex_visible, texcoord.zw);
        col.a *= 1.0 - visible.r;
        gl_FragColor = color * col.aaaa;
    }`;

  BotClient.shader_bot = new Shader(vert, frag, ['mat_pos', 'tex', 'tex_visible']);
  BotClient.shader_shadow = new Shader(vert, frag_shadow, ['mat_pos', 'tex', 'tex_visible']);
  BotClient.shader_halo = new Shader(vert, frag_halo, ['mat_pos', 'tex', 'tex_visible', 'color']);

  BotClient.snd_gib = new Sound('gib');
  BotClient.snd_respawn = new Sound('respawn');
};

BotClient.SPEED = Bot.SPEED;

state.Bot = BotClient;
export { BotClient };
