import { Shader } from '../engine/shader.js';
import { Texture } from '../engine/texture.js';
import { state } from '../runtime-state.js';
import { WEAPON, ITEM } from '../server/game/global.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent } from '../server/objects/dynent.js';

import { Sound } from './sound.js';


class WeaponClient {
  constructor(type, shoot) {
    this.type = WEAPON.PISTOL;
    this.shooting = false;
    this.dead = 0;

    this.setType(type);
    if (shoot) this.shoot();
  }

  setType(type) {
    if (this.type !== type) {
      this.type = type;
      this.shooting = false;
    }
  }

  shoot() {
    if (!this.shooting || this.type === WEAPON.SHAFT) {
      this.shooting = true;
      this.dead = Date.now() + WeaponClient.wea_tabl[this.type].lifetime;
    }
  }

  renderShadow(camera, owner) {
    const sina = Math.sin(owner.dynent.angle);
    const cosa = Math.cos(owner.dynent.angle);

    const pos = Vector.sub(owner.dynent.pos, state.sun_direction);
    pos.add2(cosa * 0.25 - sina * 0.4, -cosa * 0.4 - sina * 0.25);
    Dynent.render(
      camera,
      WeaponClient.skins[this.type].shadow,
      state.Bot.shader_shadow,
      pos,
      [1.2, 1.2],
      owner.dynent.angle,
    );
  }

