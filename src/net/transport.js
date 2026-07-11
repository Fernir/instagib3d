import { Console } from '@/core/polyfill.js';
import { state as runtime, getMouseAngle, getMousePitch, VK } from '@/core/runtime-state.js';
import { normalizeAngle } from '@/core/utility.js';
import { Vector } from '@/core/vector.js';


import { WEAPON, ITEM, EVENT } from '@/global.js';

import { GameEvent } from '@/sim/game-events.js';

import { Bot } from '@/sim/bot.js';


//commands
let CL_GET_LEVEL_PARAM = 1;
let CL_PING = 2;
let CL_ADD_USER = 3;
let CL_USER_INPUTS = 4;
let CL_CHANGE_CAMERA = 5;
let CL_GET_USER_NICKS = 6;
let CL_SPECTATOR = 7;
let CL_SELECT_WEAPON = 8;

let SV_LEVEL_PARAM = 128;
let SV_PING = 129;
let SV_USER_ADDED = 130;
let SV_FRAME = 131;
let SV_USER_NICKS = 132;
let SV_SPECTATOR = 133;

let ALFABET =
  ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-+\\/():;_|%=[]><  абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЧЦШЩЪЫЬЭЮЯ';

function setString(view, offset, str) {
  function encode(str, i) {
    let ind = ALFABET.indexOf(str.charAt(i), 0);
    if (ind < 0) return encode('?');
    return ind;
  }

  let length = Math.min(str.length, 255);
  view.setUint8(offset, length);
  offset++;
  for (let i = 0; i < length; i++) {
    view.setUint8(offset, encode(str, i));
    offset++;
  }
  return offset;
}

function getString(view, offset) {
  function decode(ch) {
    let res = '';
    res = ALFABET.charAt(ch);
    return res;
  }

  let str = '';
  let length = view.getUint8(offset);
  offset++;
  for (let i = 0; i < length; i++) {
    let char = view.getUint8(offset);
    offset++;
    str += decode(char);
  }
  return { offset: offset, str: str };
}

function toFixed(float, koef = 256) {
  return (float * koef) | 0;
}

function toFloat(fixed, koef = 256) {
  return fixed / koef;
}

class ServerBot {
  constructor() {
    this.id = 0;
    this.angle = 0;
    this.x = 0;
    this.y = 0;
    this.weapon = 0;
    this.alive = false;
    this.power = 0;
    this.shield = false;
    this.shoot = false;
    this.seria = 0;
    this.health_ratio = 1;
    //for my bot
    this.life = 0;
    this.patrons = [1 << 5, 0, 0, 0, 0, 0];
    this.controlable = false;
    //stats
    this.i_am_death = 0; //id my killer
    this.i_am_kill = 0; //id who I kill
    this.i_am_multi = 0; //1 - double, 2 - triple, 3 - multi
    this.i_am_killer = false;
    this.i_am_looser = false;
    this.i_am_sniper = false;
    this.i_am_avenger = false;
    this.i_am_quickkill = false;
    this.i_am_quickdeath = false;
    this.i_am_telefraging = false;
    this.i_am_telefraged = false;
    //rating
    this.frag = 0;
    this.scores = 1200;
    this.rank = 0;
  }
}

class ServerItem {
  constructor() {
    this.type = 0;
    this.x = 0;
    this.y = 0;
  }
}

class TableRow {
  constructor() {
    this.nick = '';
    this.scores = 0;
  }
}

