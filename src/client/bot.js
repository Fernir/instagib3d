import { Event } from '@/core/event.js';
import { Console, config, assert } from '@/core/polyfill.js';
import { state, getMouseAngle, getMousePitch } from '@/core/runtime-state.js';
import { Vector } from '@/core/vector.js';

import { Shader } from '@/engine/shader.js';
import { UILayout } from '@/engine/render_text.js';

import { ITEM, WEAPON } from '@/global.js';

import { Bot } from '@/sim/bot.js';
import { Dynent } from '@/sim/dynent.js';

import { MD2Model } from './md2.js';
import { Sound } from './sound.js';
import { SpawnFx } from './spawnfx.js';
import { WeaponClient } from './weapon.js';

const MD2_SCALE = 0.036;
const MD2_Y_OFFSET = 0.87;

const MD2_SPECS = [
  { model: '/game/models/q2/male/tris.md2', skin: '/game/models/q2/male/grunt.png' },
  { model: '/game/models/q2/male/tris.md2', skin: '/game/models/q2/male/cipher.png' },
  { model: '/game/models/q2/male/tris.md2', skin: '/game/models/q2/male/rampage.png' },
  { model: '/game/models/q2/female/tris.md2', skin: '/game/models/q2/female/athena.png' },
  { model: '/game/models/q2/cyborg/tris.md2', skin: '/game/models/q2/cyborg/rebornblue.png' },
  { model: '/game/models/q2/cyborg/tris.md2', skin: '/game/models/q2/cyborg/rebornred.png' },
  { model: '/game/models/q2/crafty/tris.md2', skin: '/game/models/q2/crafty/crafty.png' },
  { model: '/game/models/q2/sydney/tris.md2', skin: '/game/models/q2/sydney/sydney.png' },
  { model: '/game/models/q2/nekochan/tris.md2', skin: '/game/models/q2/nekochan/gaenisa.png' },
  { model: '/game/models/q2/massm/tris.md2', skin: '/game/models/q2/massm/massm.png' },
  { model: '/game/models/q2/mcclane/tris.md2', skin: '/game/models/q2/mcclane/nakatomi1.png' },
  { model: '/game/models/q2/homer/tris.md2', skin: '/game/models/q2/homer/homer.png' },
  { model: '/game/models/q2/faerie/tris.md2', skin: '/game/models/q2/faerie/faerie1.png' },
  { model: '/game/models/q2/alien/tris.md2', skin: '/game/models/q2/alien/alien.png' },
];

const ANIM_TABLE = {
  stand: { prefix: 'stand', fps: 10, once: false },
  run: { prefix: 'run', fps: 12, once: false },
  attack: { prefix: 'attack', fps: 15, once: false },
  pain: { prefix: 'pain1', fps: 20, once: true, count: 4 },
  // prefix 'death' (не 'death1'): у части моделей кадры названы death1..death20
  // (три анимации смерти подряд), и 'death1' хватал death1+death10..19 — тело
  // падало дважды. Берём первую анимацию смерти — первые count кадров по порядку.
  death: { prefix: 'death', fps: 8, once: true, count: 6 },
};

function md2Anim(name) {
  return ANIM_TABLE[name] || ANIM_TABLE.stand;
}

// Канонический порядок кадров игрока Quake 2 (фиксированный layout из 198 кадров).
// Нужен как фолбэк для пользовательских моделей (crafty, nekochan, …), у которых
// кадры названы обобщённо ("Frame 1", "Frame 2"…) — тогда поиск по префиксу
// (framesByPrefix('stand')) ничего не находит и модель вообще не рисуется.
const MD2_FRAME_RANGES = {
  stand: [0, 39],
  run: [40, 45],
  attack: [46, 53],
  pain: [54, 57],
  death: [178, 183],
};

function md2Frames(model, name) {
  if (!model._animCache) model._animCache = {};
  if (model._animCache[name]) return model._animCache[name];

  const anim = md2Anim(name);
  let frames = model.framesByPrefix(anim.prefix);

  // Ограничиваем длину (первая анимация смерти): иначе у моделей с death1..death20
  // в один заход проигрываются несколько падений подряд.
  if (anim.count && frames.length > anim.count) frames = frames.slice(0, anim.count);

  // Фолбэк для моделей с обобщёнными именами кадров: берём кадры по их позиции
  // в стандартном Q2-layout. Иначе тело такого бота было бы полностью невидимым.
  if (!frames.length) {
    const total = model.frameBuffers ? model.frameBuffers.length : 0;
    const range = MD2_FRAME_RANGES[name] || MD2_FRAME_RANGES.stand;
    frames = [];
    for (let i = range[0]; i <= range[1] && i < total; i++) frames.push(i);
    if (!frames.length && total) frames = [0];
  }

  model._animCache[name] = frames;
  return model._animCache[name];
}

