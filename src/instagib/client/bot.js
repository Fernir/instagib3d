import { Shader } from '../engine/shader.js';
import { Console, config, assert } from '../polyfill.js';
import { state, getMouseAngle, getMousePitch } from '../runtime-state.js';
import { ITEM, WEAPON } from '../server/game/global.js';
import { Event } from '../server/libs/event.js';
import { Vector } from '../server/libs/vector.js';
import { Bot } from '../server/objects/bot.js';
import { Dynent } from '../server/objects/dynent.js';

import { MD2Model } from './md2.js';
import { Sound } from './sound.js';
import { WeaponClient } from './weapon.js';

const MD2_SCALE = 0.036;
const MD2_Y_OFFSET = 0.87;

const MD2_SPECS = [
  { model: '/game/models/q2/male/tris.md2', skin: '/game/models/q2/male/grunt.pcx' },
  { model: '/game/models/q2/male/tris.md2', skin: '/game/models/q2/male/cipher.pcx' },
  { model: '/game/models/q2/male/tris.md2', skin: '/game/models/q2/male/rampage.pcx' },
  { model: '/game/models/q2/female/tris.md2', skin: '/game/models/q2/female/athena.pcx' },
  { model: '/game/models/q2/cyborg/tris.md2', skin: '/game/models/q2/cyborg/rebornblue.png' },
  { model: '/game/models/q2/cyborg/tris.md2', skin: '/game/models/q2/cyborg/rebornred.png' },
];

const ANIM_TABLE = {
  stand: { prefix: 'stand', fps: 10, once: false },
  run: { prefix: 'run', fps: 12, once: false },
  attack: { prefix: 'attack', fps: 15, once: false },
  pain: { prefix: 'pain1', fps: 18, once: false },
  death: { prefix: 'death1', fps: 8, once: true },
};

function md2Anim(name) {
  return ANIM_TABLE[name] || ANIM_TABLE.stand;
}

function md2Frames(model, name) {
  if (!model._animCache) model._animCache = {};
  if (!model._animCache[name]) {
    const anim = md2Anim(name);
    model._animCache[name] = model.framesByPrefix(anim.prefix);
  }
  return model._animCache[name];
}

function chooseAnim(bot) {
  if (!bot.alive) return 'death';
  if (bot.weapon && bot.weapon.shooting && Date.now() < bot.weapon.dead) return 'attack';
  if (bot.begin_of_walk !== 0) return 'run';
  return 'stand';
}

const CORPSE_LIFETIME_MS = 5000;
const CORPSE_FADE_MS = 1500;