function setBot(view, offset, bot, isCamera, isControlable) {
  view.setUint16(offset, bot.id);
  offset += 2;

  //set bot state: alive, shoot, power, weatype
  let state = bot.weapon.type;
  let power = bot.power ? bot.power - ITEM.QUAD + 1 : 0;
  state |= power << 3;
  if (bot.shoot) state |= 1 << 5;
  if (bot.alive) state |= 1 << 6;
  if (bot.shield) state |= 1 << 7;
  view.setUint8(offset, state);
  offset++;

  let seria = bot.stats.currentseria ? bot.stats.currentseria : -bot.stats.currentantiseria;
  seria += 128;
  if (seria < 0) seria = 0;
  if (seria > 255) seria = 255;
  view.setUint8(offset, seria);
  offset++;

  view.setUint16(offset, toFixed(bot.dynent.angle));
  offset += 2;
  view.setUint16(offset, toFixed(bot.dynent.pos.x));
  offset += 2;
  view.setUint16(offset, toFixed(bot.dynent.pos.y));
  offset += 2;
  {
    const ratio = bot.health > 0 && Bot.HEALTH > 0 ? bot.health / Bot.HEALTH : 0;
    const hp_byte = Math.max(0, Math.min(255, Math.round(ratio * 255)));
    view.setUint8(offset, hp_byte);
    offset++;
  }
  if (isCamera) {
    let life = (bot.health / 40) | 0;
    if (life < 0) life = 0;
    view.setUint8(offset, life);
    offset++;
    let weamask = 0;
    for (let i = WEAPON.SHAFT; i <= WEAPON.ROCKET; i++) {
      let alpha = bot.weapon.patrons[i] / WEAPON.wea_tabl[i].patrons;
      let mask = (alpha * (1 << 5)) | 0;
      if (mask > (1 << 5) - 1) mask = (1 << 5) - 1;
      weamask |= mask;
      weamask <<= 5;
    }
    view.setUint32(offset, weamask);
    offset += 4;
    view.setUint8(offset, isControlable ? 1 : 0);
    offset++;
    //stats
    view.setUint16(offset, bot.stats.i_am_death);
    offset += 2;
    view.setUint16(offset, bot.stats.i_am_kill);
    offset += 2;
    view.setUint8(offset, bot.stats.i_am_multi);
    offset++;
    let statsmask = 0;
    if (bot.stats.i_am_killer) statsmask |= 1 << 0;
    if (bot.stats.i_am_looser) statsmask |= 1 << 1;
    if (bot.stats.i_am_sniper) statsmask |= 1 << 2;
    if (bot.stats.i_am_avenger) statsmask |= 1 << 3;
    if (bot.stats.i_am_quickkill) statsmask |= 1 << 4;
    if (bot.stats.i_am_quickdeath) statsmask |= 1 << 5;
    if (bot.stats.i_am_telefraging) statsmask |= 1 << 6;
    if (bot.stats.i_am_telefraged) statsmask |= 1 << 7;
    view.setUint8(offset, statsmask);
    offset++;
    //rating
    view.setInt16(offset, bot.stats.frag);
    offset += 2;
    view.setInt16(offset, bot.stats.scores | 0);
    offset += 2;
    view.setUint8(offset, bot.stats.rank);
    offset++;
  }
  return offset;
}