const PAIN_ANIM_MS = 220;
const PAIN_COOLDOWN_MS = 140;

function chooseAnim(bot) {
  if (bot.spawnStartTime && SpawnFx.botAppearance(bot.spawnStartTime).spawning) return 'stand';
  if (!bot.alive) return 'death';
  if (bot.painStartTime && Date.now() - bot.painStartTime < PAIN_ANIM_MS) return 'pain';
  if (bot.weapon && bot.weapon.shooting && Date.now() < bot.weapon.dead) return 'attack';
  if (bot.begin_of_walk !== 0) return 'run';
  return 'stand';
}

const CORPSE_LIFETIME_MS = 14000;
const CORPSE_FADE_MS = 2500;

// Поза MD2-бота: модель, матрица и пара кадров с lerp для текущей анимации.
// Используется и обычным рендером, и проходом карты теней.
function botPose(bot, spec) {
  const model = spec.model;
  const animName = chooseAnim(bot);
  const frames = md2Frames(model, animName);
  if (!frames.length) return null;

  const anim = md2Anim(animName);
  const now = Date.now();
  let cursor;
  if (anim.once) {
    let start = now;
    if (animName === 'death') start = bot.deathStartTime || now;
    else if (animName === 'pain') start = bot.painStartTime || now;
    cursor = ((now - start) / 1000) * anim.fps;
    if (cursor >= frames.length - 1) cursor = frames.length - 1.0001;
  } else {
    cursor = (now / 1000) * anim.fps;
    cursor -= Math.floor(cursor / frames.length) * frames.length;
  }
  const ia = Math.floor(cursor);
  const lerp = cursor - ia;
  const ib = anim.once ? Math.min(frames.length - 1, ia + 1) : (ia + 1) % frames.length;

  const mat4 = state.mat4;
  const m = mat4.create();
  mat4.identity(m);
  const kickX = bot.alive ? bot.painKickX || 0 : bot.deathSlideX || 0;
  const kickY = bot.alive ? bot.painKickY || 0 : bot.deathSlideY || 0;
  mat4.translate(m, m, [bot.dynent.pos.x + kickX, MD2_Y_OFFSET, bot.dynent.pos.y + kickY]);
  mat4.rotateY(m, m, bot.dynent.angle);
  mat4.scale(m, m, [MD2_SCALE, MD2_SCALE, MD2_SCALE]);

  return { model, m, fa: frames[ia], fb: frames[ib], lerp };
}

