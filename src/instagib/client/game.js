import { Shader } from '../engine/shader.js';
import { Console } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { EVENT } from '../server/game/global.js';
import { Transport } from '../server/game/transport.js';
import { Level } from '../server/level/level.js';
import { Event } from '../server/libs/event.js';
import { Room } from '../server/room.js';

import { BotClient } from './bot.js';
import { FakeSocketClient } from './fakesocket.js';
import { LevelRender } from './level.js';



class GameClient
{
constructor(param)
{
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

    if (local !== undefined && local === "true")
    {
        if (state.localRoom) state.localRoom.destroy();
        room = new Room(42, 2, "local");
        state.localRoom = room;
        socket = new FakeSocketClient(addr, 1);
    }
    else
    {
        socket = new WebSocket("ws://" + addr);
    }

    socket.binaryType = "arraybuffer";

    let levelRender;
    let transport;
    let playing = false;

    socket.onopen = function()
    {
        transport = new Transport(socket, self);
        transport.getLevelParam(function(seed, size_class)
        {
            let level = room ? room.getGame().level : new Level(size_class, seed);
            levelRender = new LevelRender(level, size_class);

            transport.changeCamera("", function(err)
            {
                if (err && err !== "Ok") Console.error(err);
            });
        });
    };
    socket.onclose = function()
    {
        socket = null;
        transport.socket = null;
        transport = null;
        Console.error("Connection with server was lost");
    };
    socket.onerror = function(e)
    {
        Console.assert(false, "Сетевая ошибка " + e.message);
    };

    Event.on("cl_botdead", function(pos, dir, botid)
    {
        const bot = allbots[botid];
        if (!bot) return;
        if (bot.alive) bot.deathStartTime = Date.now();
        bot.alive = false;
        if (pos) { bot.dynent.pos.x = pos.x; bot.dynent.pos.y = pos.y; }
    });

    Console.addCommand("spectator", "spectator bot with nick (no arg = first bot)", function(id)
    {
        // Без аргумента — сервер сам выберет первого попавшегося бота.
        if (!id) id = "";
        if (transport)
        {
            transport.changeCamera(id, function(err)
            {
                if (err === "Ok") Console.info(err);
                else Console.error(err);
            });
        }
    });
    Console.addCommand("status", "status this session", function()
    {
        if (local !== undefined && local === "true") Console.debug("This is local game");
        else Console.debug("This is online game");
    });
    Console.addCommand("god", "toggle invulnerability (local game only)", function()
    {
        if (!room) { Console.error("god mode works only in local game"); return; }
        state.godMode = !state.godMode;
        state.godNick = state.godMode ? nick : null;
        Console.info("God mode " + (state.godMode ? "ON" : "OFF"));
    });
    Console.addCommand("trafik", "Average trafik (byte per package)", function()
    {
        Console.info(state.stats.memory_all_package / state.stats.count_net_package | 0);
    });

    this.isPlaying = function()
    {
        return playing;
    };
    this.getPing = function()
    {
        return transport ? transport.getPing() : 0;
    };
    this.tryPlayClick = function()
    {
        return self.handlePlayClick();
    };
    this.handlePlayClick = function()
    {
        if (playing || !transport) return false;
        playing = true;
        state.playing = true;
        transport.addUser(nick, function()
        {
            transport.sendUserInputs();
            state.canvas.requestPointerLock?.();
        });
        return true;
    };
    let button_shader = null;
    function ensureButtonShader()
    {
        if (button_shader) return button_shader;
        const vert = `
        attribute vec2 position;
        uniform vec4 transform;
        varying vec2 v_pos;
        void main()
        {
            v_pos = position * transform.zw;
            gl_Position = vec4(transform.x + position.x * transform.z,
                               transform.y + position.y * transform.w, 0.0, 1.0);
        }`;
        const frag = `
        #ifdef GL_ES
        precision highp float;
        #endif
        uniform vec4 size;
        uniform vec4 color;
        varying vec2 v_pos;
        void main()
        {
            vec2 d = abs(v_pos) - (vec2(size.x, size.y) - vec2(size.z));
            float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - size.z;
            float alpha = 1.0 - smoothstep(-0.002, 0.002, dist);
            if (alpha < 0.005) discard;
            gl_FragColor = vec4(color.rgb, color.a * alpha);
        }`;
        button_shader = new Shader(vert, frag, ['transform', 'size', 'color']);
        return button_shader;
    }

    // Кнопка Play отцентрирована по X и стоит на той же Y-линии, что и центр
    // миникарты (см. level3d.js renderMinimap -> trans(-0.8, -0.7)).
    const PLAY_BTN_Y = -0.7;
    function isPlayButtonHovered()
    {
        const m = state.overlayMouse;
        if (!m) return false;
        const aspect = state.canvas.width / state.canvas.height;
        const bw = 0.28 / aspect;
        const bh = 0.09;
        return Math.abs(m.x) <= bw && Math.abs(m.y - PLAY_BTN_Y) <= bh;
    }
    this.renderPlayOverlay = function()
    {
        if (playing) return;
        const aspect = state.canvas.width / state.canvas.height;
        const gl = state.gl;
        const mat4 = state.mat4;
        const bw = 0.28 / aspect;
        const bh = 0.09;
        const radius = 0.02;
        const hovered = isPlayButtonHovered();

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

        // Золотая рамка при hover: рисуется чуть большим quad'ом, поверх — чёрный fill.
        if (hovered)
        {
            const bo = 0.006;
            sh.vector(sh.transform, [0, PLAY_BTN_Y, bw + bo, bh + bo]);
            sh.vector(sh.size, [bw + bo, bh + bo, radius + bo * 0.5, 0]);
            sh.vector(sh.color, [1.0, 0.78, 0.20, 1.0]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        sh.vector(sh.transform, [0, PLAY_BTN_Y, bw, bh]);
        sh.vector(sh.size, [bw, bh, radius, 0]);
        sh.vector(sh.color, [0, 0, 0, 0.95]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disable(gl.BLEND);

        // #r = красный (по умолчанию), #y = золотой при hover. Цвета в палитре
        // render_text.js — см. там же определение #y/#r.
        const label = hovered ? "#yPlay" : "#rPlay";
        state.text.render([0, PLAY_BTN_Y], 2.8, label, 1, { center: true });
    };
    this.playButtonHitTest = function()
    {
        const aspect = state.canvas.width / state.canvas.height;
        const bw = 0.28 / aspect;
        const bh = 0.09;
        return { x: 0, y: PLAY_BTN_Y, w: bw, h: bh };
    };
    this.getNickById = function(id)
    {
        let nick = nicks[id];
        if (nick)
        {
            let color = "#y";
            let bot = id === mybot.id ? mybot : allbots[id];
            if (bot)
            {
                if (bot.seria >= 5) color = "#r";
                else if (bot.seria <= -5) color = "#G";
            }

            function getPlace()
            {
                for (let i = 0; i < table.length; i++)
                    if (table[i].nick.slice(1) === nick)
                        return i;
                return -1;
            }

            const place = getPlace();
            if (place >= 0 && place < 3) color = "#C" + (place + 1) + color;

            return color + nick;
        }
        return "";
    }
    this.getBotById = function(id)
    {
        for (let i = 0; i < framebots.length; i++)
            if (framebots[i].id === id)
                return framebots[i];
        return null;
    };
    this.getLevelRender = function()
    {
        return levelRender;
    };
    this.getNicks = function()
    {
        return nicks;
    };
    this.setUserNicks = function(ids)
    {
        for (let id in ids)
        {
            nicks[id] = ids[id];
        }
    };
    this.addFrame = function(frame)
    {
        server_time = frame.time;
        if (!mybot || mybot.id !== frame.mybot.id)
        {
            mybot = new BotClient(frame.time, frame.mybot, true);
        }
        mybot.addFrame(frame.time, frame.mybot, true);
        mybot.lastFrameSeen = Date.now();

        framebots.splice(0, framebots.length);
        framebots.push(mybot);
        const seenIds = new Set([mybot.id]);
        for (let i = 0; i < frame.listbots.length; i++)
        {
            let bot = frame.listbots[i];
            let id = bot.id;
            const wasAliveLocally = allbots[id] ? allbots[id].alive : true;
            if (!allbots[id]) allbots[id] = new BotClient(frame.time, bot, false);
            else allbots[id].addFrame(frame.time, bot, false);
            allbots[id].lastFrameSeen = Date.now();
            seenIds.add(id);
            framebots.push(allbots[id]);
            // Если сервер мог пропустить bot_dead-событие (бот не был в visibility),
            // считаем смерть от перехода alive→!alive в нашей кэше как точку отсчёта трупа.
            void wasAliveLocally;
        }

        // Удерживаем «пропавших» ботов: короткий пропуск visibility (250 мс) сглаживает блинк,
        // а свежий труп остаётся лежать 3 секунды.
        const now = Date.now();
        const GHOST_VISIBILITY_MS = 250;
        const CORPSE_LINGER_MS = 5000;
        for (const idStr in allbots)
        {
            const id = +idStr;
            if (seenIds.has(id)) continue;
            const ghost = allbots[id];
            if (!ghost) continue;
            const inactive = now - (ghost.lastFrameSeen || 0);
            const isCorpse = !ghost.alive && ghost.deathStartTime &&
                now - ghost.deathStartTime < CORPSE_LINGER_MS;
            const justGone = ghost.alive && inactive < GHOST_VISIBILITY_MS;
            if (justGone || isCorpse)
            {
                framebots.push(ghost);
            }
        }

        frameitems = frame.listitems;
        frameevents = frame.listevents;
        if (frame.table.length > 0) table = frame.table;

        //request for nick
        let unknown_nicks = [];
        for (let i = 0; i < framebots.length; i++)
        {
            let id = framebots[i].id;
            if (!nicks[id]) unknown_nicks.push(id);
        }
        transport.getUserNicks(unknown_nicks);
        Event.emit("frame");
    };
    this.ready = function()
    {
        return levelRender && levelRender.ready() && mybot;
    };
    this.getCamera = function()
    {
        return mybot;
    };
    this.render = function()
    {
        function handleEvents()
        {
            frameevents.forEach((event) =>
            {
                switch (event.type)
                {
                    case EVENT.BOT_RESPAWN: return Event.emit("cl_botrespawn", event.pos);
                    case EVENT.PAIN: return Event.emit("cl_botpain", event.pos, event.dir, event.botid);
                    case EVENT.BOT_DEAD: return Event.emit("cl_botdead", event.pos, event.dir, event.botid);
                    case EVENT.TAKE_WEAPON: return Event.emit("cl_takeweapon", event.pos);
                    case EVENT.TAKE_HEALTH: return Event.emit("cl_takehealth", event.pos);
                    case EVENT.TAKE_SHIELD: return Event.emit("cl_takeshield", event.pos);
                    case EVENT.TAKE_POWER: return Event.emit("cl_takepower", event.pos);
                    case EVENT.ITEM_RESPAWN: return Event.emit("cl_itemrespawn", event.pos);
                    case EVENT.BULLET_DEAD: return state.BulletClient.remove(event.bulletid, event.pos, event.z);
                    case EVENT.BULLET_RESPAWN: return state.BulletClient.create(event);
                    case EVENT.LINE_SHOOT: return state.BulletLine.create(server_time, event);
                }
            });
            frameevents.splice(0, frameevents.length);
        }

        state.stats.count_dynent_rendering = 0;
        framebots.forEach(function(bot) { bot.update(); });
        handleEvents();

        // Сбрасываем динамические лайты предыдущего кадра и собираем новые
        // ДО рендера уровня, чтобы свет от снарядов уже попал в шейдеры пола/стен.
        if (levelRender.clearDynamicLights) levelRender.clearDynamicLights();
        if (state.BulletClient && state.BulletClient.collectLights)
            state.BulletClient.collectLights(levelRender);

        levelRender.render(mybot.dynent);

        if (state.Q2FX) state.Q2FX.update();

        levelRender.beginSpritePass();
        state.gl.enable(state.gl.BLEND);
        state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);

        state.Particle.render(mybot.dynent, 0);
        frameitems.forEach(function(item) { state.Item.render(mybot.dynent, item); });
        framebots.forEach(function(bot) { bot.render(mybot.dynent); });
        state.BulletClient.render(mybot.dynent);
        state.Particle.render(mybot.dynent, 1);
        state.Particle.render(mybot.dynent, 2);
        if (state.Q2FX) state.Q2FX.render(mybot.dynent);

        state.gl.disable(state.gl.BLEND);
        levelRender.endSpritePass();

        framebots.forEach(function(bot) { bot.renderStats(mybot.dynent); });

        if (state.Bot && state.Bot.renderFirstPersonWeapon)
            state.Bot.renderFirstPersonWeapon(mybot);

        levelRender.renderMinimap(mybot.dynent);
        state.HUD.render(mybot, table, playing);
        if (!playing) self.renderPlayOverlay();
        else state.text.render([0, 0], 3, "#w+", 1, { center: true, visibile: true });

        Console.render();
    };

    if (socket.connect) socket.connect();
}
}


export { GameClient };
