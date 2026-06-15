import { Shader } from '../engine/shader.js';
import { Console, assert } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { WEAPON } from '../server/game/global.js';
import { Event } from '../server/libs/event.js';

class Achievement {
  constructor(type, str, prior) {
    let achievementtime = parseInt(
      Console.variable('achievementtime', 'time for disappear achievement', 3000),
    );
    this.time = Date.now() + achievementtime;
    this.prior = prior;

    this.render = function () {
      let alpha = (this.time - Date.now()) / 500;
      if (alpha > 2) alpha = 2;

      if (type === Achievement.KILL)
        state.text.render([0, 0.35], 2, '#b' + str, 1, { center: true, alpha: alpha });
      if (type === Achievement.DEAD)
        state.text.render([0, 0.3], 2, '#w' + str, 1, { center: true, alpha: alpha });
      if (type === Achievement.ACHIEV)
        state.text.render([0, 0.2], 2, '#r' + str, 2, { center: true, alpha: alpha });
      if (type === Achievement.ACHIEV_BIG)
        state.text.render([0, 0.1], 2.5, '#r' + str, 2, { center: true, alpha: alpha });
      if (type === Achievement.DISACHIEV)
        state.text.render([0, 0.2], 2, '#G' + str, 2, { center: true, alpha: alpha });
    };
  }
}

function getPhrase(phrase) {
  const phrases = {
    PHRASE_SELFKILL: { en: 'Suicide', ru: 'Самоубийство' },
    PHRASE_YOUKILLED: { en: 'You were killed', ru: 'Убит' },
    PHRASE_YOUKILLEDBOT: { en: 'You were killed by ', ru: 'Вас убил ' },
    PHRASE_YOUKILL: { en: 'You killed', ru: 'Вы убили' },
    PHRASE_YOUKILLBOT: { en: 'You killed ', ru: 'Вы убили ' },
    PHRASE_DOUBLEKILL: { en: 'Double', ru: 'Двойное' },
    PHRASE_TRIPLEKILL: { en: 'Triple', ru: 'Тройное' },
    PHRASE_MULTIKILL: { en: 'Multi', ru: 'Массовое' },
    PHRASE_KILL: { en: 'kill', ru: ' убийство' },
    PHRASE_SERIALKILLER: { en: 'Killing spree', ru: 'Серийный убийца' },
    PHRASE_SNIPER: { en: 'Sniper', ru: 'Снайпер' },
    PHRASE_AVENGER: { en: 'Avenger', ru: 'Мститель' },
    PHRASE_QUICKKILL: { en: 'Quickkill', ru: 'Быстрое убийство' },
    PHRASE_QUICKDEATH: { en: 'Quickdeath', ru: 'Быстрая смерть' },
    PHRASE_LOOSER: { en: 'Cannon fodder', ru: 'Пушечное мясо' },
    PHRASE_TELEFRAGING: { en: 'Telefrag', ru: 'Телефраг' },
    PHRASE_TELEFRAGED: { en: 'Telefragged', ru: 'Телефрагирован' },
  };

  const ph = phrases[phrase];
  if (!ph) {
    Console.error('Unknow phrase');
    return 'Unknow';
  } else {
    let lang = navigator.language || navigator.userLanguage;
    if (lang.indexOf('en') === 0) lang = 'en';
    else if (lang.indexOf('ru') === 0) lang = 'ru';
    else lang = 'en';
    return ph[lang];
  }
}

Achievement.KILL = 0;
Achievement.DEAD = 1;
Achievement.ACHIEV = 2;
Achievement.ACHIEV_BIG = 3;
Achievement.DISACHIEV = 4;

let HUD = {
  achievements: [],
  showtable: false,
  hitFlashUntil: 0,
  deathStart: 0,
};

HUD.addAchievement = function (type, str, prior) {
  const spectating =
    state.gameClient && state.gameClient.isSpectating && state.gameClient.isSpectating();
  if (!state.playing && !spectating) return;
  let ach = HUD.achievements[type];
  if (ach) {
    if (Date.now() < ach.time && ach.prior > prior) return;
  }
  HUD.achievements[type] = new Achievement(type, str, prior);
};