function renderBotMD2(camera, bot, spec, distFog, spawnAlpha = 1, spawnScale = 1) {
  const pose = botPose(bot, spec);
  if (!pose) return false;
  const model = pose.model;
  const m = pose.m;
  const lerp = pose.lerp;
  const now = Date.now();
  const mat4 = state.mat4;

  if (spawnScale !== 1) {
    mat4.scale(m, m, [spawnScale, spawnScale, spawnScale]);
  }

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
  color[3] = fadeAlpha * Math.max(0, Math.min(1, spawnAlpha));

  const gl = state.gl;
  const needsBlend = fadeAlpha < 0.999 || spawnAlpha < 0.999;
  if (needsBlend) {
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
  const lightCtx = lr
    ? {
        sunDir: lr.sunDir || [0.6, -0.8, 0.4],
        distFog: distFog || 0,
      }
    : null;
  model.render(m, pose.fa, pose.fb, lerp, spec.skinIndex, color, lightCtx);

  // Q2-оружие игрока — это просто ДРУГАЯ entity с тем же origin/angles/frame/oldframe
  // (см. id-Software/Quake-2/client/cl_ents.c: дублирование сущности при modelindex2).
  // Оба MD2 имеют одинаковый порядок 198 кадров, так что используем те же индексы
  // (`frames[ia]`, `frames[ib]`) и тот же lerp — оружие не отстаёт и не исчезает
  // во время pain/death (где префиксы в w_*.md2 отличаются от player.md2).
  // Оружие в руках — только пока бот жив; после смерти дроп лежит на земле отдельным пикапом.
  if (bot.alive && bot.weapon) {
    const wSpec = getWeaponSpec(spec, bot.weapon.type);
    if (wSpec && wSpec.model.frameBuffers && wSpec.model.frameBuffers.length) {
      const last = wSpec.model.frameBuffers.length - 1;
      const wia = Math.max(0, Math.min(last, pose.fa | 0));
      const wib = Math.max(0, Math.min(last, pose.fb | 0));
      wSpec.model.render(m, wia, wib, lerp, wSpec.skinIndex, [1, 1, 1, fadeAlpha * spawnAlpha], {
        ...lightCtx,
        weaponBoost: 0.72,
      });
    }
  }

  if (bot.alive && !bot.shield && bot.power) {
    let neon = null;
    if (bot.power === ITEM.QUAD) neon = [0.4, 0.2, 1.0, 1];
    else if (bot.power === ITEM.REGEN) neon = [0.25, 1.0, 0.35, 1];
    else if (bot.power === ITEM.SPEED) neon = [1.0, 0.85, 0.25, 1];
    if (neon) {
      const pulse = 0.7 + 0.3 * Math.sin(now * 0.008);
      const tint = [neon[0] * pulse, neon[1] * pulse, neon[2] * pulse, 1];
      model.renderOutline(m, pose.fa, pose.fb, lerp, tint, 0.7);
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

// Индекс «кончика ствола» в меше оружия — самая передняя вершина (макс Q2 +X).
// Кешируется на модели. Берётся из кадра 0, индексация вершин одинакова во всех кадрах.
function weaponMuzzleVertexIndex(model) {
  if (model._muzzleVI !== undefined) return model._muzzleVI;
  const v =
    model.md2 && model.md2.frames && model.md2.frames[0] ? model.md2.frames[0].vertices : null;
  let bi = -1;
  if (v) {
    let best = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
      if (v[i] > best) {
        best = v[i];
        bi = i;
      }
    }
  }
  model._muzzleVI = bi;
  return bi;
}

// Мировая точка кончика ствола: берём вершину-дуло из текущего интерполируемого
// кадра и прогоняем через ту же матрицу, что и сам меш оружия.
function publishLocalMuzzle(model, fIa, fIb, lerp, m, fwd, now) {
  const vi = weaponMuzzleVertexIndex(model);
  if (vi < 0) return;
  const fa = model.md2.frames[fIa] && model.md2.frames[fIa].vertices;
  const fb = model.md2.frames[fIb] && model.md2.frames[fIb].vertices;
  if (!fa || !fb) return;
  const qx = fa[vi] * (1 - lerp) + fb[vi] * lerp;
  const qy = fa[vi + 1] * (1 - lerp) + fb[vi + 1] * lerp;
  const qz = fa[vi + 2] * (1 - lerp) + fb[vi + 2] * lerp;
  // Q2(forward,side,up) -> engine model-space (X=side, Y=up, Z=-forward).
  const ex = qy,
    ey = qz,
    ez = -qx;
  // m — column-major (gl-matrix): world = m * [ex,ey,ez,1].
  const wx = m[0] * ex + m[4] * ey + m[8] * ez + m[12];
  const wy = m[1] * ex + m[5] * ey + m[9] * ez + m[13];
  const wz = m[2] * ex + m[6] * ey + m[10] * ez + m[14];
  state.localMuzzle = {
    x: wx,
    y: wy,
    z: wz,
    fx: fwd[0],
    fy: fwd[1],
    fz: fwd[2],
    time: now,
  };
}

function renderFirstPersonWeapon(camera) {
  if (!camera || !state.viewProj3D) return;
  if (!state.gameClient) return;
  const myBot = state.gameClient.getCamera ? state.gameClient.getCamera() : null;
  if (!myBot || !myBot.weapon || !myBot.alive) return;

  // FP-view: resolveViewWeaponPose выбирает модель и кадры (idle/pow/putway/active).
  const pose = resolveViewWeaponPose(myBot);
  if (!pose) return;
  const wSpec = pose.wSpec;
  const ia = pose.ia;
  const ib = pose.ib;
  const lerp = pose.lerp;

  const now = Date.now();
  const gl = state.gl;
  const mat4 = state.mat4;

  // Лёгкий «боб» при движении: вертикальное колебание + горизонтальный покач.
  const speed = myBot.speed || 0;
  const bobAmp = Math.min(1, speed / (Bot.SPEED * 0.5));
  const t = now * 0.012;
  const bobScale = viewWepSwitch.phase !== 'idle' ? 0.12 : 1;
  const bobY = Math.sin(t * 2.0) * 0.018 * bobAmp * bobScale;
  const bobX = Math.cos(t) * 0.022 * bobAmp * bobScale;

  const yaw = camera.dynent.angle;
  const pitch = typeof getMousePitch === 'function' ? getMousePitch() : 0;
  const eye_h = (state.LevelRender && state.LevelRender.eye_height) || 1.6;

  // Направления камеры (right/up/forward) — те же, что в level3d.js буфере камеры.
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const sy = Math.sin(yaw),
    cy = Math.cos(yaw);
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
  const offDown = bobY;
  const offFwd = 0;

  const wpx = eye_x + right_x * offRight + up_x * offDown + fwd_x * offFwd;
  const wpy = eye_y + right_y * offRight + up_y * offDown + fwd_y * offFwd;
  const wpz = eye_z + right_z * offRight + up_z * offDown + fwd_z * offFwd;

  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [wpx, wpy, wpz]);
  mat4.rotateY(m, m, yaw);
  mat4.rotateX(m, m, pitch);
  // Q2 view-модели: зеркало по X для правильного хвата (как до правок UV).
  const VIEW_SCALE = 0.028;
  mat4.scale(m, m, [-VIEW_SCALE, VIEW_SCALE, VIEW_SCALE]);

  // Физический кончик ствола в мире — для луча/вспышки/старта снарядов.
  publishLocalMuzzle(wSpec.model, ia, ib, lerp, m, [fwd_x, fwd_y, fwd_z], now);

  const wasDepth = gl.isEnabled(gl.DEPTH_TEST);
  const wasCull = gl.isEnabled(gl.CULL_FACE);
  const wasBlend = gl.isEnabled(gl.BLEND);
  const wasDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);

  // Q2 RF_WEAPONMODEL: рисуем поверх мира; scale(-X) инвертирует winding → cull FRONT.
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
  wSpec.model.render(m, ia, ib, lerp, wSpec.skinIndex, [1.12, 1.12, 1.12, 1], {
    sunDir: lr2 && lr2.sunDir ? lr2.sunDir : [0.4, -0.85, 0.35],
    worldRef: [camera.dynent.pos.x, eye_h, camera.dynent.pos.y],
    weaponBoost: 1,
  });

  gl.depthMask(wasDepthMask);
  if (wasDepth) gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);
  if (wasCull) gl.enable(gl.CULL_FACE);
  else gl.disable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  if (wasBlend) gl.enable(gl.BLEND);
  else gl.disable(gl.BLEND);
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
    right_x,
    0,
    right_z,
    0,
    0,
    1,
    0,
    0,
    -right_z,
    0,
    right_x,
    0,
    0,
    0,
    0,
    1,
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

function drawHpBar(nx, ny, width, height, ratio, opacity) {
  const gl = state.gl;
  if (!state.quadBuffer) return;
  const a = opacity === undefined ? 1 : Math.max(0, Math.min(1, opacity));
  const snapped = UILayout.snapNdcCenter(nx, ny);
  nx = snapped.nx;
  ny = snapped.ny;

  const bar = UILayout.snapBarHalfSize(width, height);
  const hw = bar.hw;
  const hh = bar.hh;
  const border = 1;
  const hwBorder = (bar.widthPx + border * 2) / (2 * state.canvas.width);
  const hhBorder = (bar.heightPx + border * 2) / (2 * state.canvas.height);

  const sh = ensureHpBarShader();
  const wasBlend = gl.isEnabled(gl.BLEND);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  sh.use();
  sh.vector(sh.rect, [nx, ny, hwBorder, hhBorder]);
  sh.vector(sh.color, [0, 0, 0, 0.85 * a]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  sh.vector(sh.rect, [nx, ny, hw, hh]);
  sh.vector(sh.color, [0.12, 0.12, 0.12, 0.85 * a]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const clamped = Math.max(0, Math.min(1, ratio));
  if (clamped > 0) {
    const fillPx = Math.max(1, Math.round(bar.widthPx * clamped));
    const fillW = fillPx / (2 * state.canvas.width);
    const fillX = nx - hw + fillW;
    let color = [0.25, 0.85, 0.25, 0.95 * a];
    if (clamped < 0.6) color = [0.95, 0.85, 0.2, 0.95 * a];
    if (clamped < 0.3) color = [0.95, 0.25, 0.2, 0.95 * a];
    sh.vector(sh.rect, [fillX, ny, fillW, hh]);
    sh.vector(sh.color, color);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  if (!wasBlend) gl.disable(gl.BLEND);
}


// Прямая видимость по карте стен — для ников/HP, не для моделей.
function hasLineOfSightTo(camera, targetPos) {
  const lr = state.LevelRender;
  if (lr && lr.hasLineOfSight) {
    return lr.hasLineOfSight(camera.pos, targetPos);
  }
  return true;
}

// Проекция головы бота в NDC: ник/HP только когда модель попадает в кадр.
function botHeadScreenPos(bot) {
  const vp = state.viewProj3D;
  if (!vp) return null;
  const headY = MD2_Y_OFFSET + 1.55;
  const wx = bot.dynent.pos.x;
  const wz = bot.dynent.pos.y;
  const cx = vp[0] * wx + vp[4] * headY + vp[8] * wz + vp[12];
  const cy = vp[1] * wx + vp[5] * headY + vp[9] * wz + vp[13];
  const cw = vp[3] * wx + vp[7] * headY + vp[11] * wz + vp[15];
  if (cw <= 0.05) return null;
  const nx = cx / cw;
  const ny = cy / cw;
  if (nx < -1.0 || nx > 1.0 || ny < -1.0 || ny > 1.0) return null;
  return { nx, ny };
}

function pickMD2Spec(id) {
  const specs = BotClient.md2Specs;
  if (!specs || !specs.length) return null;
  return specs[id % specs.length] || null;
}

async function loadAllMd2Specs() {
  BotClient.md2LoadsDone = false;
  for (let index = 0; index < MD2_SPECS.length; index++) {
    const entry = MD2_SPECS[index];
    try {
      let model = BotClient.md2Cache.get(entry.model);
      if (!model) {
        model = await MD2Model.load(entry.model, []);
        BotClient.md2Cache.set(entry.model, model);
      }
      const skinIndex = model.addSkin(entry.skin);
      const bodyDir = entry.model.slice(0, entry.model.lastIndexOf('/') + 1);
      const weapons = await ensureBodyWeapons(bodyDir);
      BotClient.md2Specs[index] = { model, skinIndex, bodyDir, weapons };
    } catch (err) {
      Console.warn(
        'MD2 spec load failed: ' + entry.model + ' / ' + entry.skin + ': ' + err.message,
      );
    }
  }
  BotClient.md2LoadsDone = true;
}

const MD2_MESH_VERSION = 8;

function startMd2Loads() {
  if (BotClient.md2MeshVersion === MD2_MESH_VERSION && BotClient.md2LoadPromise) return;
  BotClient.md2MeshVersion = MD2_MESH_VERSION;
  BotClient.md2LoadPromise = null;
  BotClient.md2Cache = new Map();
  BotClient.weaponPerBody = new Map(); // bodyDir -> { [weaponType]: { model, skinIndex } }
  BotClient.md2Specs = new Array(MD2_SPECS.length);
  BotClient.md2LoadPromise = loadAllMd2Specs();
  startViewWeaponMd2Loads();
}

// Q2-модели оружия — по одному набору на каждую модель игрока (male/female/cyborg).
// Файлы лежат рядом с tris.md2: players/<body>/w_*.md2 в оригинальном baseq2.
const Q2_WEAPON_FILES = {
  [WEAPON.PISTOL]: 'w_blaster.md2',
  [WEAPON.SHAFT]: 'w_chaingun.md2',
  [WEAPON.RAIL]: 'w_railgun.md2',
  [WEAPON.PLASMA]: 'w_hyperblaster.md2',
  [WEAPON.ZENIT]: 'w_glauncher.md2',
  [WEAPON.ROCKET]: 'w_rlauncher.md2',
};

// Скины g_* из pickups/ — размер совпадает с header w_*.md2 (312×183 и т.д.).
// Общий weapon.png (136×60) не подходит: UV уезжают, текстура «ломается».
const Q2_PICKUP_SKIN_PATH = '/game/models/q2/pickups/';
const Q2_WEAPON_SKIN_FILES = {
  [WEAPON.PISTOL]: 'blaster.png',
  [WEAPON.SHAFT]: 'chaingun.png',
  [WEAPON.RAIL]: 'railgun.png',
  [WEAPON.PLASMA]: 'hyperblaster.png',
  [WEAPON.ZENIT]: 'glauncher.png',
  [WEAPON.ROCKET]: 'rlauncher.png',
};

async function ensureBodyWeapons(bodyDir) {
  if (BotClient.weaponPerBody.has(bodyDir)) {
    return BotClient.weaponPerBody.get(bodyDir);
  }
  const weapons = {};
  BotClient.weaponPerBody.set(bodyDir, weapons);

  // Многие пользовательские модели игроков (sydney, massm, homer, ...) несут
  // лишь один обобщённый weapon.md2 вместо набора w_*.md2. В этом случае
  // используем его как fallback для всех типов оружия. Промис мемоизируется,
  // чтобы параллельные загрузки делили один разбор файла.
  let fallbackPromise = null;
  const getFallback = () => {
    if (!fallbackPromise) {
      fallbackPromise = (async () => {
        try {
          const model = await MD2Model.load(bodyDir + 'weapon.md2', []);
          return { model, skinIndex: model.addSkin(bodyDir + 'weapon.png') };
        } catch {
          return null;
        }
      })();
    }
    return fallbackPromise;
  };

  await Promise.all(
    Object.keys(Q2_WEAPON_FILES).map(async (key) => {
      const file = Q2_WEAPON_FILES[key];
      try {
        const model = await MD2Model.load(bodyDir + file, []);
        const skinIndex = model.addSkin(Q2_PICKUP_SKIN_PATH + Q2_WEAPON_SKIN_FILES[key]);
        weapons[key] = { model, skinIndex };
      } catch (err) {
        const fb = await getFallback();
        if (fb) weapons[key] = fb;
        else Console.warn('Q2 body-weapon load failed: ' + bodyDir + file + ': ' + err.message);
      }
    }),
  );
  return weapons;
}

// Оригинальные Quake 2 first-person view-модели (`item->view_model`).
const Q2_VIEW_WEAPON_PATH = '/game/models/q2/viewweapons/';
const Q2_VIEW_WEAPON_FILES = {
  [WEAPON.PISTOL]: { model: 'blaster.md2', skin: 'blaster.png' },
  [WEAPON.SHAFT]: { model: 'chaingun.md2', skin: 'chaingun.png' },
  [WEAPON.RAIL]: { model: 'railgun.md2', skin: 'railgun.png' },
  [WEAPON.PLASMA]: { model: 'hyperblaster.md2', skin: 'hyperblaster.png' },
  [WEAPON.ZENIT]: { model: 'glauncher.md2', skin: 'glauncher.png' },
  [WEAPON.ROCKET]: { model: 'rlauncher.md2', skin: 'rlauncher.png' },
};

function startViewWeaponMd2Loads() {
  if (BotClient.viewWeaponMd2Version === MD2_MESH_VERSION && BotClient.viewWeaponMd2) return;
  BotClient.viewWeaponMd2Version = MD2_MESH_VERSION;
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

const VIEW_WEAPON_FPS = {
  putway: 18,
  active: 14,
  idle: 7,
  pow: 22,
};

const viewWepSwitch = {
  phase: 'idle',
  fromType: WEAPON.PISTOL,
  toType: WEAPON.PISTOL,
  phaseStart: 0,
};

function viewWeaponAnimFrames(model, animName) {
  if (!model._viewAnimCache) model._viewAnimCache = {};
  if (!model._viewAnimCache[animName]) {
    let frames = model.framesByPrefix(animName);
    if (!frames.length && animName === 'idle') {
      frames = model.framesByPrefix('active');
      if (!frames.length) frames = model.framesByPrefix('idle');
    }
    if (!frames.length && model.frameBuffers && model.frameBuffers.length) frames = [0];
    model._viewAnimCache[animName] = {
      frames,
      once: animName === 'putway' || animName === 'active',
      fps: VIEW_WEAPON_FPS[animName] || 10,
    };
  }
  return model._viewAnimCache[animName];
}

function advanceViewWeaponAnim(frameSet, startTime) {
  const frames = frameSet.frames;
  if (!frames.length) return { done: true, ia: 0, ib: 0, lerp: 0 };
  const fps = frameSet.fps || 10;
  const now = Date.now();
  let cursor =
    startTime > 0 ? ((now - startTime) / 1000) * fps : (now / 1000) * fps;
  if (frameSet.once) {
    if (cursor >= frames.length - 1) {
      const last = frames[frames.length - 1];
      return { done: true, ia: last, ib: last, lerp: 0 };
    }
    const ia = Math.floor(cursor);
    const ib = Math.min(frames.length - 1, ia + 1);
    return { done: false, ia: frames[ia], ib: frames[ib], lerp: cursor - ia };
  }
  cursor -= Math.floor(cursor / frames.length) * frames.length;
  const ia = Math.floor(cursor);
  const ib = (ia + 1) % frames.length;
  return { done: false, ia: frames[ia], ib: frames[ib], lerp: cursor - ia };
}

function beginViewWeaponSwitch(fromType, toType) {
  if (fromType === toType) return;
  let actualFrom = fromType;
  if (viewWepSwitch.phase === 'putaway') actualFrom = viewWepSwitch.fromType;
  else if (viewWepSwitch.phase === 'active') actualFrom = viewWepSwitch.toType;
  if (actualFrom === toType) return;
  const oldSpec = getViewWeaponSpec(actualFrom);
  const putFrames =
    oldSpec && viewWeaponAnimFrames(oldSpec.model, 'putway').frames.length
      ? viewWeaponAnimFrames(oldSpec.model, 'putway').frames
      : null;
  if (!putFrames || !putFrames.length) {
    const newSpec = getViewWeaponSpec(toType);
    const activeFrames =
      newSpec && viewWeaponAnimFrames(newSpec.model, 'active').frames.length
        ? viewWeaponAnimFrames(newSpec.model, 'active').frames
        : null;
    if (!activeFrames || !activeFrames.length) {
      viewWepSwitch.phase = 'idle';
      return;
    }
    viewWepSwitch.phase = 'active';
    viewWepSwitch.fromType = actualFrom;
    viewWepSwitch.toType = toType;
    viewWepSwitch.phaseStart = Date.now();
    return;
  }
  viewWepSwitch.phase = 'putaway';
  viewWepSwitch.fromType = actualFrom;
  viewWepSwitch.toType = toType;
  viewWepSwitch.phaseStart = Date.now();
}

function updateViewWeaponSwitch() {
  if (viewWepSwitch.phase === 'idle') return;
  const weaponType = viewWepSwitch.phase === 'putaway' ? viewWepSwitch.fromType : viewWepSwitch.toType;
  const animName = viewWepSwitch.phase === 'putaway' ? 'putway' : 'active';
  const wSpec = getViewWeaponSpec(weaponType);
  if (!wSpec) {
    viewWepSwitch.phase = 'idle';
    return;
  }
  const frameSet = viewWeaponAnimFrames(wSpec.model, animName);
  const adv = advanceViewWeaponAnim(frameSet, viewWepSwitch.phaseStart);
  if (!adv.done) return;
  if (viewWepSwitch.phase === 'putaway') {
    const newSpec = getViewWeaponSpec(viewWepSwitch.toType);
    const activeFrames =
      newSpec && viewWeaponAnimFrames(newSpec.model, 'active').frames.length
        ? viewWeaponAnimFrames(newSpec.model, 'active').frames
        : null;
    if (activeFrames && activeFrames.length) {
      viewWepSwitch.phase = 'active';
      viewWepSwitch.phaseStart = Date.now();
    } else {
      viewWepSwitch.phase = 'idle';
    }
    return;
  }
  viewWepSwitch.phase = 'idle';
}

function resolveViewWeaponPose(myBot) {
  updateViewWeaponSwitch();
  const now = Date.now();
  const switching = viewWepSwitch.phase !== 'idle';
  const firing =
    !switching && myBot.weapon.shooting && now < myBot.weapon.dead && myBot.weapon.type !== WEAPON.SHAFT;

  let weaponType = myBot.weapon.type;
  let animName = firing ? 'pow' : 'idle';
  let startTime = 0;

  if (viewWepSwitch.phase === 'putaway') {
    weaponType = viewWepSwitch.fromType;
    animName = 'putway';
    startTime = viewWepSwitch.phaseStart;
  } else if (viewWepSwitch.phase === 'active') {
    weaponType = viewWepSwitch.toType;
    animName = 'active';
    startTime = viewWepSwitch.phaseStart;
  } else if (firing) {
    const lifetime = WeaponClient.wea_tabl[weaponType].lifetime || 100;
    startTime = myBot.weapon.dead - lifetime;
  }

  const myBodySpec = pickMD2Spec(myBot.id || 0);
  const wSpec = getViewWeaponSpec(weaponType) || getWeaponSpec(myBodySpec, weaponType);
  if (!wSpec) return null;

  const frameSet = viewWeaponAnimFrames(wSpec.model, animName);
  const adv = advanceViewWeaponAnim(frameSet, startTime);
  return { wSpec, ia: adv.ia, ib: adv.ib, lerp: adv.lerp };
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
    this.spawnStartTime = 0;
    this.deathStartTime = 0;
    this.painStartTime = 0;
    this.painKickX = 0;
    this.painKickY = 0;
    this.deathSlideX = 0;
    this.deathSlideY = 0;

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
    if (!this.alive && serverBot.alive) {
      this.deathStartTime = 0;
    }
    this.alive = serverBot.alive;
    this.power = serverBot.power;
    this.shield = serverBot.shield;
    this.health_ratio = serverBot.health_ratio !== undefined ? serverBot.health_ratio : 1;
    const prevWeapon = this.weapon.type;
    this.weapon.setType(serverBot.weapon);
    if (isCamera && prevWeapon !== serverBot.weapon) {
      beginViewWeaponSwitch(prevWeapon, serverBot.weapon);
    }
    if (serverBot.shoot) this.weapon.shoot();
    if (serverBot.seria !== this.seria) this.seria = serverBot.seria;

    this.life = serverBot.life;
    this.patrons = serverBot.patrons;

    this.frag = serverBot.frag;
    this.scores = serverBot.scores;
    this.rank = serverBot.rank;

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
      if (this.deathSlideX || this.deathSlideY) {
        this.deathSlideX *= 0.9;
        this.deathSlideY *= 0.9;
        if (Math.abs(this.deathSlideX) < 0.003) {
          this.deathSlideX = 0;
          this.deathSlideY = 0;
        }
      }
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

    if (this.painKickX || this.painKickY) {
      this.painKickX *= 0.84;
      this.painKickY *= 0.84;
      if (Math.abs(this.painKickX) < 0.002) {
        this.painKickX = 0;
        this.painKickY = 0;
      }
    }
  }

  render(camera) {
    if (this.dynent === camera) return;
    const spawn = SpawnFx.botAppearance(this.spawnStartTime);
    if (this.spawnStartTime && !spawn.spawning) this.spawnStartTime = 0;

    if (!this.alive) {
      const dt = this.deathStartTime ? Date.now() - this.deathStartTime : Infinity;
      if (dt > CORPSE_LIFETIME_MS && !spawn.spawning) return;
    }

    const spec = pickMD2Spec(this.id);
    if (!spec || !spec.model.ready()) return;

    if (spawn.spawning) {
      if (spawn.alpha > 0.002) {
        renderBotMD2(camera, this, spec, 0, spawn.alpha, spawn.scale);
      }
      return;
    }

    renderBotMD2(camera, this, spec, 0);
  }

  // Глубина бота в карту теней (light-space). Кастит и живой моб, и труп.
  renderShadow(lightVP, selfDynent) {
    if (this.dynent === selfDynent) return;
    if (!this.alive) {
      const dt = this.deathStartTime ? Date.now() - this.deathStartTime : Infinity;
      if (dt > CORPSE_LIFETIME_MS) return;
    }
    const spec = pickMD2Spec(this.id);
    if (!spec || !spec.model.ready()) return;
    const pose = botPose(this, spec);
    if (!pose) return;
    pose.model.renderDepth(pose.m, pose.fa, pose.fb, pose.lerp, lightVP);
    if (this.alive && this.weapon) {
      const wSpec = getWeaponSpec(spec, this.weapon.type);
      if (wSpec && wSpec.model.frameBuffers && wSpec.model.frameBuffers.length) {
        const last = wSpec.model.frameBuffers.length - 1;
        const wia = Math.max(0, Math.min(last, pose.fa | 0));
        const wib = Math.max(0, Math.min(last, pose.fb | 0));
        wSpec.model.renderDepth(pose.m, wia, wib, pose.lerp, lightVP);
      }
    }
  }

  renderStats(camera) {
    if (this.dynent === camera) return;
    if (!this.alive) return;
    if (!hasLineOfSightTo(camera, this.dynent.pos)) return;

    const head = botHeadScreenPos(this);
    if (!head) return;

    const lr = state.LevelRender;
    const lum = lr && lr.getLightLevel ? lr.getLightLevel(this.dynent.pos.x, this.dynent.pos.y) : 1;
    const light = Math.max(0.35, Math.min(1.15, lum));
    const vis = light;

    const nick = state.gameClient.getNickById(this.id);
    state.text.render([head.nx, head.ny + 0.02], 2, nick, 1, { center: true, alpha: 2 * vis });

    const hp = Math.max(0, Math.min(1, this.health_ratio !== undefined ? this.health_ratio : 1));
    drawHpBar(head.nx, head.ny - 0.03, 0.16, 0.012, hp, vis);
  }
}

BotClient.skinnames = ['blue_man', 'red_man', 'negr', 'vazovsky', 'lyaguha'];

BotClient.isMutant = function (id) {
  const skin = BotClient.skinnames[id % BotClient.skinnames.length];
  return skin === 'vazovsky' || skin === 'lyaguha';
};

BotClient.ready = function () {
  if (!BotClient.md2LoadPromise) return false;
  return BotClient.md2LoadsDone === true;
};

BotClient.load = function () {
  BotClient.snd_gib = new Sound('gib');
  BotClient.snd_respawn = new Sound('respawn');
  startMd2Loads();
};

BotClient.SPEED = Bot.SPEED;

BotClient.renderFirstPersonWeapon = renderFirstPersonWeapon;

Event.on('cl_botpain', function (pos, dir, id) {
  const gc = state.gameClient;
  if (!gc) return;
  const bot = gc.getBotById(id);
  if (!bot || !bot.alive) return;

  let severity = 1;
  if (dir) {
    const dlen = dir.length();
    const nearBot = Math.hypot(pos.x - bot.dynent.pos.x, pos.y - bot.dynent.pos.y) < 1.2;
    if (nearBot && dlen > 0.001 && dlen <= WEAPON.RADIUS_ROCKET + 0.5) severity = 3;
    else if (dlen > 0.015) severity = 2;
  }

  const now = Date.now();
  if (bot.painStartTime && now - bot.painStartTime < PAIN_COOLDOWN_MS && severity < 3) return;

  bot.painStartTime = now;
  if (dir && dir.length() > 1e-6) {
    const len = dir.length();
    const kick = severity === 3 ? 0.24 : severity === 2 ? 0.09 : 0.04;
    bot.painKickX = (dir.x / len) * kick;
    bot.painKickY = (dir.y / len) * kick;
  }
});

state.Bot = BotClient;
export { BotClient };
