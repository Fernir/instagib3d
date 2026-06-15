import { Console } from './polyfill.js';
import { Event } from './server/libs/event.js';
import { normalizeAngle } from './server/libs/utility.js';
import { Vector } from './server/libs/vector.js';

// Грузим bootstrap (он подтягивает client/decal.js, client/level.js и
// расставляет порядок side-effect-импортов), затем — параллельно — все клиентские
// модули, нужные runtime.js. md2 импортится транзитивно из item/bot и здесь
// перепубликовывать его не нужно.
export async function getGameApi() {
  await import('./bootstrap.js');
  const [
    { GameClient },
    { Text },
    { Item },
    { WeaponClient },
    { HUD },
    { BotClient },
    { Particle },
    { Sound },
    { Q2FX },
  ] = await Promise.all([
    import('./client/game.js'),
    import('./engine/render_text.js'),
    import('./client/item.js'),
    import('./client/weapon.js'),
    import('./client/hud.js'),
    import('./client/bot.js'),
    import('./client/particles.js'),
    import('./client/sound.js'),
    import('./client/q2fx.js'),
  ]);

  return {
    Console,
    Event,
    Vector,
    normalizeAngle,
    GameClient,
    Text,
    Item,
    HUD,
    Particle,
    Sound,
    Q2FX,
    Weapon: WeaponClient,
    Bot: BotClient,
  };
}
