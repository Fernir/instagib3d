import { Texture } from '../engine/texture.js';
import { Console } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { ITEM, WEAPON } from '../server/game/global.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent } from '../server/objects/dynent.js';
import { Item } from '../server/objects/item.js';

import { MD2Model } from './md2.js';
import { PickupIcon } from './pickupicon.js';
import { Sound } from './sound.js';

// 3D-иконка и цвет каждого пауэрапа: медицинский крест (HP), щит, буквы Q/R/S.
const POWERUP_ICONS = {
  [ITEM.LIFE]: { glyph: 'cross', color: [1.0, 0.25, 0.3] },
  [ITEM.SHIELD]: { glyph: 'shield', color: [0.4, 0.7, 1.0] },
  [ITEM.QUAD]: { glyph: 'Q', color: [0.65, 0.35, 1.0] },
  [ITEM.REGEN]: { glyph: 'R', color: [0.4, 1.0, 0.5] },
  [ITEM.SPEED]: { glyph: 'S', color: [1.0, 0.8, 0.25] },
};

// Quake 2 world weapon models (g_*/tris.md2). Цвет outline — типовая «подсветка»
// каждого оружия в Q2 (sniper rifle красный, hyperblaster фиолетовый, etc.).
const PICKUP_PATH = '/game/models/q2/pickups/';
const PICKUP_SPECS = {
  [WEAPON.PISTOL]: { model: 'blaster.md2', skin: 'blaster.png', color: [1.0, 0.85, 0.25] },
  [WEAPON.SHAFT]: { model: 'chaingun.md2', skin: 'chaingun.png', color: [0.4, 0.85, 1.0] },
  [WEAPON.RAIL]: { model: 'railgun.md2', skin: 'railgun.png', color: [1.0, 0.3, 0.3] },
  [WEAPON.PLASMA]: { model: 'hyperblaster.md2', skin: 'hyperblaster.png', color: [0.85, 0.4, 1.0] },
  [WEAPON.ZENIT]: { model: 'glauncher.md2', skin: 'glauncher.png', color: [0.3, 1.0, 0.4] },
  [WEAPON.ROCKET]: { model: 'rlauncher.md2', skin: 'rlauncher.png', color: [1.0, 0.55, 0.2] },
};

function startPickupModelLoads() {
  if (Item._pickupStarted) return;
  Item._pickupStarted = true;
  Item.pickupMd2 = {};
  Object.keys(PICKUP_SPECS).forEach(async (key) => {
    const spec = PICKUP_SPECS[key];
    try {
      const model = await MD2Model.load(PICKUP_PATH + spec.model, []);
      const skinIndex = model.addSkin(PICKUP_PATH + spec.skin);
      Item.pickupMd2[key] = { model, skinIndex, color: spec.color };
    } catch (err) {
      Console.warn('Pickup MD2 load failed: ' + spec.model + ': ' + err.message);
    }
  });
}

// Модельная матрица оружейного пикапа (покачивание + вращение). Общая для рендера и тени.
function weaponPickupMatrix(item) {
  const now = Date.now();
  // Каждому предмету — свой фазовый сдвиг (по позиции), чтобы пикапы покачивались асинхронно.
  const phase = item.x * 0.71 + item.y * 0.93;
  const bobY = 0.55 + Math.sin(now * 0.003 + phase) * 0.1;
  const yaw = ((now % 4000) / 4000) * Math.PI * 2 + phase;
  const mat4 = state.mat4;
  const m = mat4.create();
  mat4.identity(m);
  mat4.translate(m, m, [item.x, bobY, item.y]);
  mat4.rotateY(m, m, yaw);
  mat4.scale(m, m, [0.036, 0.036, 0.036]);
  return m;
}

function renderWeaponPickup3D(item, camera) {
  if (!Item.pickupMd2) return false;
  const spec = Item.pickupMd2[item.type];
  if (!spec || !spec.model || !spec.model.frameBuffers || !spec.model.frameBuffers.length) {
    return false;
  }

  const lr = state.LevelRender;
  let distFog = 0;
  if (lr && lr.getWorldFog && camera) {
    const probe = { x: item.x, y: item.y };
    distFog = lr.getWorldFog(camera.pos, probe);
    if (distFog > 0.99) return true;
  }
  if (!spec.model.ready()) return false;

  const now = Date.now();
  const phase = item.x * 0.71 + item.y * 0.93;
  const m = weaponPickupMatrix(item);

  const gl = state.gl;
  const wasBlend = gl.isEnabled(gl.BLEND);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  const lightCtx = {
    sunDir: (lr && lr.sunDir) || [0.4, -0.85, 0.35],
    distFog,
  };
  const itemAlpha = Math.max(0, 1.0 - distFog * 0.96);
  spec.model.render(m, 0, 0, 0, spec.skinIndex, [1, 1, 1, itemAlpha], lightCtx);

  // Пульсирующий неоновый ободок цвета оружия (renderOutline сам аккуратно
  // переключает blend на additive и возвращает state).
  const pulse = 0.65 + 0.35 * Math.sin(now * 0.005 + phase);
  const c = spec.color;
  spec.model.renderOutline(m, 0, 0, 0, [c[0] * pulse, c[1] * pulse, c[2] * pulse, 1], 0.6);

  gl.disable(gl.CULL_FACE);
  if (wasBlend) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  return true;
}

Item.render = function (camera, item) {
  // Пауэрапы — 3D-иконки (крест/щит/буквы) с depth-тестом, не «просвечивают» сквозь стены.
  const icon = POWERUP_ICONS[item.type];
  if (icon) {
    Item.icon.render(item, camera, icon.glyph, icon.color);
    return;
  }

  if (renderWeaponPickup3D(item, camera)) return;

  const lr = state.LevelRender;
  if (lr && lr.getWorldFog) {
    const probe = { x: item.x, y: item.y };
    if (lr.getWorldFog(camera.pos, probe) > 0.99) return;
  }

  // Билбоард-фолбэк, пока MD2 оружия ещё грузится.
  const states = { y_anchor: 'feet', y_offset: 0.6 + Math.sin(Date.now() * 0.003) * 0.1 };
  Dynent.render(
    camera,
    state.Weapon.skins[item.type].gun,
    state.Weapon.shader_noshadow,
    new Vector(item.x, item.y),
    [1.2, 1.2],
    camera.angle,
    states,
  );
};

// Глубина предмета в карту теней (light-space): иконка-пауэрап или MD2-оружие.
Item.renderShadow = function (lightVP, item) {
  const icon = POWERUP_ICONS[item.type];
  if (icon) {
    Item.icon.renderShadow(lightVP, item, icon.glyph);
    return;
  }
  if (!Item.pickupMd2) return;
  const spec = Item.pickupMd2[item.type];
  if (!spec || !spec.model || !spec.model.ready()) return;
  spec.model.renderDepth(weaponPickupMatrix(item), 0, 0, 0, lightVP);
};

Item.load = function () {
  Item.icon = new PickupIcon();
  // HUD продолжает использовать плоскую иконку здоровья; мировые пауэрапы уже 3D.
  Item.tex_powerup = [new Texture('/game/textures/fx/life.png')];

  Item.snd_health = new Sound('health');
  Item.snd_weapon = new Sound('pkup');
  Item.snd_power = new Sound('power');
  Item.snd_respawn = new Sound('resp_b');

  startPickupModelLoads();
};

Item.ready = function () {
  return Item.tex_powerup[0].ready();
};

state.Item = Item;
export { Item };