Event.on('keydown', function (key) {
  if (key === Console.TAB) HUD.showtable = !HUD.showtable;
});

Event.on('cl_death', function (id, killer_id) {
  HUD.deathStart = Date.now();
  if (id === killer_id) {
    HUD.addAchievement(Achievement.DEAD, getPhrase('PHRASE_SELFKILL'), 2);
  } else {
    let nick = state.gameClient.getNickById(killer_id);
    let msg = nick ? getPhrase('PHRASE_YOUKILLEDBOT') + nick : getPhrase('PHRASE_YOUKILLED');
    HUD.addAchievement(Achievement.DEAD, msg, 1);
  }
});

Event.on('cl_botpain', function (pos, dir, id) {
  if (!state.gameClient) return;
  const cam = state.gameClient.getCamera ? state.gameClient.getCamera() : null;
  if (cam && id === cam.id) {
    HUD.hitFlashUntil = Date.now() + 380;
  }
});

Event.on('cl_botrespawn', function () {
  // После респа эффект смерти затухает быстрее.
  if (HUD.deathStart && Date.now() - HUD.deathStart > 200) {
    HUD.deathStart = 0;
  }
});

Event.on('cl_kill', function (deader_id) {
  let nick = state.gameClient.getNickById(deader_id);
  let msg = nick ? getPhrase('PHRASE_YOUKILLBOT') + nick : getPhrase('PHRASE_YOUKILL');
  HUD.addAchievement(Achievement.KILL, msg, 1);
});

Event.on('cl_multi', function (multi) {
  assert(multi > 0);
  if (multi > 3) multi = 3;
  let message = [
    getPhrase('PHRASE_DOUBLEKILL'),
    getPhrase('PHRASE_TRIPLEKILL'),
    getPhrase('PHRASE_MULTIKILL'),
  ];
  HUD.addAchievement(Achievement.ACHIEV_BIG, message[multi - 1] + getPhrase('PHRASE_KILL'), multi);
});

Event.on('cl_killer', function () {
  HUD.addAchievement(Achievement.ACHIEV, getPhrase('PHRASE_SERIALKILLER'), 1);
});

Event.on('cl_sniper', function () {
  HUD.addAchievement(Achievement.ACHIEV, getPhrase('PHRASE_SNIPER'), 4);
});

Event.on('cl_avenger', function () {
  HUD.addAchievement(Achievement.ACHIEV, getPhrase('PHRASE_AVENGER'), 3);
});

Event.on('cl_quickkill', function () {
  HUD.addAchievement(Achievement.ACHIEV, getPhrase('PHRASE_QUICKKILL'), 2);
});

Event.on('cl_quickdeath', function () {
  HUD.addAchievement(Achievement.DISACHIEV, getPhrase('PHRASE_QUICKDEATH'), 2);
});

Event.on('cl_looser', function () {
  HUD.addAchievement(Achievement.DISACHIEV, getPhrase('PHRASE_LOOSER'), 1);
});

Event.on('cl_telefraging', function () {
  HUD.addAchievement(Achievement.ACHIEV, getPhrase('PHRASE_TELEFRAGING'), 5);
});

Event.on('cl_telefraged', function () {
  HUD.addAchievement(Achievement.DISACHIEV, getPhrase('PHRASE_TELEFRAGED'), 3);
});