  render(camera, owner) {
    const sina = Math.sin(owner.dynent.angle);
    const cosa = Math.cos(owner.dynent.angle);
    const pos = Vector.add2(owner.dynent.pos, cosa * 0.25 - sina * 0.4, -cosa * 0.4 - sina * 0.25);
    Dynent.render(
      camera,
      WeaponClient.skins[this.type].gun,
      state.Bot.shader_bot,
      pos,
      [1, 1],
      owner.dynent.angle,
    );

    if (Date.now() > this.dead) this.shooting = false;

    if (this.shooting && this.type <= WEAPON.RAIL) {
      const renderState = {
        vectors: [{ location: WeaponClient.shader_noshadow_color.color, vec: [] }],
      };
      let timeleft = (this.dead - Date.now()) / WeaponClient.wea_tabl[this.type].alphatime;
      timeleft = Math.max(timeleft, 0);

      const Y = WeaponClient.wea_tabl[this.type].Y;
      const owner_pos = Vector.add2(
        owner.dynent.pos,
        cosa * 0.25 - sina * Y,
        -cosa * Y - sina * 0.25,
      );

      if (this.type === WEAPON.PISTOL) {
        renderState.vectors[0].vec =
          owner.power === ITEM.QUAD ? [1, 0.8, 0.6, timeleft] : [1, 1, 1, timeleft];
      } else if (this.type === WEAPON.SHAFT) {
        renderState.vectors[0].vec =
          owner.power === ITEM.QUAD ? [1.5, 0.7, 0.7, 0] : [0.7, 0.7, 1.5, 0];
      } else if (this.type === WEAPON.RAIL) {
        renderState.vectors[0].vec = [timeleft * 2, timeleft, timeleft, 0];
      }

      const gl = state.gl;
      if (this.type !== WEAPON.PISTOL) gl.blendFunc(gl.ONE, gl.ONE);

      Dynent.render(
        camera,
        WeaponClient.skins[this.type].fire,
        WeaponClient.shader_noshadow_color,
        owner_pos,
        WeaponClient.wea_tabl[this.type].size,
        owner.dynent.angle,
        renderState,
      );

      if (this.type !== WEAPON.PISTOL) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }
}

WeaponClient.ready = function () {
  for (let i = 0; i < WeaponClient.skins.length; i++) {
    if (!WeaponClient.skins[i].ready()) return false;
  }
  return WeaponClient.skins[WEAPON.PLASMA].bullet_quad.ready() && WeaponClient.tex_decal.ready();
};

WeaponClient.load = function () {
  function loadWeapon(name, id, fire) {
    const path = '/game/textures/weapons/' + name + '/';
    const skin = {
      gun: new Texture(path + 'gun.png'),
      shadow: new Texture(path + 'shadow.png'),
      bullet: new Texture(path + 'bullet.png'),
      fire: fire ? new Texture(path + 'fire.png') : null,
      snd_shoot: new Sound(name),
    };
    skin.ready = function () {
      return (
        this.gun.ready() &&
        this.shadow.ready() &&
        this.bullet.ready() &&
        (!this.fire || this.fire.ready())
      );
    };
    WeaponClient.skins[id] = skin;
  }

  WeaponClient.wea_tabl = [
    { lifetime: 100, alphatime: 50, Y: 1.3, size: [1, 1] },
    { lifetime: 100, alphatime: 50, Y: 0.9, size: [1, 1] },
    { lifetime: 1000, alphatime: 500, Y: 0.9, size: [0.75, 0.75] },
    { lifetime: 0, alphatime: 50, Y: 0.0, size: [1, 1] },
    { lifetime: 0, alphatime: 50, Y: 0.0, size: [1, 1] },
    { lifetime: 0, alphatime: 50, Y: 0.0, size: [1, 1] },
  ];

  WeaponClient.skins = [];
  loadWeapon('pistol', WEAPON.PISTOL, true);
  loadWeapon('shaft', WEAPON.SHAFT, true);
  loadWeapon('rail', WEAPON.RAIL, false);
  loadWeapon('plasma', WEAPON.PLASMA, false);
  loadWeapon('zenit', WEAPON.ZENIT, false);
  loadWeapon('rocket', WEAPON.ROCKET, false);

  WeaponClient.skins[WEAPON.RAIL].fire = WeaponClient.skins[WEAPON.SHAFT].fire;
  WeaponClient.skins[WEAPON.PISTOL].snd_shoot.setVolume(0.5);
  WeaponClient.skins[WEAPON.SHAFT].snd_shoot.snd.loop(true);
  WeaponClient.skins[WEAPON.PLASMA].bullet_quad = new Texture(
    '/game/textures/weapons/plasma/bullet_quad.png',
  );

  WeaponClient.tex_decal = new Texture('/game/textures/fx/particles/decal.png');
  WeaponClient.snd_explode = new Sound('exp');
  WeaponClient.snd_grenade = new Sound('grenade');
  WeaponClient.snd_ric = [new Sound('ric1'), new Sound('ric2'), new Sound('ric3')];
  WeaponClient.snd_ric.forEach((snd) => snd.setVolume(0.5));

  const vert = Shader.vertexShader(true, false, 'gl_Position');
  const vert_tex = Shader.vertexShader(true, true, 'gl_Position');

  const frag_noshadow = `
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
        col *= 1.0 - visible.r;
        gl_FragColor = col;
    }`;

  WeaponClient.frag_noshadow_color = `
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
        col *= (1.0 - visible.r) * color;
        gl_FragColor = col;
    }`;

  const vert_shaft = `
    attribute vec4 position;
    uniform mat4 mat_pos;
    uniform mat4 mat_tex;
    uniform vec4 norm_dir;
    varying vec4 texcoord;
    varying vec4 vertexpos;

    void main()
    {
        vec2 dir = normalize(norm_dir.xy);
        vec2 normal = vec2(-dir.y, dir.x);
        vec2 nap = normalize(norm_dir.zw);
        float proj = dot(normal, nap);
        float koef = (1.0 - position.y * position.y) * length(norm_dir.zw) * 0.6;
        vec4 pos = vec4(position.x - proj * koef, position.yzw);
        gl_Position = mat_pos * pos;
        texcoord = mat_tex * position;
        vertexpos = position;
        texcoord.zw = gl_Position.xy * 0.5 + 0.5;
    }`;

  const frag_shaft = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex;
    uniform sampler2D tex_visible;
    uniform vec4 color;
    varying vec4 texcoord;
    varying vec4 vertexpos;

    void main()
    {
        vec4 col = texture2D(tex, texcoord.xy);
        vec4 visible = texture2D(tex_visible, texcoord.zw);
        col *= (1.0 - visible.r) * color;
        float koef = clamp((1.0 - vertexpos.y * vertexpos.y) * 3.0, 0.0, 1.0);
        col *= koef;
        gl_FragColor = col;
    }`;

  WeaponClient.shader_noshadow = new Shader(vert, frag_noshadow, ['mat_pos', 'tex', 'tex_visible']);
  WeaponClient.shader_noshadow_color = new Shader(vert, WeaponClient.frag_noshadow_color, [
    'mat_pos',
    'tex',
    'tex_visible',
    'color',
  ]);
  WeaponClient.shader_noshadow_color_tex = new Shader(vert_tex, WeaponClient.frag_noshadow_color, [
    'mat_pos',
    'mat_tex',
    'tex',
    'tex_visible',
    'color',
  ]);
  WeaponClient.shader_shaft = new Shader(vert_shaft, frag_shaft, [
    'mat_pos',
    'mat_tex',
    'tex',
    'tex_visible',
    'color',
    'norm_dir',
  ]);

  const gl = state.gl;
  const current_buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);

  WeaponClient.COUNT_SEGMENTS = 8;
  WeaponClient.shaft_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, WeaponClient.shaft_buffer);
  const vertices = [];
  for (let i = 0; i <= WeaponClient.COUNT_SEGMENTS; i++) {
    vertices.push(-1.0);
    vertices.push(-1.0 + (2 / WeaponClient.COUNT_SEGMENTS) * i);
    vertices.push(1.0);
    vertices.push(-1.0 + (2 / WeaponClient.COUNT_SEGMENTS) * i);
  }
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, current_buffer);
};

state.Weapon = WeaponClient;
export { WeaponClient };
