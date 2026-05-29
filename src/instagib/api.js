import { Console } from './polyfill.js';
import { Event } from './server/libs/event.js';
import { normalizeAngle } from './server/libs/utility.js';
import { Vector } from './server/libs/vector.js';

async function loadInstagibGame() {
  await import('./bootstrap.js');
}

export async function getGameApi() {
  await loadInstagibGame();
  const [
    { GameClient },
    { Text },
    { Item },
    { WeaponClient },
    { HUD },
    { BotClient },
    { Particle },
    { Sound },
  ] = await Promise.all([
    import('./client/game.js'),
    import('./engine/render_text.js'),
    import('./client/item.js'),
    import('./client/weapon.js'),
    import('./client/hud.js'),
    import('./client/bot.js'),
    import('./client/particles.js'),
    import('./client/sound.js'),
  ]);

  return {
    Console,
    Event,
    Vector,
    normalizeAngle,
    GameClient,
    Text,
    Item,
    Weapon: WeaponClient,
    HUD,
    Bot: BotClient,
    Particle,
    Sound,
  };
}