HUD.load = function () {
  let vert_hud =
    '\n\
    attribute vec4 position;\n\
    uniform vec4 vec_pos;\n\
    uniform vec4 rotate90;\n\
    varying vec4 texcoord;\n\
    \n\
    void main(void) \n\
    {\n\
        texcoord = mix(position, position.yxzw, rotate90.x) * 0.5 + 0.5;\n\
        vec4 pos = position;\n\
        pos.xy = pos.xy * vec_pos.zw + vec_pos.xy;\n\
        texcoord.zw = pos.xy * 0.5 + 0.5;\n\
        gl_Position = pos;\n\
    }\n';

  let frag_hud =
    '\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec4 texcoord;\n\
    uniform sampler2D tex;\n\
    uniform vec4 color;\n\
    \n\
    void main(void) \n\
    {\n\
        vec4 col = texture2D(tex, texcoord.xy);\n\
        gl_FragColor = col * color;\n\
    }\n';

  let frag_visible_hud =
    '\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec4 texcoord;\n\
    uniform sampler2D tex;\n\
    uniform sampler2D tex_visible;\n\
    uniform vec4 color;\n\
    \n\
    void main(void) \n\
    {\n\
        vec4 vis = texture2D(tex_visible, texcoord.zw);\n\
        vec4 col = texture2D(tex, texcoord.xy);\n\
        col *= 1.0 - vis.r;\n\
        gl_FragColor = col * color;\n\
    }\n';

  HUD.shader_hud = new Shader(vert_hud, frag_hud, ['vec_pos', 'rotate90', 'tex', 'color']);
  HUD.shader_visible_hud = new Shader(vert_hud, frag_visible_hud, [
    'vec_pos',
    'rotate90',
    'tex',
    'tex_visible',
    'color',
  ]);

  let vert_vignette =
    '\n\
    attribute vec2 position;\n\
    varying vec2 v_uv;\n\
    void main(void)\n\
    {\n\
        v_uv = position;\n\
        gl_Position = vec4(position, 0.0, 1.0);\n\
    }\n';

  let frag_vignette =
    '\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec2 v_uv;\n\
    uniform vec4 params;\n\
    void main(void)\n\
    {\n\
        vec2 p = v_uv;\n\
        p.x *= params.y;\n\
        float d = length(p);\n\
        float vig = smoothstep(0.35, 1.25, d);\n\
        float a = vig * params.x;\n\
        if (a < 0.005) discard;\n\
        gl_FragColor = vec4(params.z, 0.0, 0.0, a);\n\
    }\n';

  HUD.shader_vignette = new Shader(vert_vignette, frag_vignette, ['params']);

  // Рамка слота оружия рисуется процедурно (скруглённый прямоугольник через SDF),
  // а не из текстуры — нет растяжения и паразитного белого фона.
  // frame = [aspect(w/h бокса), corner_radius, border_thickness, anti-alias] в единицах полу-высоты.
  // color = [rgb рамки, master_alpha].
  let frag_frame =
    '\n\
    #ifdef GL_ES\n\
    precision highp float;\n\
    #endif\n\
    varying vec4 texcoord;\n\
    uniform vec4 frame;\n\
    uniform vec4 color;\n\
    void main(void)\n\
    {\n\
        vec2 local = texcoord.xy * 2.0 - 1.0;\n\
        vec2 p = vec2(local.x * frame.x, local.y);\n\
        vec2 b = vec2(frame.x, 1.0);\n\
        float r = frame.y;\n\
        vec2 q = abs(p) - b + r;\n\
        float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;\n\
        float aa = frame.w;\n\
        float fillMask = 1.0 - smoothstep(-aa, aa, d);\n\
        float ring = fillMask * smoothstep(-frame.z - aa, -frame.z + aa, d);\n\
        vec3 fillCol = vec3(0.05, 0.06, 0.09);\n\
        float fillA = 0.5 * fillMask;\n\
        vec3 rgb = mix(fillCol, color.rgb, ring);\n\
        float a = max(fillA, ring) * color.a;\n\
        if (a < 0.004) discard;\n\
        gl_FragColor = vec4(rgb, a);\n\
    }\n';

  HUD.shader_frame = new Shader(vert_hud, frag_frame, ['vec_pos', 'rotate90', 'frame', 'color']);
};

HUD.ready = function () {
  return !!HUD.shader_frame;
};