function getBot(view, offset, bot, isCamera) {
  bot.id = view.getUint16(offset);
  offset += 2;

  //get bot state: alive, shoot, power, weatype
  let state = view.getUint8(offset);
  offset++;
  bot.weapon = state & 0x7;
  let power = (state >> 3) & 0x3;
  bot.power = power ? power - 1 + ITEM.QUAD : 0;
  if (state & (1 << 5)) bot.shoot = true;
  if (state & (1 << 6)) bot.alive = true;
  if (state & (1 << 7)) bot.shield = true;

  let seria = view.getUint8(offset);
  offset++;
  bot.seria = seria - 128;

  bot.angle = toFloat(view.getUint16(offset));
  offset += 2;
  bot.x = toFloat(view.getUint16(offset));
  offset += 2;
  bot.y = toFloat(view.getUint16(offset));
  offset += 2;
  bot.health_ratio = view.getUint8(offset) / 255;
  offset++;
  if (isCamera) {
    bot.life = view.getUint8(offset);
    offset++;
    let weamask = view.getUint32(offset);
    offset += 4;
    for (let i = WEAPON.ROCKET; i >= WEAPON.SHAFT; i--) {
      weamask >>= 5;
      bot.patrons[i] = weamask & ((1 << 5) - 1);
    }
    bot.controlable = view.getUint8(offset);
    offset++;
    //stats
    bot.i_am_death = view.getUint16(offset);
    offset += 2;
    bot.i_am_kill = view.getUint16(offset);
    offset += 2;
    bot.i_am_multi = view.getUint8(offset);
    offset++;
    let statsmask = view.getUint8(offset);
    offset++;
    if (statsmask & (1 << 0)) bot.i_am_killer = true;
    if (statsmask & (1 << 1)) bot.i_am_looser = true;
    if (statsmask & (1 << 2)) bot.i_am_sniper = true;
    if (statsmask & (1 << 3)) bot.i_am_avenger = true;
    if (statsmask & (1 << 4)) bot.i_am_quickkill = true;
    if (statsmask & (1 << 5)) bot.i_am_quickdeath = true;
    if (statsmask & (1 << 6)) bot.i_am_telefraging = true;
    if (statsmask & (1 << 7)) bot.i_am_telefraged = true;
    //rating
    bot.frag = view.getInt16(offset);
    offset += 2;
    bot.scores = view.getInt16(offset);
    offset += 2;
    bot.rank = view.getUint8(offset);
    offset++;
  }
  return offset;
}

function setBots(view, offset, mybot, listbots, isControlable) {
  offset = setBot(view, offset, mybot, true, isControlable);

  view.setUint8(offset, listbots.length);
  offset++;

  for (let i = 0; i < listbots.length; i++)
    offset = setBot(view, offset, listbots[i], false, false);
  return offset;
}

function setItem(view, offset, item) {
  view.setUint8(offset, item.type);
  offset++;
  view.setUint16(offset, toFixed(item.dynent.pos.x));
  offset += 2;
  view.setUint16(offset, toFixed(item.dynent.pos.y));
  offset += 2;
  return offset;
}

function getItem(view, offset, item) {
  item.type = view.getUint8(offset);
  offset++;
  item.x = toFloat(view.getUint16(offset));
  offset += 2;
  item.y = toFloat(view.getUint16(offset));
  offset += 2;
  return offset;
}

function setItems(view, offset, listitems) {
  view.setUint8(offset, listitems.length);
  offset++;

  for (let i = 0; i < listitems.length; i++) offset = setItem(view, offset, listitems[i]);
  return offset;
}