function renderBotMD2(camera, bot, spec) {
  void camera;
  const model = spec.model;
  const animName = chooseAnim(bot);
  const frames = md2Frames(model, animName);
  if (!frames.length) return false;

  const anim = md2Anim(animName);
  const now = Date.now();
  let cursor;
  if (anim.once) {
    const start = bot.deathStartTime || now;
    cursor = ((now - start) / 1000) * anim.fps;
    if (cursor >= frames.length - 1) cursor = frames.length - 1.0001;
  } else {
    cursor = (now / 1000) * anim.fps;
    cursor -= Math.floor(cursor / frames.length) * frames.length;
  }
  const ia = Math.floor(cursor);
  const lerp = cursor - ia;
  const ib = anim.once
    ? Math.min(frames.length - 1, ia + 1)
    : (ia + 1) % frames.length;

  const mat4 = state.mat4;
  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [bot.dynent.pos.x, MD2_Y_OFFSET, bot.dynent.pos.y]);
  mat4.rotateY(m, m, bot.dynent.angle);
  mat4.scale(m, m, [MD2_SCALE, MD2_SCALE, MD2_SCALE]);

  let color = [1, 1, 1, 1];
  if (bot.power === ITEM.QUAD) color = [1.1, 0.85, 0.85, 1];
  else if (bot.power === ITEM.REGEN) color = [0.85, 1.05, 0.85, 1];
  else if (bot.power === ITEM.SPEED) color = [0.85, 0.9, 1.1, 1];

  let fadeAlpha = 1;
  if (!bot.alive && bot.deathStartTime) {
    const dt = now - bot.deathStartTime;
    const fadeStart = CORPSE_LIFETIME_MS - CORPSE_FADE_MS;
    if (dt > fadeStart) {
      fadeAlpha = Math.max(0, 1 - (dt - fadeStart) / CORPSE_FADE_MS);
    }
  }
  color[3] = fadeAlpha;

  const gl = state.gl;
  if (fadeAlpha < 0.999) {
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  const lr = state.LevelRender;
  const lightCtx = lr && lr.levelmapTexId
    ? {
        levelmapId: lr.levelmapTexId,
        worldX: bot.dynent.pos.x,
        worldZ: bot.dynent.pos.y,
        invLevelSize: lr.levelSize ? 1 / lr.levelSize : 0,
        sunDir: lr.sunDir || [0.6, -0.8, 0.4],
      }
    : null;
  model.render(m, frames[ia], frames[ib], lerp, spec.skinIndex, color, lightCtx);

  // Q2-оружие игрока — это просто ДРУГАЯ entity с тем же origin/angles/frame/oldframe
  // (см. id-Software/Quake-2/client/cl_ents.c: дублирование сущности при modelindex2).
  // Оба MD2 имеют одинаковый порядок 198 кадров, так что используем те же индексы
  // (`frames[ia]`, `frames[ib]`) и тот же lerp — оружие не отстаёт и не исчезает
  // во время pain/death (где префиксы в w_*.md2 отличаются от player.md2).
  if (bot.weapon) {
    const wSpec = getWeaponSpec(spec, bot.weapon.type);
    if (wSpec && wSpec.model.frameBuffers && wSpec.model.frameBuffers.length) {
      const last = wSpec.model.frameBuffers.length - 1;
      const wia = Math.max(0, Math.min(last, frames[ia] | 0));
      const wib = Math.max(0, Math.min(last, frames[ib] | 0));
      wSpec.model.render(
        m, wia, wib, lerp,
        wSpec.skinIndex, [1, 1, 1, fadeAlpha], lightCtx,
      );
    }
  }

  // Неоновая обводка от усилений (если нет щита — щит покажет «пузырь» сверху).
  if (bot.alive && !bot.shield && bot.power) {
    let neon = null;
    if (bot.power === ITEM.QUAD)        neon = [0.4, 0.2, 1.0, 1];
    else if (bot.power === ITEM.REGEN)  neon = [0.25, 1.0, 0.35, 1];
    else if (bot.power === ITEM.SPEED)  neon = [1.0, 0.85, 0.25, 1];
    if (neon) {
      const pulse = 0.7 + 0.3 * Math.sin(now * 0.008);
      const tint = [neon[0] * pulse, neon[1] * pulse, neon[2] * pulse, 1];
      model.renderOutline(m, frames[ia], frames[ib], lerp, tint, 0.7);
    }
  }

  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);

  // Щит — «пузырь» вокруг игрока (как в 2D, но в 3D billboard).
  if (bot.alive && bot.shield) {
    const shieldM = mat4.create();
    mat4.identity(shieldM);
    mat4.translate(shieldM, shieldM, [bot.dynent.pos.x, 1.0, bot.dynent.pos.y]);
    drawShieldBubble(shieldM);
  }

  return true;
}

