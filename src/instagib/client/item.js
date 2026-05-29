import { Texture } from '../engine/texture.js';
import { Console } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { ITEM, WEAPON } from '../server/game/global.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent } from '../server/objects/dynent.js';
import { Item } from '../server/objects/item.js';

import { MD2Model } from './md2.js';
import { Sound } from './sound.js';

// Quake 2 world weapon models (g_*/tris.md2). Цвет outline — типовая «подсветка»
// каждого оружия в Q2 (sniper rifle красный, hyperblaster фиолетовый, etc.).
const PICKUP_PATH = '/game/models/q2/pickups/';
const PICKUP_SPECS = {
    [WEAPON.PISTOL]: { model: 'blaster.md2',      skin: 'blaster.pcx',      color: [1.00, 0.85, 0.25] },
    [WEAPON.SHAFT]:  { model: 'chaingun.md2',     skin: 'chaingun.pcx',     color: [0.40, 0.85, 1.00] },
    [WEAPON.RAIL]:   { model: 'railgun.md2',      skin: 'railgun.pcx',      color: [1.00, 0.30, 0.30] },
    [WEAPON.PLASMA]: { model: 'hyperblaster.md2', skin: 'hyperblaster.pcx', color: [0.85, 0.40, 1.00] },
    [WEAPON.ZENIT]:  { model: 'glauncher.md2',    skin: 'glauncher.pcx',    color: [0.30, 1.00, 0.40] },
    [WEAPON.ROCKET]: { model: 'rlauncher.md2',    skin: 'rlauncher.pcx',    color: [1.00, 0.55, 0.20] },
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

function renderWeaponPickup3D(item) {
    if (!Item.pickupMd2) return false;
    const spec = Item.pickupMd2[item.type];
    if (!spec || !spec.model || !spec.model.frameBuffers || !spec.model.frameBuffers.length) {
        return false;
    }

    const now = Date.now();
    // Каждому предмету — свой фазовый сдвиг (по позиции), чтобы пикапы покачивались асинхронно.
    const phase = (item.x * 0.71 + item.y * 0.93);
    const bobY = 0.55 + Math.sin(now * 0.003 + phase) * 0.10;
    const yaw = ((now % 4000) / 4000) * Math.PI * 2 + phase;

    const mat4 = state.mat4;
    const m = mat4.create();
    mat4.identity(m);
    mat4.translate(m, m, [item.x, bobY, item.y]);
    mat4.rotateY(m, m, yaw);
    mat4.scale(m, m, [0.036, 0.036, 0.036]);

    const gl = state.gl;
    const wasBlend = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    spec.model.render(m, 0, 0, 0, spec.skinIndex, [1, 1, 1, 1], {
        sunDir: (state.LevelRender && state.LevelRender.sunDir) || [0.4, -0.85, 0.35],
    });

    // Пульсирующий неоновый ободок цвета оружия (renderOutline сам аккуратно
    // переключает blend на additive и возвращает state).
    const pulse = 0.65 + 0.35 * Math.sin(now * 0.005 + phase);
    const c = spec.color;
    spec.model.renderOutline(
        m, 0, 0, 0,
        [c[0] * pulse, c[1] * pulse, c[2] * pulse, 1],
        0.6,
    );

    gl.disable(gl.CULL_FACE);
    if (wasBlend) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    return true;
}

Item.render = function (camera, item) {
    if (item.type <= WEAPON.ROCKET && renderWeaponPickup3D(item)) return;

    // Билбоард-фолбэк, пока MD2 пикапа ещё грузится / для пауэрапов (нет MD2).
    const angle = item.type <= ITEM.LIFE
        ? ((Date.now() % 3000) / 3000) * Math.PI * 2
        : camera.angle;
    const states = { y_anchor: 'feet', y_offset: 0.6 + Math.sin(Date.now() * 0.003) * 0.1 };
    const tex = item.type <= WEAPON.ROCKET
        ? state.Weapon.skins[item.type].gun
        : Item.tex_powerup[item.type - ITEM.LIFE];
    Dynent.render(camera, tex, state.Weapon.shader_noshadow,
        new Vector(item.x, item.y), [1.2, 1.2], angle, states);
};

Item.load = function () {
    Item.tex_powerup = [
        new Texture('/game/textures/fx/life.png'),
        new Texture('/game/textures/fx/shield.png'),
        new Texture('/game/textures/fx/quad.png'),
        new Texture('/game/textures/fx/regen.png'),
        new Texture('/game/textures/fx/speed.png'),
    ];

    Item.snd_health = new Sound('health');
    Item.snd_weapon = new Sound('pkup');
    Item.snd_power = new Sound('power');
    Item.snd_respawn = new Sound('resp_b');

    startPickupModelLoads();
};

Item.ready = function () {
    for (let i = 0; i < Item.tex_powerup.length; i++) {
        if (!Item.tex_powerup[i].ready())
            return false;
    }
    return true;
};

state.Item = Item;
export { Item };
