// Side-effect imports of all game modules in dependency order.

import '@core/event.js';
import '@core/utility.js';
import '@core/vector.js';
import '@core/buffer.js';
import '@core/nickGenerator/dict.js';
import '@core/nickGenerator/index.js';

import '@game/global.js';
import '@entity/dynent.js';
import '@combat/bullet.js';
import '@combat/weapon.js';
import '@entity/item.js';
import '@server/aibot.js';
import '@entity/bot.js';
import '@combat/event.js';
import '@level/bridges.js';
import '@level/gener.js';
import '@level/ai.js';
import '@level/level.js';
import '@network/transport.js';
import '@server/gameplay.js';
import '@server/game.js';
import '@network/room.js';

import '@engine/utility.js';
import '@engine/shader.js';
import '@engine/texture.js';
import '@engine/FBO.js';
import '@engine/render_text.js';
import '@engine/console.js';

import '@client/sound.js';
import '@client/dynent.js';
import '@client/weapon.js';
import '@client/particles.js';
import '@client/bullet.js';
import '@client/bot.js';
import '@client/item.js';
import '@client/hud.js';
import '@client/decal.js';
import '@client/level.js';
import '@network/fakesocket.js';
import '@client/game.js';