function renderFirstPersonWeapon(camera) {
  if (!camera || !state.viewProj3D) return;
  if (!state.gameClient) return;
  const myBot = state.gameClient.getCamera ? state.gameClient.getCamera() : null;
  if (!myBot || !myBot.weapon || !myBot.alive) return;

  // FP-view предпочитает оригинальные view-модели (v_*.md2). Если их нет —
  // фолбэк на body-weapon модели той же player-модели, что использует бот.
  const myBodySpec = pickMD2Spec(myBot.id || 0);
  const wSpec = getViewWeaponSpec(myBot.weapon.type) || getWeaponSpec(myBodySpec, myBot.weapon.type);
  if (!wSpec) return;

  const now = Date.now();
  const firing = myBot.weapon.shooting && now < myBot.weapon.dead;
  const frameSet = viewWeaponFrames(wSpec.model, firing);
  const wFrames = frameSet.frames;
  if (!wFrames.length) return;
  const fps = firing ? 22 : 7;
  let cursor = (now / 1000) * fps;
  cursor -= Math.floor(cursor / wFrames.length) * wFrames.length;
  const ia = Math.floor(cursor);
  const lerp = cursor - ia;
  const ib = (ia + 1) % wFrames.length;

  const gl = state.gl;
  const mat4 = state.mat4;

  // Лёгкий «боб» при движении: вертикальное колебание + горизонтальный покач.
  const speed = myBot.speed || 0;
  const bobAmp = Math.min(1, speed / (Bot.SPEED * 0.5));
  const t = now * 0.012;
  const bobY = Math.sin(t * 2.0) * 0.018 * bobAmp;
  const bobX = Math.cos(t)       * 0.022 * bobAmp;

  const yaw = camera.dynent.angle;
  const pitch = (typeof getMousePitch === 'function') ? getMousePitch() : 0;
  const eye_h = (state.LevelRender && state.LevelRender.eye_height) || 1.6;

  // Направления камеры (right/up/forward) — те же, что в level3d.js буфере камеры.
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const fwd_x = -sy * cp;
  const fwd_y = -sp;
  const fwd_z = -cy * cp;
  const right_x = cy;
  const right_y = 0;
  const right_z = -sy;
  const up_x = -sy * sp;
  const up_y = cp;
  const up_z = -cy * sp;

  const eye_x = camera.dynent.pos.x;
  const eye_y = eye_h;
  const eye_z = camera.dynent.pos.y;

  // Q2 view-модель сделана так, что её origin совпадает с глазом (vieworg),
  // а форма уже включает «правильный» сдвиг вниз/вправо. Добавляем только bob/sway.
  const offRight = bobX;
  const offDown  = bobY;
  const offFwd   = 0;

  const wpx = eye_x + right_x * offRight + up_x * offDown + fwd_x * offFwd;
  const wpy = eye_y + right_y * offRight + up_y * offDown + fwd_y * offFwd;
  const wpz = eye_z + right_z * offRight + up_z * offDown + fwd_z * offFwd;

  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [wpx, wpy, wpz]);
  mat4.rotateY(m, m, yaw);
  mat4.rotateX(m, m, pitch);
  // Q2 хранит модели в right-handed системе с +Y = LEFT. Наш expandFrame маппит
  // Q2 +Y -> engine +X, что превращает «правую руку» в «левую» (хват модели зеркалится).
  // Для view-weapon исправляем chirality зеркалом по X. Так курок/затвор/прицел
  // оказываются с правильной стороны вида.
  const VIEW_SCALE = 0.028;
  mat4.scale(m, m, [-VIEW_SCALE, VIEW_SCALE, VIEW_SCALE]);

  const wasDepth = gl.isEnabled(gl.DEPTH_TEST);
  const wasCull = gl.isEnabled(gl.CULL_FACE);
  const wasBlend = gl.isEnabled(gl.BLEND);
  const wasDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);

  // Q2 RF_WEAPONMODEL: рисуем поверх мира, но с back-face culling. После зеркала
  // по X winding треугольников инвертируется — culling переключаем на FRONT.
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  // Статический свет уровня (запечённые факелы) и динамические вспышки от
  // снарядов/выстрелов должны влиять на оружие в руках. Берём sample-точку для
  // лайтмапа в позиции игрока (не у глаз) — так оружие реагирует на свет «тайла»,
  // где стоит игрок, а не на тот, что под камерой/на полу за спиной.
  const lr2 = state.LevelRender;
  wSpec.model.render(
    m, wFrames[ia], wFrames[ib], lerp, wSpec.skinIndex,
    [1.05, 1.05, 1.05, 1],
    {
      sunDir: lr2 && lr2.sunDir ? lr2.sunDir : [0.4, -0.85, 0.35],
      worldRef: [camera.dynent.pos.x, eye_h, camera.dynent.pos.y],
    },
  );

  gl.depthMask(wasDepthMask);
  if (wasDepth) gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);
  if (wasCull) gl.enable(gl.CULL_FACE);
  else gl.disable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  if (wasBlend) gl.enable(gl.BLEND);
  else gl.disable(gl.BLEND);
}

