import { Texture } from '../engine/texture.js';
import { state } from '../runtime-state.js';
import { ITEM, WEAPON } from '../server/game/global.js';
import { Vector } from '../server/libs/vector.js';
import { Dynent } from '../server/objects/dynent.js';
import { Item } from '../server/objects/item.js';

import { Sound } from './sound.js';


Item.render = function (camera, item) {
    const angle = item.type <= ITEM.LIFE
        ? ((Date.now() % 3000) / 3000) * Math.PI * 2
        : camera.angle;

    if (item.type <= WEAPON.ROCKET) {
        Dynent.render(camera, state.Weapon.skins[item.type].gun, state.Weapon.shader_noshadow,
            new Vector(item.x, item.y), [1, 1], angle);
    } else {
        Dynent.render(camera, Item.tex_powerup[item.type - ITEM.LIFE], state.Weapon.shader_noshadow,
            new Vector(item.x, item.y), [1, 1], angle);
    }
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