function setEvent(view, offset, event) {
  view.setUint8(offset, event.type);
  offset++;
  if (event.type === EVENT.BULLET_DEAD) {
    let bullet = event.arg1;
    view.setUint16(offset, bullet.id);
    offset += 2;
    // Передаём точку смерти снаряда (pos.x, pos.y, z), чтобы клиент
    // мог правильно поставить декаль/частицы по 3D-координатам.
    view.setUint16(offset, toFixed(bullet.dynent.pos.x));
    offset += 2;
    view.setUint16(offset, toFixed(bullet.dynent.pos.y));
    offset += 2;
    const z_fixed = Math.max(0, Math.min(255, Math.round((bullet.z || 0) * 32)));
    view.setUint8(offset, z_fixed);
    offset++;
  } else {
    view.setUint16(offset, toFixed(event.pos.x));
    offset += 2;
    view.setUint16(offset, toFixed(event.pos.y));
    offset += 2;
    if (event.type === EVENT.PAIN || event.type === EVENT.BOT_DEAD) {
      view.setInt16(offset, toFixed(event.dir.x, 50 * 256));
      offset += 2;
      view.setInt16(offset, toFixed(event.dir.y, 50 * 256));
      offset += 2;
      view.setUint16(offset, event.arg1);
      offset += 2;
    } else if (event.type === EVENT.BOT_RESPAWN) {
      view.setUint16(offset, event.arg1);
      offset += 2;
    } else if (event.type === EVENT.BULLET_RESPAWN) {
      let bullet = event.arg1;
      let val = bullet.type | (bullet.owner.power << 4) | (event.arg2 ? 0x08 : 0);
      view.setUint8(offset, val);
      offset++;
      view.setUint16(offset, bullet.id);
      offset += 2;
      view.setUint16(offset, toFixed(normalizeAngle(bullet.dynent.angle)));
      offset += 2;
      view.setInt16(offset, toFixed(bullet.pitch || 0));
      offset += 2;
      const z_fixed = Math.max(0, Math.min(255, Math.round((bullet.z || 0) * 32)));
      view.setUint8(offset, z_fixed);
      offset++;
    } else if (event.type === EVENT.LINE_SHOOT) {
      let bullet = event.arg1;
      let val = bullet.type | (bullet.owner.power << 4);
      view.setUint8(offset, val);
      offset++;
      view.setUint16(offset, toFixed(normalizeAngle(bullet.dynent.angle)));
      offset += 2;
      let size = (bullet.dynent.size.y * 20) | 0; // size.y could not can be more 12
      if (size > 255) size = 255;
      view.setUint8(offset, size);
      offset++;
      view.setUint16(offset, toFixed(bullet.dest.x));
      offset += 2;
      view.setUint16(offset, toFixed(bullet.dest.y));
      offset += 2;
      view.setInt16(offset, toFixed(bullet.pitch || 0));
      offset += 2;
      const z_fixed = Math.max(0, Math.min(255, Math.round((bullet.dest_z || 0) * 32)));
      view.setUint8(offset, z_fixed);
      offset++;
      if (bullet.type === WEAPON.SHAFT) {
        view.setUint16(offset, bullet.owner.id);
        offset += 2;
        view.setInt16(offset, toFixed(bullet.norm_dir.x));
        offset += 2;
        view.setInt16(offset, toFixed(bullet.norm_dir.y));
        offset += 2;
        view.setInt16(offset, toFixed(bullet.nap.x));
        offset += 2;
        view.setInt16(offset, toFixed(bullet.nap.y));
        offset += 2;
      }
    }
  }
  return offset;
}

function getEvent(view, offset, event) {
  Console.assert(event instanceof GameEvent);
  event.type = view.getUint8(offset);
  offset++;
  if (event.type === EVENT.BULLET_DEAD) {
    event.bulletid = view.getUint16(offset);
    offset += 2;
    event.pos.x = toFloat(view.getUint16(offset));
    offset += 2;
    event.pos.y = toFloat(view.getUint16(offset));
    offset += 2;
    event.z = view.getUint8(offset) / 32;
    offset++;
  } else {
    event.pos.x = toFloat(view.getUint16(offset));
    offset += 2;
    event.pos.y = toFloat(view.getUint16(offset));
    offset += 2;
    if (event.type === EVENT.PAIN || event.type === EVENT.BOT_DEAD) {
      let dx = toFloat(view.getInt16(offset), 50 * 256);
      offset += 2;
      let dy = toFloat(view.getInt16(offset), 50 * 256);
      offset += 2;
      event.dir = new Vector(dx, dy);
      event.botid = view.getUint16(offset);
      offset += 2;
    } else if (event.type === EVENT.BOT_RESPAWN) {
      event.botid = view.getUint16(offset);
      offset += 2;
    } else if (event.type === EVENT.BULLET_RESPAWN) {
      let val = view.getUint8(offset);
      offset++;
      event.bullet_type = val & 0x7;
      event.power = (val >> 4) & 0xf;
      event.sound = val & 0x08;
      event.bulletid = view.getUint16(offset);
      offset += 2;
      event.angle = toFloat(view.getUint16(offset));
      offset += 2;
      event.pitch = toFloat(view.getInt16(offset));
      offset += 2;
      event.z = view.getUint8(offset) / 32;
      offset++;
    } else if (event.type === EVENT.LINE_SHOOT) {
      let val = view.getUint8(offset);
      offset++;
      event.bullet_type = val & 0xf;
      event.power = (val >> 4) & 0xf;
      event.angle = toFloat(view.getUint16(offset));
      offset += 2;
      let size = view.getUint8(offset);
      offset++;
      event.size_y = size / 20;
      let destx = toFloat(view.getUint16(offset));
      offset += 2;
      let desty = toFloat(view.getUint16(offset));
      offset += 2;
      event.dest = new Vector(destx, desty);
      event.pitch = toFloat(view.getInt16(offset));
      offset += 2;
      event.dest_z = view.getUint8(offset) / 32;
      offset++;
      if (event.bullet_type === WEAPON.SHAFT) {
        event.ownerid = view.getUint16(offset);
        offset += 2;
        let normx = toFloat(view.getInt16(offset));
        offset += 2;
        let normy = toFloat(view.getInt16(offset));
        offset += 2;
        event.norm_dir = new Vector(normx, normy);
        let napx = toFloat(view.getInt16(offset));
        offset += 2;
        let napy = toFloat(view.getInt16(offset));
        offset += 2;
        event.nap = new Vector(napx, napy);
      }
    }
  }
  return offset;
}

