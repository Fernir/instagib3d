import { Event } from '@core/event.js';
import { ITEM, WEAPON } from '@game/global.js';
import { config } from '@game/polyfill.js';

import { Dynent } from './dynent.js';

class Item {
  constructor(game, pos, type, val) {
    this.type = type || (1 + Math.random() * ITEM.COUNT) | 0;
    if (!val) {
      val = this.type <= WEAPON.ROCKET ? WEAPON.wea_tabl[this.type].patrons : 0;
    }
    this.val = val;
    this.dynent = new Dynent(pos);
    this.alive = true;
    this.item_pos = null;
    this.game = game;
  }

  update() {
    for (let i = 0; i < this.game.bots.length; i++) {
      let bot = this.game.bots[i];
      if (!bot.alive) continue;

      let dir = bot.dynent.collide(this.dynent, this.dynent.size.x);
      if (dir !== null) {
        if (this.game.isShowcaseBot && this.game.isShowcaseBot(bot)) continue;
        if (this.type <= WEAPON.ROCKET) {
          Event.emit('takeweapon', bot, this.type, this.val);
        } else if (this.type === ITEM.LIFE) {
          Event.emit('takehealth', bot);
        } else if (this.type === ITEM.SHIELD) {
          Event.emit('takeshield', bot);
        } else {
          Event.emit('takepower', bot, this.type);
        }
        let time_resp = parseInt(config.get('game-server:item-respawn-time'));
        if (this.item_pos) this.item_pos.time = Date.now() + time_resp;
        this.alive = false;
        return false;
      }
    }
    return true;
  }
}

Event.on('botdead', function (bot) {
  if (bot.weapon.type === WEAPON.PISTOL) return;

  let patrons = bot.weapon.patrons[bot.weapon.type];
  if (patrons > 0) {
    bot.game.droped.push(new Item(bot.game, bot.dynent.pos, bot.weapon.type, patrons));
  }
});

function initItem(game) {
  if (game.item_inited) return;

  let level_item_pos = game.level.getItemPos();
  for (let i = 0; i < level_item_pos.length; i++) {
    let item_pos = level_item_pos[i];
    item_pos.time = 0;
    item_pos.item = null;
    item_pos.update = function () {
      if (this.item === null) {
        if (Date.now() > this.time) {
          this.item = new Item(game, this.pos);
          this.item.item_pos = this;
          Event.emit('itemrespawn', this.item);
        }
      }
    };
  }
  game.item_inited = true;
}

function itemForEach(game, callback) {
  game.level.getItemPos().forEach(function (item_pos) {
    if (item_pos.item) callback(item_pos.item);
  });
  game.droped.forEach(function (droped) {
    callback(droped);
  });
}

function updateItem(game) {
  initItem(game);

  game.level.getItemPos().forEach(function (item_pos) {
    item_pos.update();
    if (item_pos.item) {
      if (!item_pos.item.update()) {
        item_pos.item = null;
      }
    }
  });

  for (let index = 0; index < game.droped.length; ) {
    let droped = game.droped[index];
    if (droped.update()) {
      index++;
    } else {
      game.droped.splice(index, 1);
    }
  }
}

export { Item, itemForEach, updateItem };
