import { Console } from '../polyfill.js';
import { state } from '../runtime-state.js';
import { EVENT } from '../server/game/global.js';
import { Transport } from '../server/game/transport.js';
import { Level } from '../server/level/level.js';
import { Event } from '../server/libs/event.js';
import { Room } from '../server/room.js';

import { BotClient } from './bot.js';
import { DebugRender } from './debug.js';
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

    let debugRender;
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
        debugRender = new DebugRender(room.getGame());
        socket = new FakeSocketClient(addr, 1);
    }
    else
    {
        socket = new WebSocket("ws://" + addr);
    }

    socket.binaryType = "arraybuffer";

    let levelRender;
    let transport;

    socket.onopen = function()
    {
        transport = new Transport(socket, self);
        transport.getLevelParam(function(seed, size_class)
        {
            let level = room ? room.getGame().level : new Level(size_class, seed);
            levelRender = new LevelRender(level, size_class);

            transport.addUser(nick, function()
            {
                transport.sendUserInputs();
            });
        });
        if (debugRender) debugRender.transport = transport;
    };
    socket.onclose = function(e)
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

    Console.addCommand("spectator", "spectator bot with nick", function(id)
    {
        if (!id)
        {
            Console.error("Usage: spectator <nick>");
            return;
        }
        if (transport)
        {
            transport.changeCamera(id, function(err)
            {
                if (err === "Ok") Console.info(err);
                else Console.error(err);
            });
        }
    });
    Console.addCommand("status", "status this session", function(id)
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
    Console.addCommand("about", "about me", function(id)
    {
        Console.info("Hello, I am Sergey Chibiryaev - author instagib.io game");
    });
    Console.addCommand("trafik", "Average trafik (byte per package)", function()
    {
        Console.info(state.stats.memory_all_package / state.stats.count_net_package | 0);
    });

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

        framebots.splice(0, framebots.length);
        framebots.push(mybot);
        for (let i = 0; i < frame.listbots.length; i++)
        {
            let bot = frame.listbots[i];
            let id = bot.id;
            if (!allbots[id]) allbots[id] = new BotClient(frame.time, bot, false);
            else allbots[id].addFrame(frame.time, bot, false);

            framebots.push(allbots[id]);
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
        function renderItems()
        {
            state.gl.enable(state.gl.BLEND);

            frameitems.forEach(function(item)
            {
                state.Item.render(mybot.dynent, item);
            });

            state.gl.disable(state.gl.BLEND);
        }
        function renderBots()
        {
            state.gl.enable(state.gl.BLEND);
            if (state.options.highQuality)
            {
                state.gl.blendFunc(state.gl.DST_COLOR, state.gl.ZERO);
                
                framebots.forEach(function(bot) { bot.renderShadow(mybot.dynent); });
                
                state.gl.blendFunc(state.gl.SRC_ALPHA, state.gl.ONE_MINUS_SRC_ALPHA);
            }

            framebots.forEach(function(bot) { bot.render(mybot.dynent); });

            state.gl.disable(state.gl.BLEND);
            
            framebots.forEach(function(bot) { bot.renderStats(mybot.dynent); });
        }
        function updateBots()
        {
            framebots.forEach(function(bot)
            {
                bot.update();
            });
        }
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
                    case EVENT.BULLET_DEAD: return state.BulletClient.remove(event.bulletid);
                    case EVENT.BULLET_RESPAWN: return state.BulletClient.create(event);
                    case EVENT.LINE_SHOOT: return state.BulletLine.create(server_time, event);
                }
            });
            frameevents.splice(0, frameevents.length);
        }

        state.stats.count_dynent_rendering = 0;

        updateBots();

        handleEvents();

        levelRender.render(mybot.dynent);

        state.Particle.render(mybot.dynent, 0);

        renderItems();

        renderBots();

        state.BulletClient.render(mybot.dynent);

        state.Particle.render(mybot.dynent, 1);
        state.Particle.render(mybot.dynent, 2);

        levelRender.renderMinimap(mybot.dynent);

        state.HUD.render(mybot, table);

        state.text.render([0.8, -0.9], 2, "#gFPS#{0.87}= #w" + state.stats.fps, 1);
        state.text.render([0.8, -0.95], 2, "#gPing#{0.87}= #w" + transport.getPing(), 1);
        Console.render();

        if (local !== undefined && local === "true")
        {
            debugRender.render(mybot);
        }
    };

    if (socket.connect) socket.connect();
}
}


export { GameClient };
