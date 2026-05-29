// Side-effect imports of all game modules in dependency order.

import './server/libs/event.js';
import './server/libs/utility.js';
import './server/libs/vector.js';
import './server/libs/buffer.js';
import './server/libs/nickGenerator/dict.js';
import './server/libs/nickGenerator/index.js';
import './server/game/global.js';
import './server/objects/dynent.js';
import './server/objects/bullet.js';
import './server/objects/weapon.js';
import './server/objects/item.js';
import './server/game/aibot.js';
import './server/objects/bot.js';
import './server/objects/event.js';
import './server/level/bridges.js';
import './server/level/gener.js';
import './server/level/ai.js';
import './server/level/level.js';
import './server/game/transport.js';
import './server/game/gameplay.js';
import './server/game/game.js';
import './server/room.js';

import './engine/utility.js';
import './engine/shader.js';
import './engine/texture.js';
import './engine/FBO.js';
import './engine/render_text.js';
import './engine/console.js';

import './client/sound.js';
import './client/dynent.js';
import './client/weapon.js';
import './client/particles.js';
import './client/bullet.js';
import './client/bot.js';
import './client/item.js';
import './client/hud.js';
import './client/decal.js';
import './client/level.js';
import './client/fakesocket.js';
import './client/game.js';
