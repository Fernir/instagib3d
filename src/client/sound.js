import { Event } from '@/core/event.js';
import { Console, assert } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { ITEM } from '@/global.js';

// 3D positional audio: HRTF-панорама + линейное затухание по расстоянию.
// Координаты Howler: +X вправо, +Y вверх, +Z к слушателю (forward = -Z).
// Маппинг мира: world.x -> audio.x, height -> audio.y, world.y -> audio.z.
const REF_DIST = 1.5; // полная громкость в радиусе REF_DIST
const MAX_DIST = 18; // полная тишина за MAX_DIST
const ROLLOFF = 1;
const SOURCE_H = 1.0; // высота источников по умолчанию
const SKIP_DIST_SQ = (MAX_DIST + 4) * (MAX_DIST + 4);

const PANNER_ATTR = {
  panningModel: 'HRTF',
  distanceModel: 'linear',
  refDistance: REF_DIST,
  rolloffFactor: ROLLOFF,
  maxDistance: MAX_DIST,
};

class Sound {
  constructor(file) {
    this.snd = new state.Howl({
      src: ['/game/sounds/' + file + '.wav'],
      // pannerAttr в опциях Howl применяется к каждому новому play() автоматически,
      // даже если play вызвали напрямую через snd.play().
      pannerAttr: PANNER_ATTR,
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
    if (
      !state.soundEnabled ||
      !state.audioUnlocked ||
      !state.playing ||
      state.Howler.ctx?.state === 'suspended'
    )
      return null;
    if (pos && Sound.outOfRange(pos)) return null;

    const id = this.snd.play();
    this.snd.volume(this.vol, id);
    if (pos) this.snd.pos(pos.x, SOURCE_H, pos.y, id);
    return id;
  }

  volume(pos, id) {
    if (id === null || id === undefined) return;
    this.snd.volume(this.vol, id);
    if (pos) this.snd.pos(pos.x, SOURCE_H, pos.y, id);
  }
}

Sound.outOfRange = function (pos) {
  const cam = state.gameClient && state.gameClient.getCamera && state.gameClient.getCamera();
  if (!cam || !cam.dynent) return false;
  const dx = pos.x - cam.dynent.pos.x;
  const dy = pos.y - cam.dynent.pos.y;
  return dx * dx + dy * dy > SKIP_DIST_SQ;
};

// Каждый кадр обновляем позу слушателя по камере: позиция + ориентация (forward, up).
Sound.updateListener = function () {
  const cam = state.gameClient && state.gameClient.getCamera && state.gameClient.getCamera();
  if (!cam || !cam.dynent || !state.Howler || !state.Howler.pos) return;
  const eyeH = (state.LevelRender && state.LevelRender.eye_height) || 1.6;
  const angle = cam.dynent.angle || 0;
  state.Howler.pos(cam.dynent.pos.x, eyeH, cam.dynent.pos.y);
  state.Howler.orientation(-Math.sin(angle), 0, -Math.cos(angle), 0, 1, 0);
};

Event.on('frame', Sound.updateListener);

Event.on('cl_botrespawn', function (pos) {
  state.Bot.snd_respawn.play(pos);
});

Event.on('cl_botdead', function (pos) {
  const level = state.gameClient.getLevelRender().getLevel();
  if (!level.collideLava(pos)) state.Bot.snd_gib.play(pos);
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
  // Источник выстрела — позиция стрелка (bullet.dynent.pos), а не "зеркало" дестинации:
  // в 3D HRTF-панораме это даёт корректное расположение звука относительно слушателя.
  const id = state.Weapon.skins[bullet.type].snd_shoot.play(bullet.dynent.pos);
  if (id !== null && bullet.power === ITEM.QUAD) {
    state.Weapon.skins[bullet.type].snd_shoot.snd.rate(2, id);
  }
});

Sound.setup = function () {
  let volume = 0.12;
  state.soundEnabled = true;
  state.Howler.volume(volume);

  function applyMute() {
    if (typeof state.updateAudioMute === 'function') state.updateAudioMute();
    else state.Howler.mute(!state.soundEnabled);
  }
  applyMute();

  Console.addCommand('sound', 'toggle sound (on/off/toggle, default: toggle)', function (val) {
    const v = (val || '').toString().toLowerCase();
    if (v === 'on' || v === '1' || v === 'true') state.soundEnabled = true;
    else if (v === 'off' || v === '0' || v === 'false') state.soundEnabled = false;
    else state.soundEnabled = !state.soundEnabled;
    applyMute();
    Console.info('Sound ' + (state.soundEnabled ? 'ON' : 'OFF'));
  });

  Console.addCommand('soundVolume', 'volume of sound 0 - 1 (default 0.12)', function (val) {
    if (!val) {
      Console.debug('Volume =', volume);
    } else {
      volume = parseFloat(val);
      state.Howler.volume(parseFloat(volume));
    }
  });
};

export { Sound };