function setEvents(view, offset, listevents) {
  let count = Math.min(listevents.length, 255);
  view.setUint8(offset, count);
  offset++;
  for (let i = 0; i < count; i++) {
    offset = setEvent(view, offset, listevents[i]);
  }
  return offset;
}

function setRow(view, offset, bot) {
  let color = 'y';
  if (bot.isKiller()) color = 'r';
  else if (bot.isLooser()) color = 'G';
  offset = setString(view, offset, color + bot.nick);
  view.setUint16(offset, bot.stats.scores);
  offset += 2;
  return offset;
}

function getRow(view, offset, row) {
  Console.assert(row instanceof TableRow);
  const result = getString(view, offset);
  offset = result.offset;
  row.nick = result.str;
  row.scores = view.getUint16(offset);
  offset += 2;
  return offset;
}

function setTable(view, offset, table) {
  let count = table ? Math.min(table.length, 10) : 0;
  view.setUint8(offset, count);
  offset++;
  for (let i = 0; i < count; i++) {
    offset = setRow(view, offset, table[i]);
  }
  return offset;
}

function setUserNicks(view, offset, ids, game) {
  function getNickById(id) {
    for (let i = 0; i < game.bots.length; i++) if (game.bots[i].id === id) return game.bots[i].nick;
    return 'unknown';
  }

  view.setUint8(offset, ids.length);
  offset++;
  ids.forEach(function (id) {
    view.setUint16(offset, id);
    offset += 2;
    offset = setString(view, offset, getNickById(id));
  });

  return offset;
}

function getUserNicks(view, offset) {
  let ret = {};
  let count = view.getUint8(offset);
  offset++;
  for (let i = 0; i < count; i++) {
    let id = view.getUint16(offset);
    offset += 2;
    let { offset: new_offset, str } = getString(view, offset);
    offset = new_offset;
    ret[id] = str;
  }

  return { offset: offset, ids: ret };
}

// Заглушка DataView: при первом проходе серверной упаковки мы только считаем
// размер — никакие байты не записываются, сами методы no-op.
const moc_view = {
  setUint8: () => {},
  setUint16: () => {},
  setInt16: () => {},
  setUint32: () => {},
};

