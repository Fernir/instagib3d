import { Event } from '@/core/event.js';
import { Console } from '@/core/polyfill.js';
import { normalizeAngle } from '@/core/utility.js';
import { Vector } from '@/core/vector.js';

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
    import('@/client/game.js'),
    import('@/engine/render_text.js'),
    import('@/client/item.js'),
    import('@/client/weapon.js'),
    import('@/client/hud.js'),
    import('@/client/bot.js'),
    import('@/client/particles.js'),
    import('@/client/sound.js'),
    import('@/client/q2fx.js'),
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