function ensureShadowShader() {
  if (BotClient.shader_floor_shadow) return BotClient.shader_floor_shadow;
  const vert = `
    attribute vec2 position;
    uniform mat4 mat_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = position;
      gl_Position = mat_pos * vec4(position, 0.0, 1.0);
    }`;
  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif
    varying vec2 v_uv;
    uniform vec4 color;
    void main() {
      float r = length(v_uv);
      if (r > 1.0) discard;
      float a = (1.0 - smoothstep(0.55, 1.0, r)) * color.a;
      gl_FragColor = vec4(color.rgb, a);
    }`;
  BotClient.shader_floor_shadow = new Shader(vert, frag, ['mat_pos', 'color']);
  return BotClient.shader_floor_shadow;
}

function drawFloorShadow(bot) {
  const gl = state.gl;
  const mat4 = state.mat4;
  const sh = ensureShadowShader();

  const radius = 0.55;
  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [bot.dynent.pos.x, 0.02, bot.dynent.pos.y]);
  mat4.rotateX(m, m, -Math.PI * 0.5);
  mat4.scale(m, m, [radius, radius, 1]);

  const matPos = mat4.create();
  mat4.multiply(matPos, state.viewProj3D, m);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);

  sh.use();
  sh.matrix(sh.mat_pos, matPos);
  sh.vector(sh.color, [0.05, 0.05, 0.05, 0.55]);

  gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function ensureBubbleShader() {
  if (BotClient.shader_bubble) return BotClient.shader_bubble;
  const vert = `
    attribute vec2 position;
    uniform mat4 mat_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = position;
      gl_Position = mat_pos * vec4(position, 0.0, 1.0);
    }`;
  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 color;
    uniform vec4 time_p;
    varying vec2 v_uv;
    void main() {
      float r = length(v_uv);
      if (r > 1.0) discard;
      // Fresnel: ярче по краям, прозрачнее в центре — даёт ощущение сферы.
      float edge = smoothstep(0.55, 1.0, r);
      float pulse = 0.85 + 0.15 * sin(time_p.x * 3.0);
      vec3 col = color.rgb * pulse;
      float a = edge * 0.55 + (1.0 - r) * 0.08;
      gl_FragColor = vec4(col, a);
    }`;
  BotClient.shader_bubble = new Shader(vert, frag, ['mat_pos', 'color', 'time_p']);
  return BotClient.shader_bubble;
}

function drawShieldBubble(modelMatrix) {
  const gl = state.gl;
  const mat4 = state.mat4;
  const sh = ensureBubbleShader();

  const camera = state.gameClient && state.gameClient.getCamera && state.gameClient.getCamera();
  const yaw = camera ? camera.dynent.angle : 0;
  const right_x = Math.cos(yaw);
  const right_z = -Math.sin(yaw);

  const bb = new Float32Array([
    right_x, 0, right_z, 0,
    0, 1, 0, 0,
    -right_z, 0, right_x, 0,
    0, 0, 0, 1,
  ]);
  const tmp = mat4.create();
  mat4.multiply(tmp, modelMatrix, bb);
  mat4.scale(tmp, tmp, [1.5, 1.5, 1.5]);
  const matPos = mat4.create();
  mat4.multiply(matPos, state.viewProj3D, tmp);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);

  sh.use();
  sh.matrix(sh.mat_pos, matPos);
  sh.vector(sh.color, [0.45, 0.7, 1.0, 1.0]);
  sh.vector(sh.time_p, [Date.now() * 0.001, 0, 0, 0]);

  gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function ensureHpBarShader() {
  if (BotClient.shader_hpbar) return BotClient.shader_hpbar;
  const vert = `
    attribute vec2 position;
    uniform vec4 rect;
    void main() {
      gl_Position = vec4(rect.x + position.x * rect.z, rect.y + position.y * rect.w, 0.0, 1.0);
    }`;
  const frag = `
    #ifdef GL_ES
    precision highp float;
    #endif
    uniform vec4 color;
    void main() { gl_FragColor = color; }`;
  BotClient.shader_hpbar = new Shader(vert, frag, ['rect', 'color']);
  return BotClient.shader_hpbar;
}