class Transport {
  constructor(socket, game) {
    //common
    let self = this;
    this.socket = socket;
    this.opened = false;

    //client needs
    let pingtime = 0;
    this.ping = 0;
    this.callbacks = [];
    this.unknown_nicks = new Set();

    //server needs
    this.bot = null;
    this.spectator = null;
    this.tableTime = 0;
    this.client_ping = 0;
    this.client_ping_count = 0;

    function onData(data) {
      let view = new DataView(data);
      let cmd = view.getUint8(0);
      switch (cmd) {
        //server
        case CL_GET_LEVEL_PARAM: {
          const senddata = new ArrayBuffer(1 + 4 + 4);
          const sendview = new DataView(senddata);
          sendview.setUint8(0, SV_LEVEL_PARAM);
          sendview.setUint32(0 + 1, game.seed | 0);
          sendview.setUint32(0 + 1 + 4, game.size_class | 0);
          socket.send(senddata, { binary: true });
          break;
        }
        case CL_PING: {
          const client_ping = view.getUint32(1);
          self.client_ping += Math.min(100, client_ping);
          self.client_ping_count++;
          const senddata = new ArrayBuffer(1);
          const sendview = new DataView(senddata);
          sendview.setUint8(0, SV_PING);
          socket.send(senddata, { binary: true });
          break;
        }
        case CL_ADD_USER: {
          const { str: nick } = getString(view, 1);
          game.addUser(self, nick);

          const senddata = new ArrayBuffer(1);
          const sendview = new DataView(senddata);
          sendview.setUint8(0, SV_USER_ADDED);
          socket.send(senddata, { binary: true });
          break;
        }
        case CL_USER_INPUTS: {
          const fixed_angle = view.getUint16(1);
          const keys = view.getUint8(3);
          const fixed_pitch = view.byteLength >= 6 ? view.getInt16(4) : 0;
          const user_inputs = {
            angle: toFloat(fixed_angle),
            pitch: toFloat(fixed_pitch),
            up: keys & 1,
            right: keys & 2,
            down: keys & 4,
            left: keys & 8,
            mouse: keys & 16,
            wheelup: keys & 32,
            wheeldown: keys & 64,
          };
          game.setUserInputs(self, user_inputs);
          break;
        }
        case CL_CHANGE_CAMERA: {
          const subcmd = view.getUint8(1);
          game.changeCamera(self, subcmd);
          break;
        }
        case CL_SELECT_WEAPON: {
          const type = view.getUint8(1);
          game.selectWeapon(self, type);
          break;
        }
        case CL_GET_USER_NICKS: {
          const size = view.getUint8(1);
          let offset = 2;
          const ids = [];
          for (let i = 0; i < size; i++) {
            const id = view.getUint16(offset);
            offset += 2;
            ids.push(id);
          }
          //responce
          const senddata = new ArrayBuffer(1 + setUserNicks(moc_view, 0, ids, game));
          const sendview = new DataView(senddata);
          sendview.setUint8(0, SV_USER_NICKS);
          setUserNicks(sendview, 1, ids, game);
          socket.send(senddata, { binary: true });
          break;
        }
        case CL_SPECTATOR: {
          const { str } = getString(view, 1);
          const err = game.spectator(self, str);
          //responce
          const senddata = new ArrayBuffer(1 + setString(moc_view, 0, err));
          const sendview = new DataView(senddata);
          sendview.setUint8(0, SV_SPECTATOR);
          setString(sendview, 1, err);
          socket.send(senddata, { binary: true });
          break;
        }
        //client
        case SV_LEVEL_PARAM: {
          const seed = view.getUint32(1);
          const size_class = view.getUint32(1 + 4);
          self.callbacks[SV_LEVEL_PARAM](seed, size_class);
          break;
        }
        case SV_PING:
          self.ping = Date.now() - pingtime;
          break;
        case SV_USER_ADDED:
          if (self.callbacks[SV_USER_ADDED]) self.callbacks[SV_USER_ADDED]();
          break;
        case SV_FRAME: {
          let offset = 1;
          const server_time = view.getUint32(offset);
          offset += 4;
          const mybot = new ServerBot();
          offset = getBot(view, offset, mybot, true);

          const count_bots = view.getUint8(offset);
          offset++;
          const listbots = [];
          for (let i = 0; i < count_bots; i++) {
            listbots[i] = new ServerBot();
            offset = getBot(view, offset, listbots[i], false);
          }

          const count_items = view.getUint8(offset);
          offset++;
          const listitems = [];
          for (let i = 0; i < count_items; i++) {
            listitems[i] = new ServerItem();
            offset = getItem(view, offset, listitems[i]);
          }

          const count_events = view.getUint8(offset);
          offset++;
          const listevents = [];
          for (let i = 0; i < count_events; i++) {
            listevents[i] = new GameEvent(0, [0, 0]);
            offset = getEvent(view, offset, listevents[i]);
          }

          const count_rows = view.getUint8(offset);
          offset++;
          const table = [];
          for (let i = 0; i < count_rows; i++) {
            table[i] = new TableRow();
            offset = getRow(view, offset, table[i]);
          }

          game.addFrame({
            time: server_time,
            mybot: mybot,
            listbots: listbots,
            listitems: listitems,
            listevents: listevents,
            table: table,
          });
          break;
        }
        case SV_USER_NICKS: {
          const { ids } = getUserNicks(view, 1);
          game.setUserNicks(ids);
          self.unknown_nicks.clear();
          break;
        }
        case SV_SPECTATOR: {
          const { str } = getString(view, 1);
          self.callbacks[SV_SPECTATOR](str);
          break;
        }
        default:
          Console.error('Unknown command');
          break;
      }
    }

    if (game.disconnect !== undefined) {
      function toArrayBuffer(buffer) {
        let ab = new ArrayBuffer(buffer.length);
        let view = new Uint8Array(ab);
        for (let i = 0; i < buffer.length; ++i) view[i] = buffer[i];
        return ab;
      }

      socket.on('message', function (data) {
        self.opened = true;
        onData(data instanceof ArrayBuffer ? data : toArrayBuffer(data));
      });
      socket.on('close', function () {
        game.disconnect(self);
        self.opened = false;
      });
      socket.on('error', function () {
        Console.error('Socket error');
      });
      self.opened = true;
    } else {
      /* client game: skip instanceof GameClient in ESM */
      socket.onmessage = function (e) {
        runtime.stats.count_net_package++;
        runtime.stats.memory_all_package += e.data.byteLength;
        onData(e.data);
      };

      function getPing() {
        if (!self.socket) return;

        let data = new ArrayBuffer(5);
        let view = new DataView(data);
        view.setUint8(0, CL_PING);
        view.setUint32(1, self.ping);
        socket.send(data);
        let pingdelay = parseInt(Console.variable('pingdelay', 'time for ping update', 1000));
        setTimeout(getPing, pingdelay);
        pingtime = Date.now();
      }
      getPing();

      function getNicks() {
        if (!self.socket) return;
        if (self.unknown_nicks.size > 0) {
          let data = new ArrayBuffer(1 + 1 + 2 * self.unknown_nicks.size);
          let view = new DataView(data);
          view.setUint8(0, CL_GET_USER_NICKS);
          let size = Math.min(self.unknown_nicks.size, 255);
          view.setUint8(1, size);
          let offset = 2;
          self.unknown_nicks.forEach(function (id) {
            view.setUint16(offset, id);
            offset += 2;
          });
          socket.send(data);
          Console.debug('Request for nicks', self.unknown_nicks.size);
        }
        let nickdelay = parseInt(Console.variable('nickdelay', 'time for get nicks', 1000));
        setTimeout(getNicks, nickdelay);
      }
      getNicks();
    }
  }