HUD.render = function (bot, table, playing) {
  if (playing === undefined) playing = true;
  const spectating =
    state.gameClient && state.gameClient.isSpectating && state.gameClient.isSpectating();

  function renderWeapons() {
    const aspect = state.canvas.width / state.canvas.height;
    const screenH = state.canvas.height;
    const ICON_TEX_PX = 64;

    // Привязка HUD-размеров к целым пикселям — без «мыльного» субпиксельного масштаба.
    function snapHalfNdc(halfNdc, texPx) {
      const fullPx = halfNdc * screenH;
      if (texPx) {
        const scale = Math.max(1, Math.round(fullPx / texPx));
        return (scale * texPx) / screenH;
      }
      const snappedPx = Math.max(2, Math.round(fullPx));
      return snappedPx / screenH;
    }

    state.gl.enable(state.gl.BLEND);
    state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);

    // Геометрия рамки: бокс вдвое шире своей высоты -> aspect = 2.
    // 3-й параметр (0.07) — толщина рамки, aa = 0.012 — сглаживание.
    const FRAME_PARAMS = [2.0, 0.45, 0.07, 0.012];
    const SLOT_X = 0.9;
    const SLOT_Y_TOP = 0.82;
    const SLOT_STEP = 0.2;
    const FRAME_HH = snapHalfNdc(0.08);
    const FRAME_HW = (2.0 * FRAME_HH) / aspect;
    const ICON_HH = snapHalfNdc(0.13, ICON_TEX_PX);
    const ICON_HW = ICON_HH / aspect;
    for (let i = WEAPON.PISTOL; i <= WEAPON.ROCKET; i++) {
      let alpha = bot.patrons[i] / (1 << 5);
      if (alpha > 1) alpha = 1;
      const selected = bot.weapon.type === i;
      const owned = alpha > 0;

      // 1) Процедурная рамка-слот (скруглённый прямоугольник).
      let fcol;
      let falpha;
      if (selected) {
        fcol = [0.45, 1.0, 0.5];
        falpha = 1.0;
      } else if (owned) {
        fcol = [0.95, 0.78, 0.45];
        falpha = 0.92;
      } else {
        fcol = [0.55, 0.6, 0.7];
        falpha = 0.4;
      }
      HUD.shader_frame.use();
      HUD.shader_frame.vector(HUD.shader_frame.frame, FRAME_PARAMS);
      HUD.shader_frame.vector(HUD.shader_frame.color, [fcol[0], fcol[1], fcol[2], falpha]);
      HUD.shader_frame.vector(HUD.shader_frame.vec_pos, [
        SLOT_X,
        SLOT_Y_TOP - SLOT_STEP * i,
        FRAME_HW,
        FRAME_HH,
      ]);
      HUD.shader_frame.vector(HUD.shader_frame.rotate90, [0, 0, 0, 0]);
      state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);

      // 2) Иконка оружия поверх рамки (текстура ствола, повёрнута на 90°).
      HUD.shader_hud.use();
      HUD.shader_hud.texture(HUD.shader_hud.tex, state.Weapon.skins[i].gun.getId(), 0);
      HUD.shader_hud.vector(HUD.shader_hud.color, [1, 1, 1, owned ? 1.0 : 0.0]);
      HUD.shader_hud.vector(HUD.shader_hud.vec_pos, [
        SLOT_X,
        SLOT_Y_TOP - SLOT_STEP * i,
        ICON_HW,
        ICON_HH,
      ]);
      HUD.shader_hud.vector(HUD.shader_hud.rotate90, [1, 0, 0, 0]);
      state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
    }

    // Иконка здоровья + число — только в активной игре (не в спектаторе).
    if (playing) {
      HUD.shader_hud.use();
      HUD.shader_hud.texture(HUD.shader_hud.tex, state.Item.tex_powerup[0].getId(), 0);
      HUD.shader_hud.vector(HUD.shader_hud.color, [2, 2, 2, 0.5]);
      HUD.shader_hud.vector(HUD.shader_hud.vec_pos, [-0.9, 0.9, 1.0 / 12.0 / aspect, 1.0 / 12.0]);
      HUD.shader_hud.vector(HUD.shader_hud.rotate90, [0, 0, 0, 0]);
      state.gl.drawArrays(state.gl.TRIANGLE_STRIP, 0, 4);
      state.text.render([-0.85, 0.9], 2, ' ' + bot.life, 2);
    }

    state.gl.disable(state.gl.BLEND);
  }

  if ((playing || spectating) && bot && bot.patrons && bot.weapon) renderWeapons();

  if (playing || spectating) {
    HUD.achievements.forEach(function (ach) {
      if (Date.now() < ach.time) ach.render();
    });
  }

  renderBottomStats(bot, playing);

  function renderTableCentered() {
    let Y = 0.28;
    table.forEach((row, index) => {
      let rank = '' + (index + 1) + ')';
      if (playing && index === bot.rank) rank += '>';
      Y -= 0.055;
      state.text.render([0, Y], 2, rank + '  ' + row.nick + '  #g' + row.scores, 1, {
        center: true,
      });
    });
    if (playing && bot.rank > 9) {
      let nick = state.gameClient.getNickById(bot.id);
      let rank = '' + (bot.rank + 1) + ')>';
      Y -= 0.055;
      state.text.render([0, Y], 2, rank + '  #y' + nick + '#w  #g' + bot.scores, 1, {
        center: true,
      });
    }
  }

  if (!Console.show && HUD.showtable) renderTableCentered();

  renderDamageVignette();
};

