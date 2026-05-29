import { Console, assert } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { ITEM } from '../server/game/global.js';
import { Event } from '../server/libs/event.js';
import { Vector } from '../server/libs/vector.js';

class Sound {
  constructor(file) {
    this.snd = new state.Howl({
      src: ['/game/sounds/' + file + '.wav'],
      onloaderror: function (id, message) {
        assert(false, file + '.wav: ' + message);
      },
      onload: function () {
        Console.info('Loaded sound ' + file + '.wav');
      },
    });
    this.vol = 1;
  }

  setVolume(vol) {
    this.vol = vol;
  }

  play(pos) {
    let vol = Sound.getVolume(pos);
    if (vol < 0.1) return null;

    let id = this.snd.play();
    this.snd.volume(vol * this.vol, id);
    return id;
  }

  volume(pos, id) {
    let vol = Sound.getVolume(pos);
    this.snd.volume(vol * this.vol, id);
  }
}

Event.on('cl_botrespawn', function (pos) {
  state.Bot.snd_respawn.play(pos);
});

Event.on('cl_botdead', function (pos, dir, botid) {
  let level = state.gameClient.getLevelRender().getLevel();
  if (level.collideLava(pos)) {
    // lava death — no gib sound
  } else {
    state.Bot.snd_gib.play(pos);
  }
});

Event.on('cl_takeweapon', function (pos) {
  state.Item.snd_weapon.play(pos);
});

Event.on('cl_takehealth', function (pos) {
  state.Item.snd_health.play(pos);
});

Event.on('cl_takeshield', function (pos) {
  state.Item.snd_health.play(pos);
});

Event.on('cl_takepower', function (pos) {
  state.Item.snd_power.play(pos);
});

Event.on('cl_itemrespawn', function (pos) {
  state.Item.snd_respawn.play(pos);
});

Event.on('cl_lineshoot', function (bullet) {
  let center = bullet.dynent.pos;
  let pos = Vector.sub(center, Vector.sub(bullet.dest, center));
  let id = state.Weapon.skins[bullet.type].snd_shoot.play(pos);
  if (bullet.power === ITEM.QUAD) {
    state.Weapon.skins[bullet.type].snd_shoot.snd.rate(2, id);
  }
});

Sound.getVolume = function (pos) {
  let vec = Vector.sub(pos, state.gameClient.getCamera().dynent.pos);
  let vol = 1 - vec.length() / 16;
  if (vol < 0) vol = 0;
  return vol;
};

Sound.setup = function () {
  let volume = 0.2;
  state.Howler.mute(true);
  state.Howler.volume(volume);

  Console.addCommand('soundVolume', 'volume of sound 0 - 1 (default 0.2)', function (val) {
    if (!val) {
      Console.debug('Volume =', volume);
    } else {
      volume = parseFloat(val);
      state.Howler.volume(parseFloat(volume));
    }
  });
};

export { Sound };