  getLevelParam(callback) {
    let data = new ArrayBuffer(1);
    let view = new DataView(data);
    view.setUint8(0, CL_GET_LEVEL_PARAM);
    this.socket.send(data);

    this.callbacks[SV_LEVEL_PARAM] = callback;
  }

  addUser(nick, callback) {
    let data = new ArrayBuffer(1 + setString(moc_view, 0, nick));
    let view = new DataView(data);
    let offset = 0;
    view.setUint8(offset, CL_ADD_USER);
    offset++;
    offset = setString(view, offset, nick);
    this.socket.send(data);

    this.callbacks[SV_USER_ADDED] = callback;
  }

  getPing() {
    return this.ping;
  }

  sendUserInputs() {
    let self = this;
    function sendInputs() {
      if (!self.socket) return;

      let angle = normalizeAngle(getMouseAngle());
      let pitch = typeof getMousePitch === 'function' ? getMousePitch() : 0;
      let fixed_angle = toFixed(angle);
      let fixed_pitch = toFixed(pitch);
      if (fixed_pitch > 32767) fixed_pitch = 32767;
      if (fixed_pitch < -32768) fixed_pitch = -32768;
      let keys = 0;
      if (VK.W()) keys |= 1;
      if (VK.D()) keys |= 2;
      if (VK.S()) keys |= 4;
      if (VK.A()) keys |= 8;
      if (runtime.input.mouse_down) keys |= 16;

      if (!self.old_wheel) self.old_wheel = runtime.input.mouse_wheel;
      let delta = runtime.input.mouse_wheel - self.old_wheel;
      self.old_wheel = runtime.input.mouse_wheel;
      if (delta > 0) keys |= 32;
      else if (delta < 0) keys |= 64;

      let data = new ArrayBuffer(1 + 2 + 1 + 2);
      let view = new DataView(data);
      view.setUint8(0, CL_USER_INPUTS);
      view.setUint16(1, fixed_angle);
      view.setUint8(3, keys);
      view.setInt16(4, fixed_pitch);
      self.socket.send(data);
      let send_time = parseInt(
        Console.variable('send-user-input-time', 'time for send user input', 33),
      );
      setTimeout(sendInputs, send_time);
    }
    sendInputs();
  }

