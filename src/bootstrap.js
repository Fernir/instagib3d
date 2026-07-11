// Side-effect imports of all game modules in dependency order.

import '@/core/event.js';
import '@/core/utility.js';
import '@/core/vector.js';
import '@/core/buffer.js';
import '@/core/nickGenerator/dict.js';
import '@/core/nickGenerator/index.js';

import '@/global.js';
import '@/sim/dynent.js';
import '@/sim/bullet.js';
import '@/sim/weapon.js';
import '@/sim/item.js';
import '@/sim/aibot.js';
import '@/sim/bot.js';
import '@/sim/game-events.js';
import '@/sim/bridges.js';
import '@/sim/gener.js';
import '@/sim/ai.js';
import '@/sim/level.js';
import '@/net/transport.js';
import '@/sim/gameplay.js';
import '@/sim/game.js';
import '@/net/room.js';

import '@/engine/utility.js';
import '@/engine/shader.js';
import '@/engine/texture.js';
import '@/engine/FBO.js';
import '@/engine/render_text.js';
import '@/engine/console.js';

import '@/client/sound.js';
import '@/client/dynent.js';
import '@/client/weapon.js';
import '@/client/particles.js';
import '@/client/bullet.js';
import '@/client/bot.js';
import '@/client/item.js';
import '@/client/hud.js';
import '@/client/decal.js';
import '@/client/level.js';
import '@/net/fakesocket.js';
import '@/client/game.js';