function drawHpBar(nx, ny, width, height, ratio) {
  const gl = state.gl;
  if (!state.quadBuffer) return;
  const sh = ensureHpBarShader();
  const hw = width * 0.5;
  const hh = height * 0.5;

  const wasBlend = gl.isEnabled(gl.BLEND);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  sh.use();
  // фон с лёгкой обводкой через чёрный чуть больший прямоугольник
  sh.vector(sh.rect, [nx, ny, hw + 0.004, hh + 0.004]);
  sh.vector(sh.color, [0, 0, 0, 0.85]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  sh.vector(sh.rect, [nx, ny, hw, hh]);
  sh.vector(sh.color, [0.12, 0.12, 0.12, 0.85]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const clamped = Math.max(0, Math.min(1, ratio));
  if (clamped > 0) {
    const fillW = hw * clamped;
    const fillX = nx - hw + fillW;
    let color = [0.25, 0.85, 0.25, 0.95];
    if (clamped < 0.6) color = [0.95, 0.85, 0.2, 0.95];
    if (clamped < 0.3) color = [0.95, 0.25, 0.2, 0.95];
    sh.vector(sh.rect, [fillX, ny, fillW, hh]);
    sh.vector(sh.color, color);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  if (!wasBlend) gl.disable(gl.BLEND);
}

function hasLineOfSight(camera, targetPos) {
  if (!state.gameClient) return true;
  const lr = state.gameClient.getLevelRender();
  if (!lr || typeof lr.getLevel !== 'function') return true;
  const level = lr.getLevel();
  if (!level || typeof level.getCollide !== 'function') return true;
  const dx = targetPos.x - camera.pos.x;
  const dy = targetPos.y - camera.pos.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return true;
  const step = 0.5;
  const count = Math.min(80, Math.floor(len / step));
  const ux = dx / len;
  const uy = dy / len;
  const probe = { x: 0, y: 0 };
  for (let i = 1; i < count; i++) {
    probe.x = camera.pos.x + ux * step * i;
    probe.y = camera.pos.y + uy * step * i;
    if (level.getCollide(probe) > 128) return false;
  }
  return true;
}

function pickMD2Spec(id) {
  if (!BotClient.md2Specs || !BotClient.md2Specs.length) return null;
  return BotClient.md2Specs[id % BotClient.md2Specs.length];
}

function startMd2Loads() {
  if (BotClient.md2Cache) return;
  BotClient.md2Cache = new Map();
  BotClient.weaponPerBody = new Map(); // bodyDir -> { [weaponType]: { model, skinIndex } }
  BotClient.md2Specs = [];
  MD2_SPECS.forEach(async (entry) => {
    try {
      let model = BotClient.md2Cache.get(entry.model);
      if (!model) {
        model = await MD2Model.load(entry.model, []);
        BotClient.md2Cache.set(entry.model, model);
      }
      const skinIndex = model.addSkin(entry.skin);
      // Каталог тела ("/game/models/q2/male/", "/.../female/", "/.../cyborg/")
      // используется для подгрузки соответствующих w_*.md2 — у каждой модели
      // игрока свой набор weapon-mesh-ей с правильной позицией ладони.
      const bodyDir = entry.model.slice(0, entry.model.lastIndexOf('/') + 1);
      const weapons = await ensureBodyWeapons(bodyDir);
      BotClient.md2Specs.push({ model, skinIndex, bodyDir, weapons });
    } catch (err) {
      Console.warn('MD2 spec load failed: ' + entry.model + ' / ' + entry.skin + ': ' + err.message);
    }
  });
  startViewWeaponMd2Loads();
}

// Q2-модели оружия — по одному набору на каждую модель игрока (male/female/cyborg).
// Файлы лежат рядом с tris.md2: players/<body>/w_*.md2 в оригинальном baseq2.
const Q2_WEAPON_FILES = {
  [WEAPON.PISTOL]: 'w_blaster.md2',
  [WEAPON.SHAFT]:  'w_chaingun.md2',
  [WEAPON.RAIL]:   'w_railgun.md2',
  [WEAPON.PLASMA]: 'w_hyperblaster.md2',
  [WEAPON.ZENIT]:  'w_glauncher.md2',
  [WEAPON.ROCKET]: 'w_rlauncher.md2',
};

async function ensureBodyWeapons(bodyDir) {
  if (BotClient.weaponPerBody.has(bodyDir)) {
    return BotClient.weaponPerBody.get(bodyDir);
  }
  const weapons = {};
  BotClient.weaponPerBody.set(bodyDir, weapons);
  await Promise.all(Object.keys(Q2_WEAPON_FILES).map(async (key) => {
    const file = Q2_WEAPON_FILES[key];
    try {
      const model = await MD2Model.load(bodyDir + file, []);
      const skinIndex = model.addSkin(bodyDir + 'weapon.pcx');
      weapons[key] = { model, skinIndex };
    } catch (err) {
      Console.warn('Q2 body-weapon load failed: ' + bodyDir + file + ': ' + err.message);
    }
  }));
  return weapons;
}

// Оригинальные Quake 2 first-person view-модели (`item->view_model`).
const Q2_VIEW_WEAPON_PATH = '/game/models/q2/viewweapons/';
const Q2_VIEW_WEAPON_FILES = {
  [WEAPON.PISTOL]: { model: 'blaster.md2',      skin: 'blaster.pcx' },
  [WEAPON.SHAFT]:  { model: 'chaingun.md2',     skin: 'chaingun.pcx' },
  [WEAPON.RAIL]:   { model: 'railgun.md2',      skin: 'railgun.pcx' },
  [WEAPON.PLASMA]: { model: 'hyperblaster.md2', skin: 'hyperblaster.pcx' },
  [WEAPON.ZENIT]:  { model: 'glauncher.md2',    skin: 'glauncher.pcx' },
  [WEAPON.ROCKET]: { model: 'rlauncher.md2',    skin: 'rlauncher.pcx' },
};

function startViewWeaponMd2Loads() {
  if (BotClient.viewWeaponMd2) return;
  BotClient.viewWeaponMd2 = {};
  Object.keys(Q2_VIEW_WEAPON_FILES).forEach(async (key) => {
    const file = Q2_VIEW_WEAPON_FILES[key];
    try {
      const model = await MD2Model.load(Q2_VIEW_WEAPON_PATH + file.model, []);
      const skinIndex = model.addSkin(Q2_VIEW_WEAPON_PATH + file.skin);
      BotClient.viewWeaponMd2[key] = { model, skinIndex };
    } catch (err) {
      Console.warn('Q2 view weapon load failed: ' + file.model + ': ' + err.message);
    }
  });
}

// Возвращает Q2-weapon spec, синхронизированный с конкретной моделью игрока
// (player_spec.weapons[type]). Это критично: у male/female/cyborg вершины
// w_*.md2 расположены по-разному под их собственную позу ладони.
function getWeaponSpec(bodySpec, weaponType) {
  if (!bodySpec || !bodySpec.weapons) return null;
  const spec = bodySpec.weapons[weaponType];
  if (!spec || !spec.model) return null;
  return spec;
}

function getViewWeaponSpec(weaponType) {
  if (!BotClient.viewWeaponMd2) return null;
  const spec = BotClient.viewWeaponMd2[weaponType];
  return spec && spec.model ? spec : null;
}

function viewWeaponFrames(model, firing) {
  if (!model._viewAnimCache) model._viewAnimCache = {};
  const key = firing ? 'pow' : 'idle';
  if (!model._viewAnimCache[key]) {
    let frames = model.framesByPrefix(key);
    if (!frames.length && !firing) frames = model.framesByPrefix('active');
    if (!frames.length) frames = model.framesByPrefix('idle');
    if (!frames.length && model.frameBuffers && model.frameBuffers.length) frames = [0];
    model._viewAnimCache[key] = { frames };
  }
  return model._viewAnimCache[key];
}


class BotClient {
  constructor(server_time, serverBot, isCamera) {
    this.id = serverBot.id;
    this.controlable = serverBot.controlable;
    this.old_frame_dynent = null;
    this.new_frame_dynent = new Dynent([serverBot.x, serverBot.y], [1, 1], serverBot.angle);
    this.old_frame_time = 0;
    this.new_frame_time = server_time;
    this.dynent = new Dynent([serverBot.x, serverBot.y], [1, 1], serverBot.angle);
    this.weapon = new WeaponClient(serverBot.weapon, serverBot.shoot);

    this.begin_of_walk = 0;
    this.seria = 0;

    this.addFrame(server_time, serverBot, isCamera);
  }

  addFrame(server_time, serverBot, isCamera) {
    assert(this.id === serverBot.id);
    this.old_frame_dynent = this.new_frame_dynent;
    this.new_frame_dynent = new Dynent([serverBot.x, serverBot.y], [1, 1], serverBot.angle);
    this.old_frame_time = this.new_frame_time;
    this.new_frame_time = server_time;
    this.my_time = Date.now();

    if (this.alive && !serverBot.alive) this.deathStartTime = Date.now();
    if (!this.alive && serverBot.alive) this.deathStartTime = 0;
    this.alive = serverBot.alive;
    this.power = serverBot.power;
    this.shield = serverBot.shield;
    this.health_ratio = serverBot.health_ratio !== undefined ? serverBot.health_ratio : 1;
    this.weapon.setType(serverBot.weapon);
    if (serverBot.shoot) this.weapon.shoot();
    if (serverBot.seria !== this.seria) this.seria = serverBot.seria;

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
    if (!this.alive) {
      this.begin_of_walk = 0;
      return;
    }
    const new_time = this.new_frame_time;
    const old_time = this.old_frame_time;
    const update_server_time = parseInt(config.get('game-server:update-time'));
    const current_time = new_time + (Date.now() - this.my_time) - update_server_time;
    let koef = new_time === old_time ? 0 : (current_time - old_time) / (new_time - old_time);
    if (koef < 0) koef = 0;
    if (koef > 1) koef = 1;

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

  render(camera) {
    if (this.dynent === camera) return;
    if (!this.alive) {
      const dt = this.deathStartTime ? Date.now() - this.deathStartTime : Infinity;
      if (dt > CORPSE_LIFETIME_MS) return;
    }
    const spec = pickMD2Spec(this.id);
    if (!spec || !spec.model.ready()) return;
    if (this.alive) drawFloorShadow(this);
    renderBotMD2(camera, this, spec);
  }

  renderStats(camera) {
    if (this.dynent === camera) return;
    if (!this.alive) return;
    const vp = state.viewProj3D;
    if (!vp) return;

    const headY = MD2_Y_OFFSET + 1.55;
    const wx = this.dynent.pos.x;
    const wz = this.dynent.pos.y;
    const cx = vp[0] * wx + vp[4] * headY + vp[8] * wz + vp[12];
    const cy = vp[1] * wx + vp[5] * headY + vp[9] * wz + vp[13];
    const cw = vp[3] * wx + vp[7] * headY + vp[11] * wz + vp[15];
    if (cw <= 0.05) return;
    const nx = cx / cw;
    const ny = cy / cw;
    if (nx < -1.0 || nx > 1.0 || ny < -1.0 || ny > 1.0) return;
    if (cw > 40) return;
    if (!hasLineOfSight(camera, this.dynent.pos)) return;

    const nick = state.gameClient.getNickById(this.id);
    state.text.render([nx, ny + 0.02], 2, nick, 1, { center: true, alpha: 2 });

    const hp = Math.max(0, Math.min(1, this.health_ratio !== undefined ? this.health_ratio : 1));
    drawHpBar(nx, ny - 0.03, 0.16, 0.012, hp);
  }
}

BotClient.skinnames = ['blue_man', 'red_man', 'negr', 'vazovsky', 'lyaguha'];

BotClient.isMutant = function (id) {
  const skin = BotClient.skinnames[id % BotClient.skinnames.length];
  return skin === 'vazovsky' || skin === 'lyaguha';
};

BotClient.ready = function () { return true; };

BotClient.load = function () {
  Console.addCommand('skins', 'all available skins', function () {
    for (let i = 0; i < BotClient.skinnames.length; i++) Console.debug(BotClient.skinnames[i]);
  });

  BotClient.snd_gib = new Sound('gib');
  BotClient.snd_respawn = new Sound('respawn');
  startMd2Loads();
};

BotClient.SPEED = Bot.SPEED;

BotClient.renderFirstPersonWeapon = renderFirstPersonWeapon;

state.Bot = BotClient;
export { BotClient };