  sendFrame(server_time, mybot, listbots, listitems, listevents, table) {
    if (!this.opened) return;

    if (this.socket.readyState != null && this.socket.readyState !== this.socket.OPEN) {
      Console.error('Socket status =', this.socket.readyState);
      return;
    }

    Console.assert(mybot);

    let length = 1 + 4;
    length += setBots(moc_view, 0, mybot, listbots, mybot === this.bot);
    length += setItems(moc_view, 0, listitems);
    length += setEvents(moc_view, 0, listevents);
    length += setTable(moc_view, 0, table);

    let data = new ArrayBuffer(length);
    let view = new DataView(data);

    let offset = 0;
    view.setUint8(offset, SV_FRAME);
    offset++;
    view.setUint32(offset, server_time);
    offset += 4;

    offset = setBots(view, offset, mybot, listbots, mybot === this.bot);
    offset = setItems(view, offset, listitems);
    offset = setEvents(view, offset, listevents);
    offset = setTable(view, offset, table);

    this.socket.send(data);
  }

  changeCamera(cmd, callback) {
    if (typeof cmd === 'number') {
      let data = new ArrayBuffer(2);
      let view = new DataView(data);
      view.setUint8(0, CL_CHANGE_CAMERA);
      view.setUint8(1, cmd);
      this.socket.send(data);
    } else {
      // Пустая строка допустима: серверу сообщает «возьми первого попавшегося бота».
      const nick = typeof cmd === 'string' ? cmd : '';
      let data = new ArrayBuffer(1 + setString(moc_view, 0, nick));
      let view = new DataView(data);
      view.setUint8(0, CL_SPECTATOR);
      setString(view, 1, nick);
      this.socket.send(data);
      this.callbacks[SV_SPECTATOR] = callback;
    }
  }

  getUserNicks(nick_ids) {
    let self = this;
    nick_ids.forEach(function (id) {
      self.unknown_nicks.add(id);
    });
  }

  selectWeapon(type) {
    if (!this.socket) return;
    let data = new ArrayBuffer(2);
    let view = new DataView(data);
    view.setUint8(0, CL_SELECT_WEAPON);
    view.setUint8(1, type);
    this.socket.send(data);
  }
}

const __testing = {
  setString,
  getString,
  toFixed,
  toFloat,
  ServerBot,
  ServerItem,
  TableRow,
  setBot,
  getBot,
  setItem,
  getItem,
  setEvent,
  getEvent,
  setRow,
  getRow,
};

export { Transport, __testing };
