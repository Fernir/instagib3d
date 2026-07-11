import { Event } from '@/core/event.js';
import { Console } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { isWireframe } from '@/engine/mesh.js';
import { isMobileControls } from '@/engine/mobilecontrols.js';
import { enterMobileImmersiveMode } from '@/engine/fullscreen.js';
import { uiTextSizeForHalfNdc } from '@/engine/render_text.js';
import { Shader } from '@/engine/shader.js';

import { EVENT } from '@/global.js';

import { Level } from '@/sim/level.js';

import { FakeSocketClient } from '@/net/fakesocket.js';
import { Transport } from '@/net/transport.js';
import { Room } from '@/net/room.js';

import { BotClient } from './bot.js';
import { LevelRender } from './level.js';
import { SpawnFx } from './spawnfx.js';

class GameClient {
  constructor(param) {
    let nick = decodeURI(param.nick);
    let local = param.local;
    let addr = param.addr;
    let self = this;

    let socket;
    let room;

    let allbots = [];
    let nicks = [];
    let mybot;

    let server_time = 0;
    let framebots = [];
    let frameitems = [];
    let frameevents = [];
    let table = [];
    let lastScoreStateSave = 0;

    function tableNick(nick) {
      return nick && nick.length > 0 ? nick.substring(1) : nick;
    }
    function putScorePlayer(players, player) {
      if (!player || !player.nick) return;
      if (!players[player.nick]) players[player.nick] = { nick: player.nick };
      if (typeof player.frag === 'number') players[player.nick].frag = player.frag | 0;
      if (typeof player.scores === 'number') players[player.nick].scores = player.scores | 0;
    }
    function saveScoreState(force) {
      if (!param.scoreStorageKey || !window.sessionStorage) return;
      const now = Date.now();
      if (!force && now < lastScoreStateSave + 500) return;
      lastScoreStateSave = now;

      const players = {};
      for (let i = 0; i < table.length; i++) {
        putScorePlayer(players, {
          nick: tableNick(table[i].nick),
          scores: table[i].scores,
        });
      }
      for (let i = 0; i < framebots.length; i++) {
        const bot = framebots[i];
        const botNick = bot === mybot ? nick : nicks[bot.id];
        putScorePlayer(players, {
          nick: botNick,
          frag: bot.frag,
          scores: bot.scores,
        });
      }

      const list = Object.keys(players).map(function (key) {
        return players[key];
      });
      if (list.length === 0) return;
      try {
        window.sessionStorage.setItem(
          param.scoreStorageKey,
          JSON.stringify({
            version: 1,
            savedAt: now,
            players: list,
          }),
        );
      } catch {
        // Storage can be disabled in private mode; migration still works without scores.
      }
    }

    if (param.netSocket) {
      // P2P join: a remote host runs the room, we are a pure client.
      socket = param.netSocket;
    } else if (param.mode === 'host' || (local !== undefined && local === 'true')) {
      if (state.localRoom) state.localRoom.destroy();
      const seed = parseInt(param.seed, 10) || 42;
      const sizeClass = parseInt(param.size_class, 10) || 0;
      room = new Room(seed, sizeClass, 'local');
      if (param.scoreState && room.getGame().restoreScoreState)
        room.getGame().restoreScoreState(param.scoreState);
      state.localRoom = room;
      socket = new FakeSocketClient(addr, 1);
      // P2P host: wire incoming remote peers into our room.
      if (param.attachHost) param.attachHost(room);
    } else {
      socket = new WebSocket('ws://' + addr);
    }

    socket.binaryType = 'arraybuffer';

    let levelRender;
    let transport;
    let playing = false;

    socket.onopen = function () {
      transport = new Transport(socket, self);
      transport.getLevelParam(function (seed, size_class) {
        let level = room ? room.getGame().level : new Level(size_class, seed);
        levelRender = new LevelRender(level, size_class);

        transport.changeCamera('', function (err) {
          if (err && err !== 'Ok') Console.error(err);
        });
      });
    };
    socket.onclose = function () {
      socket = null;
      if (transport) transport.socket = null;
      transport = null;
      Console.error('Connection with server was lost');
      // P2P: the host left — trigger host migration / reconnect.
      if (param.onConnectionLost) param.onConnectionLost();
    };
    socket.onerror = function (e) {
      Console.assert(false, 'Сетевая ошибка ' + e.message);
    };

    Event.on('cl_botdead', function (pos, dir, botid) {
      const bot = allbots[botid];
      if (!bot) return;
      if (bot.alive) bot.deathStartTime = Date.now();
      bot.alive = false;
      bot.spawnStartTime = 0;
      bot.painStartTime = 0;
      bot.painKickX = 0;
      bot.painKickY = 0;
      bot.deathSlideX = 0;
      bot.deathSlideY = 0;
      if (pos) {
        bot.dynent.pos.x = pos.x;
        bot.dynent.pos.y = pos.y;
        if (bot.new_frame_dynent) {
          bot.new_frame_dynent.pos.x = pos.x;
          bot.new_frame_dynent.pos.y = pos.y;
        }
        if (bot.old_frame_dynent) {
          bot.old_frame_dynent.pos.x = pos.x;
          bot.old_frame_dynent.pos.y = pos.y;
        }
      }
      if (dir) {
        const len = dir.length();
        if (len > 1e-8) {
          const mag = Math.min(2.5, 0.5 + len * 140);
          bot.deathSlideX = (dir.x / len) * mag;
          bot.deathSlideY = (dir.y / len) * mag;
        }
      }
    });

    Event.on('cl_botrespawn', function (pos, botid) {
      const bot = allbots[botid];
      if (bot) {
        bot.spawnStartTime = Date.now();
        bot.deathStartTime = 0;
        bot.painStartTime = 0;
        bot.painKickX = 0;
        bot.painKickY = 0;
        bot.deathSlideX = 0;
        bot.deathSlideY = 0;
        if (pos) {
          bot.dynent.pos.x = pos.x;
          bot.dynent.pos.y = pos.y;
        }
      }
    });

    // Quake-style direct weapon selection: keys 1..6 pick weapons PISTOL..ROCKET.
    Event.on('keydown', function (key) {
      if (Console.show) return;
      if (!playing || !transport) return;
      if (typeof key !== 'string' || key.length !== 1) return;
      const digit = key.charCodeAt(0) - 48; // '0'..'9'
      if (digit < 1 || digit > 6) return;
      transport.selectWeapon(digit - 1);
    });

    Console.addCommand('spectator', 'spectator bot with nick (no arg = first bot)', function (id) {
      // Без аргумента — сервер сам выберет первого попавшегося бота.
      if (!id) id = '';
      if (transport) {
        transport.changeCamera(id, function (err) {
          if (err === 'Ok') Console.info(err);
          else Console.error(err);
        });
      }
    });
    Console.addCommand('god', 'toggle invulnerability (local game only)', function () {
      if (!room) {
        Console.error('god mode works only in local game');
        return;
      }
      state.godMode = !state.godMode;
      state.godNick = state.godMode ? nick : null;
      Console.info('God mode ' + (state.godMode ? 'ON' : 'OFF'));
    });
    Console.addCommand('wire', 'toggle 3D wireframe (on/off/toggle)', function (val) {
      if (val === 'on' || val === '1' || val === 'true') state.wireframe = true;
      else if (val === 'off' || val === '0' || val === 'false') state.wireframe = false;
      else state.wireframe = !state.wireframe;
      Console.info('Wireframe ' + (state.wireframe ? 'ON' : 'OFF'));
    });
    Console.addCommand('trafik', 'Average trafik (byte per package)', function () {
      Console.info((state.stats.memory_all_package / state.stats.count_net_package) | 0);
    });

    this.isPlaying = function () {
      return playing;
    };
    this.isSpectating = function () {
      return !playing;
    };
    function updateSpectatorGodMode() {
      if (playing || !room || !mybot) return;
      let spectatorNick = nicks[mybot.id];
      if (!spectatorNick) {
        for (const bot of room.getGame().bots) {
          if (bot.id === mybot.id) {
            spectatorNick = bot.nick;
            break;
          }
        }
      }
      if (spectatorNick) {
        state.godMode = true;
        state.godNick = spectatorNick;
      }
    }
    this.getPing = function () {
      return transport ? transport.getPing() : 0;
    };
    this.handlePlayClick = function () {
      if (playing || !transport) return false;
      state.unlockAudio?.();
      if (isMobileControls()) enterMobileImmersiveMode();
      playing = true;
      state.playing = true;
      state.updateAudioMute?.();
      state.godMode = false;
      state.godNick = null;
      transport.addUser(nick, function () {
        transport.sendUserInputs();
        if (!isMobileControls()) state.canvas.requestPointerLock?.();
      });
      return true;
    };
    let button_shader = null;
    function ensureButtonShader() {
      if (button_shader) return button_shader;
      const vert = `
        attribute vec2 position;
        uniform vec4 transform;
        varying vec2 v_unit;
        void main()
        {
            // Сырые координаты квада [-1,1]^2 — нормализованные по полу-высоте,
            // SDF считаем в них (как у рамок оружия), отсюда резкий ровный край.
            v_unit = position;
            gl_Position = vec4(transform.x + position.x * transform.z,
                               transform.y + position.y * transform.w, 0.0, 1.0);
        }`;
      const frag = `
        #ifdef GL_ES
        precision highp float;
        #endif
        // size  = [boxAspect (ширина/высота бокса), corner_radius, border, anti-alias]
        // color = [rgb акцента/контура, master_alpha]
        uniform vec4 size;
        uniform vec4 color;
        varying vec2 v_unit;
        void main()
        {
            float boxAspect = size.x;
            vec2 p = vec2(v_unit.x * boxAspect, v_unit.y);
            vec2 b = vec2(boxAspect, 1.0);
            float r = size.y;
            vec2 q = abs(p) - b + r;
            float d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
            float border = size.z;
            float aa = size.w;
            // Заливка тела + кольцо постоянной толщины от края внутрь (как рамки
            // оружия) — толщина контура одинакова на всех сторонах и в углах.
            float fillMask = 1.0 - smoothstep(-aa, aa, d);
            float ring = fillMask * smoothstep(-border - aa, -border + aa, d);
            vec3 fillCol = vec3(0.0, 0.0, 0.0);
            float fillA = 0.95 * fillMask;
            vec3 rgb = mix(fillCol, color.rgb, ring);
            float a = max(fillA, ring) * color.a;
            if (a < 0.004) discard;
            gl_FragColor = vec4(rgb, a);
        }`;
      button_shader = new Shader(vert, frag, ['transform', 'size', 'color']);
      return button_shader;
    }

    // Кнопка Play отцентрирована по X и стоит на той же Y-линии, что и центр
    // миникарты (см. level3d.js renderMinimap -> trans(-0.8, -0.7)).
    const PLAY_BTN_Y = -0.7;
    // Пропорция бокса (ширина/высота) и скругление в единицах полу-высоты —
    // как у рамок оружия (2:1, r=0.45), чтобы вид совпадал.
    const PLAY_BTN_BOX_ASPECT = 2.4;
    const PLAY_BTN_RADIUS = 0.5;
    function playButtonGeom() {
      const aspect = state.canvas.width / state.canvas.height;
      const screenH = state.canvas.height;
      // Полу-высоту привязываем к целым пикселям — без субпиксельного «мыла».
      const halfPx = Math.max(2, Math.round(0.085 * screenH));
      const bh = halfPx / screenH;
      // Ширина задаётся пропорцией бокса в пикселях, затем переводится в NDC.
      const bw = (PLAY_BTN_BOX_ASPECT * bh) / aspect;
      return { aspect, bw, bh };
    }
    function isPlayButtonHovered() {
      const m = state.overlayMouse;
      if (!m) return false;
      const { bw, bh } = playButtonGeom();
      return Math.abs(m.x) <= bw && Math.abs(m.y - PLAY_BTN_Y) <= bh;
    }
    this.renderPlayOverlay = function () {
      if (playing) return;
      const gl = state.gl;
      const mat4 = state.mat4;
      const { aspect, bw, bh } = playButtonGeom();
      const hovered = isPlayButtonHovered();
      // border/aa в нормализованных (по полу-высоте) единицах — одинаковая
      // толщина контура и резкая кромка на всех сторонах.
      const aa = 0.02;
      const border = hovered ? 0.09 : 0.0;
      const boxAspect = (bw * aspect) / bh;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      Console.shader.use();
      const mat_dim = mat4.create();
      mat4.scal(mat_dim, [1, 1, 1]);
      Console.shader.matrix(Console.shader.mat_pos, mat_dim);
      Console.shader.vector(Console.shader.color, [0, 0, 0, 0.3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const sh = ensureButtonShader();
      sh.use();
      gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      // Один проход: тело + (при hover) золотое кольцо постоянной толщины.
      const accent = hovered ? [1.0, 0.78, 0.2, 1.0] : [0, 0, 0, 0.95];
      sh.vector(sh.transform, [0, PLAY_BTN_Y, bw, bh]);
      sh.vector(sh.size, [boxAspect, PLAY_BTN_RADIUS, border, aa]);
      sh.vector(sh.color, accent);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.disable(gl.BLEND);

      // #r = красный (по умолчанию), #y = золотой при hover. Цвета в палитре
      // render_text.js — см. там же определение #y/#r.
      const label = hovered ? '#yPlay' : '#rPlay';
      const textSize = uiTextSizeForHalfNdc(bh, 2.8, 0.085);
      state.text.render([0, PLAY_BTN_Y], textSize, label, 1, { center: true });
    };
    this.playButtonHitTest = function () {
      const { bw, bh } = playButtonGeom();
      return { x: 0, y: PLAY_BTN_Y, w: bw, h: bh };
    };
    this.getNickById = function (id) {
      let nick = nicks[id];
      if (nick) {
        let color = '#y';
        let bot = id === mybot.id ? mybot : allbots[id];
        if (bot) {
          if (bot.seria >= 5) color = '#r';
          else if (bot.seria <= -5) color = '#G';
        }

        function getPlace() {
          for (let i = 0; i < table.length; i++) if (table[i].nick.slice(1) === nick) return i;
          return -1;
        }

        const place = getPlace();
        if (place >= 0 && place < 3) color = '#C' + (place + 1) + color;

        return color + nick;
      }
      return '';
    };
    this.getBotById = function (id) {
      for (let i = 0; i < framebots.length; i++) if (framebots[i].id === id) return framebots[i];
      return null;
    };
    this.getLevelRender = function () {
      return levelRender;
    };
    this.getNicks = function () {
      return nicks;
    };
    this.setUserNicks = function (ids) {
      for (let id in ids) {
        nicks[id] = ids[id];
      }
      saveScoreState(true);
    };
    this.addFrame = function (frame) {
      server_time = frame.time;
      if (!mybot || mybot.id !== frame.mybot.id) {
        mybot = new BotClient(frame.time, frame.mybot, true);
      }
      mybot.addFrame(frame.time, frame.mybot, true);
      mybot.lastFrameSeen = Date.now();

      framebots.splice(0, framebots.length);
      framebots.push(mybot);
      const seenIds = new Set([mybot.id]);
      for (let i = 0; i < frame.listbots.length; i++) {
        let bot = frame.listbots[i];
        let id = bot.id;
        if (!allbots[id]) allbots[id] = new BotClient(frame.time, bot, false);
        else allbots[id].addFrame(frame.time, bot, false);
        allbots[id].lastFrameSeen = Date.now();
        seenIds.add(id);
        framebots.push(allbots[id]);
      }

      // Удерживаем «пропавших» ботов: короткий пропуск visibility (250 мс) сглаживает блинк,
      // а свежий труп остаётся лежать до исчезновения (см. CORPSE_LIFETIME_MS в bot.js).
      const now = Date.now();
      const GHOST_VISIBILITY_MS = 250;
      const CORPSE_LINGER_MS = 14000;
      for (const idStr in allbots) {
        const id = +idStr;
        if (seenIds.has(id)) continue;
        const ghost = allbots[id];
        if (!ghost) continue;
        const inactive = now - (ghost.lastFrameSeen || 0);
        const isCorpse =
          !ghost.alive && ghost.deathStartTime && now - ghost.deathStartTime < CORPSE_LINGER_MS;
        const justGone = ghost.alive && inactive < GHOST_VISIBILITY_MS;
        if (justGone || isCorpse) {
          framebots.push(ghost);
        } else if (inactive > CORPSE_LINGER_MS) {
          delete allbots[id];
          delete nicks[id];
        }
      }

      frameitems = frame.listitems;
      frameevents = frame.listevents;
      if (frame.table.length > 0) {
        table = frame.table;
        saveScoreState(true);
      }

      //request for nick
      let unknown_nicks = [];
      for (let i = 0; i < framebots.length; i++) {
        let id = framebots[i].id;
        if (!nicks[id]) unknown_nicks.push(id);
      }
      transport.getUserNicks(unknown_nicks);
      saveScoreState(false);
      updateSpectatorGodMode();
      Event.emit('frame');
    };
    this.ready = function () {
      return levelRender && levelRender.ready() && mybot;
    };
    this.getCamera = function () {
      return mybot;
    };
    this.render = function () {
      function handleEvents() {
        frameevents.forEach((event) => {
          switch (event.type) {
            case EVENT.BOT_RESPAWN:
              return Event.emit('cl_botrespawn', event.pos, event.botid);
            case EVENT.PAIN:
              return Event.emit('cl_botpain', event.pos, event.dir, event.botid);
            case EVENT.BOT_DEAD:
              return Event.emit('cl_botdead', event.pos, event.dir, event.botid);
            case EVENT.TAKE_WEAPON:
              return Event.emit('cl_takeweapon', event.pos);
            case EVENT.TAKE_HEALTH:
              return Event.emit('cl_takehealth', event.pos);
            case EVENT.TAKE_SHIELD:
              return Event.emit('cl_takeshield', event.pos);
            case EVENT.TAKE_POWER:
              return Event.emit('cl_takepower', event.pos);
            case EVENT.ITEM_RESPAWN:
              return Event.emit('cl_itemrespawn', event.pos);
            case EVENT.BULLET_DEAD:
              return state.BulletClient.remove(event.bulletid, event.pos, event.z);
            case EVENT.BULLET_RESPAWN:
              return state.BulletClient.create(event);
            case EVENT.LINE_SHOOT:
              return state.BulletLine.create(server_time, event);
          }
        });
        frameevents.splice(0, frameevents.length);
      }

      state.stats.count_dynent_rendering = 0;
      framebots.forEach(function (bot) {
        bot.update();
      });
      handleEvents();

      // Сбрасываем динамические лайты предыдущего кадра и собираем новые
      // ДО рендера уровня, чтобы свет от снарядов уже попал в шейдеры пола/стен.
      if (levelRender.clearDynamicLights) levelRender.clearDynamicLights();
      if (state.BulletClient && state.BulletClient.collectLights)
        state.BulletClient.collectLights(levelRender);
      if (state.quality?.q2fx !== false && state.Q2FX && state.Q2FX.collectLights) {
        state.Q2FX.collectLights(levelRender);
      }

      // Карта теней от солнца: статика рисуется внутри, динамику (боты/предметы)
      // дорисовываем здесь в light-space перед основным проходом мира.
      if (levelRender.renderShadows && state.quality?.shadows !== false) {
        levelRender.renderShadows(mybot.dynent, function (lightVP) {
          framebots.forEach(function (bot) {
            bot.renderShadow(lightVP, mybot.dynent);
          });
          frameitems.forEach(function (item) {
            state.Item.renderShadow(lightVP, item);
          });
        });
      }

      state.wireframePass = state.wireframe;
      levelRender.render(mybot.dynent);

      if (state.quality?.q2fx !== false && state.Q2FX) state.Q2FX.update();

      if (isWireframe()) {
        const gl = state.gl;
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        frameitems.forEach(function (item) {
          state.Item.renderWireDepth(mybot.dynent, item);
        });
        framebots.forEach(function (bot) {
          bot.renderWireDepth(mybot.dynent);
        });
        if (state.Bot && state.Bot.renderFirstPersonWeaponWire) {
          state.Bot.renderFirstPersonWeaponWire(mybot, 'depth');
        }
        frameitems.forEach(function (item) {
          state.Item.renderWireFill(mybot.dynent, item);
        });
        framebots.forEach(function (bot) {
          bot.renderWireFill(mybot.dynent);
        });
        levelRender.drawLevelWire();
        frameitems.forEach(function (item) {
          state.Item.renderWireDraw(mybot.dynent, item);
        });
        framebots.forEach(function (bot) {
          bot.renderWireDraw(mybot.dynent);
        });
        if (state.Bot && state.Bot.renderFirstPersonWeaponWire) {
          state.Bot.renderFirstPersonWeaponWire(mybot, 'depth');
          state.Bot.renderFirstPersonWeaponWire(mybot, 'wire');
        }
      }

      levelRender.beginSpritePass();

      if (!isWireframe()) {
        state.gl.enable(state.gl.BLEND);
        state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);

        if (state.quality?.particles !== false) {
          state.Particle.render(mybot.dynent, 0);
        }
        frameitems.forEach(function (item) {
          state.Item.render(mybot.dynent, item);
        });
        SpawnFx.render(mybot.dynent, 'floor');
        framebots.forEach(function (bot) {
          bot.render(mybot.dynent);
        });
        SpawnFx.render(mybot.dynent, 'pillar');
        state.BulletClient.render(mybot.dynent);
        if (state.quality?.particles !== false) {
          state.Particle.render(mybot.dynent, 1);
          state.Particle.render(mybot.dynent, 2);
        }
        if (state.quality?.q2fx !== false && state.Q2FX) state.Q2FX.render(mybot.dynent);

        if (levelRender.renderVolumetricFog) levelRender.renderVolumetricFog();
      }

      if (state.Bot && state.Bot.renderFirstPersonWeapon && !isWireframe()) {
        state.Bot.renderFirstPersonWeapon(mybot);
      }

      state.gl.disable(state.gl.BLEND);
      levelRender.endSpritePass();

      framebots.forEach(function (bot) {
        bot.renderStats(mybot.dynent);
      });

      state.wireframePass = false;
      if (!isWireframe() || isMobileControls()) levelRender.renderMinimap(mybot.dynent);
      state.HUD.render(mybot, table, playing);
      if (!playing) self.renderPlayOverlay();
      else if (!isWireframe())
        state.text.render([0, 0], 3, '#w+', 1, { center: true, visibile: true });
    };

    if (socket.connect) socket.connect();
  }
}

export { GameClient };