function renderBottomStats(bot, playing) {
  const Y = -0.96;
  const aspect = state.canvas.width / state.canvas.height;
  // Миникарта занимает ~0.3 NDC по высоте, по ширине — 0.3/aspect, центр в [-0.8, -0.7].
  // Правый край миникарты + отступ:
  const minimapRight = -0.8 + 0.3 / aspect;
  let x = minimapRight + 0.08;
  const fps = state.stats ? state.stats.fps : 0;
  const ping = state.gameClient && state.gameClient.getPing ? state.gameClient.getPing() : 0;

  if (playing) {
    const nick = state.gameClient.getNickById(bot.id);
    state.text.render([x, Y], 2, nick, 1);
    x += 0.22;
    state.text.render([x, Y], 2, 'frags: #g' + bot.frag, 1);
    x += 0.18;
    state.text.render([x, Y], 2, 'scores: #g' + bot.scores, 1);
    x += 0.2;
    state.text.render([x, Y], 2, 'rank: #g' + (bot.rank + 1), 1);
    x += 0.16;
  }
  state.text.render([x, Y], 2, '#gFPS#w= ' + fps, 1);
  x += 0.16;
  state.text.render([x, Y], 2, '#gPing#w= ' + ping, 1);
}

function renderDamageVignette() {
  const now = Date.now();
  let intensity = 0;
  let tint = 0.85;

  if (HUD.deathStart) {
    const dt = now - HUD.deathStart;
    const DEATH_DURATION = 2200;
    if (dt < DEATH_DURATION) {
      const t = dt / DEATH_DURATION;
      intensity = Math.max(intensity, 0.85 * (1 - t));
    } else {
      HUD.deathStart = 0;
    }
  }

  if (now < HUD.hitFlashUntil) {
    const left = HUD.hitFlashUntil - now;
    const base = Math.min(1, left / 380);
    const flicker = 0.55 + 0.45 * Math.sin(now * 0.045);
    intensity = Math.max(intensity, base * flicker * 0.55);
    tint = 0.95;
  }

  if (intensity < 0.01) return;

  const gl = state.gl;
  const aspect = state.canvas.width / state.canvas.height;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  HUD.shader_vignette.use();
  HUD.shader_vignette.vector(HUD.shader_vignette.params, [intensity, aspect, tint, 0]);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disable(gl.BLEND);
}

state.HUD = HUD;
export { HUD };
