import { state } from '@core/runtime-state.js';
import { Shader } from '@engine/shader.js';
import { Texture } from '@engine/texture.js';
import { WEAPON } from '@game/global.js';

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
}

WeaponClient.ready = function () {
  for (let i = 0; i < WeaponClient.skins.length; i++) {
    if (!WeaponClient.skins[i].ready()) return false;
  }
  return WeaponClient.skins[WEAPON.PLASMA].bullet_quad.ready() && WeaponClient.tex_decal.ready();
};

WeaponClient.load = function () {
  const gl = state.gl;
  const hudTex = {
    filter: gl.NEAREST,
    wrap: gl.CLAMP_TO_EDGE,
  };

  function loadWeapon(name, id) {
    const path = '/game/textures/weapons/' + name + '/';
    const skin = {
      gun: new Texture(path + 'gun.png', hudTex),
      bullet: new Texture(path + 'bullet.png'),
      snd_shoot: new Sound(name),
    };
    skin.ready = function () {
      return this.gun.ready() && this.bullet.ready();
    };
    WeaponClient.skins[id] = skin;
  }

  WeaponClient.wea_tabl = [
    { lifetime: 100 },
    { lifetime: 100 },
    { lifetime: 1000 },
    { lifetime: 0 },
    { lifetime: 0 },
    { lifetime: 0 },
  ];

  WeaponClient.skins = [];
  loadWeapon('pistol', WEAPON.PISTOL);
  loadWeapon('shaft', WEAPON.SHAFT);
  loadWeapon('rail', WEAPON.RAIL);
  loadWeapon('plasma', WEAPON.PLASMA);
  loadWeapon('zenit', WEAPON.ZENIT);
  loadWeapon('rocket', WEAPON.ROCKET);

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

  const frag_noshadow = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex;
    uniform sampler2D tex_visible;
    uniform vec4 fog_uv;
    varying vec4 texcoord;

    void main()
    {
        vec4 col = texture2D(tex, texcoord.xy);
        if (col.a < 0.1) discard;
        if (fog_uv.z > 0.5) {
            float mapFog = texture2D(tex_visible, fog_uv.xy).r;
            mapFog = mapFog * mapFog * (3.0 - 2.0 * mapFog);
            float fog = clamp(max(mapFog, fog_uv.w), 0.0, 1.0);
            vec3 fogCol = vec3(0.012, 0.018, 0.032);
            col.rgb = mix(col.rgb, fogCol, fog * 0.92);
            col.a *= (1.0 - fog * 0.95);
        }
        gl_FragColor = col;
    }`;

  // Используется и WeaponClient.shader_noshadow_color, и Particle.shader_respawn
  // (последний делает свой шейдер на этом фрагменте + `vert_explode`).
  WeaponClient.frag_noshadow_color = `
    #ifdef GL_ES
    precision highp float;
    #endif

    uniform sampler2D tex;
    uniform sampler2D tex_visible;
    uniform vec4 color;
    uniform vec4 fog_uv;
    varying vec4 texcoord;

    void main()
    {
        vec4 col = texture2D(tex, texcoord.xy);
        if (col.a < 0.1) discard;
        if (fog_uv.z > 0.5) {
            float mapFog = texture2D(tex_visible, fog_uv.xy).r;
            mapFog = mapFog * mapFog * (3.0 - 2.0 * mapFog);
            float fog = clamp(max(mapFog, fog_uv.w), 0.0, 1.0);
            vec3 fogCol = vec3(0.012, 0.018, 0.032);
            col.rgb = mix(col.rgb * color.rgb, fogCol, fog * 0.92);
            col.a *= color.a * (1.0 - fog * 0.95);
        } else {
            col *= color;
        }
        gl_FragColor = col;
    }`;

  WeaponClient.shader_noshadow = new Shader(vert, frag_noshadow, [
    'mat_pos',
    'tex',
    'tex_visible',
    'fog_uv',
  ]);
  WeaponClient.shader_noshadow_color = new Shader(vert, WeaponClient.frag_noshadow_color, [
    'mat_pos',
    'tex',
    'tex_visible',
    'color',
    'fog_uv',
  ]);

  // Луч молнии (shaft): как в оригинальном instagib.io — текстура молнии,
  // прокручиваемая вдоль луча через mat_tex (UV-скролл). Тот же color-фрагмент.
  const vert_tex = Shader.vertexShader(true, true, 'gl_Position');
  WeaponClient.shader_shaft = new Shader(vert_tex, WeaponClient.frag_noshadow_color, [
    'mat_pos',
    'mat_tex',
    'tex',
    'tex_visible',
    'color',
    'fog_uv',
  ]);
};

state.Weapon = WeaponClient;
export { WeaponClient };
