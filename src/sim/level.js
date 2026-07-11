import { Console } from '@/core/polyfill.js';
import { Random } from '@/core/utility.js';
import { Vector } from '@/core/vector.js';

import { Dynent } from './dynent.js';

import { AI } from './ai.js';
import { LevelGeneration } from './gener.js';

const LAVA_SHORE_FACTOR = 102;
const LAVA_SPAWN_FACTOR = 160;
const MAP_COLLIDE_FACTOR = 80;

function bridgeLocalPos(worldPos, bridge) {
  const dist = Vector.sub(worldPos, bridge.pos);
  const cosa = Math.cos(bridge.angle);
  const sina = Math.sin(bridge.angle);
  return new Vector(dist.x * cosa - dist.y * sina, dist.x * sina + dist.y * cosa);
}

function bridgeDominantInwardLocal(bp, hx, hy, margin = 0.4) {
  const dxIn = hx - Math.abs(bp.x);
  const dyIn = hy - Math.abs(bp.y);
  if (dxIn > margin && dyIn > margin) return null;
  const localNorm = new Vector(0, 0);
  if (dxIn <= dyIn) localNorm.x = bp.x > 0 ? -1 : 1;
  else localNorm.y = bp.y > 0 ? -1 : 1;
  return localNorm;
}

function bridgeLavaEdgeInward(worldPos, bridge, getLavaTile, factor = LAVA_SHORE_FACTOR) {
  const bp = bridgeLocalPos(worldPos, bridge);
  const hx = bridge.size.x * 0.5;
  const hy = bridge.size.y * 0.5;
  const localNorm = bridgeDominantInwardLocal(bp, hx, hy);
  if (!localNorm) return null;
  const cosa = Math.cos(bridge.angle);
  const sina = Math.sin(bridge.angle);
  const inward = new Vector(
    localNorm.x * cosa - localNorm.y * sina,
    localNorm.x * sina + localNorm.y * cosa,
  );
  const probe = Vector.add(worldPos, Vector.mul(new Vector(inward), -0.6));
  if (getLavaTile(probe) <= factor) return null;
  return inward;
}

class Level {
  constructor(size_class, seed) {
    this.getItemPos = function () {
      return itemPos;
    };
    this.getLevelGener = function () {
      return level;
    };
    this.getAI = function () {
      return ai;
    };
    this.getRandomPos = function (rand) {
      let random_generator = rand ? rand.next : Math.random;
      while (true) {
        let x = (my_board_width + random_generator() * (level.getSize() - my_board_width - 1)) | 0;
        let y = (my_board_width + random_generator() * (level.getSize() - my_board_width - 1)) | 0;
        let pos = new Vector(x, y);
        if (!this.collideMap(pos, 50) && !this.collideLava(pos, LAVA_SPAWN_FACTOR)) return pos;
      }
    };
    this.getMaxBots = function () {
      // calc count players. One player for 16x16 square
      const MAX_BOTS = 20;
      let square = 0;
      level.getObstructionMap().for_each(function (val) {
        if (val < 0.5) square++;
        return val;
      });
      let count_player = (square / (16 * 16)) | 0;
      Console.debug('Count players for this level = ', count_player);
      return Math.min(count_player, MAX_BOTS);
    };

    //collide
    //for bot min val == 80
    //for bullet near 80
    //pos - Vector
    this.getCollide = function (pos, lava) {
      function frac(x) {
        return x - (x | 0);
      }
      function lerp(a, b, t) {
        return a * (1 - t) + b * t;
      }
      // Same blurred field as 2D instagib.io and 3D wall mesh (iso 0.5 on ground map).
      let buffer = lava ? level.getRiverMap() : level.getGroundMap();
      const koef = buffer.getSize() / my_size;
      let x = (pos.x - 0.25) * koef;
      let y = (pos.y - 0.25) * koef;
      let cx = x | 0;
      let cy = y | 0;
      if (cx < 0) return 0;
      if (cy < 0) return 0;
      if (cx > buffer.getSize() - 1) return 0;
      if (cy > buffer.getSize() - 1) return 0;

      let t00 = buffer.getData(cx, cy);
      let t10 = buffer.getData(cx + 1, cy);
      let t01 = buffer.getData(cx, cy + 1);
      let t11 = buffer.getData(cx + 1, cy + 1);
      let dx = frac(x);
      let dy = frac(y);
      let xx1 = lerp(t00, t10, dx);
      let xx2 = lerp(t01, t11, dx);
      let yy = lerp(xx1, xx2, dy);
      return (yy * 255) | 0;
    };

    //dest_n -- Vector
    //pos -- Vector
    this.getNorm = function (dest_n, pos, lava = false) {
      Console.assert(dest_n);
      let t00 = this.getCollide(pos, lava);
      let t10 = this.getCollide(new Vector(pos.x + 0.25, pos.y), lava);
      let t01 = this.getCollide(new Vector(pos.x, pos.y + 0.25), lava);
      dest_n.set(t10 - t00, t01 - t00);
      return t00;
    };

    //pos --  Vector
    this.getCollideBridges = function (pos) {
      let bridges = level.getBridges().getBridges();
      for (let i = 0; i < bridges.length; i++) {
        let bridge = bridges[i];
        let local = bridgeLocalPos(pos, bridge);
        if (Math.abs(local.x) < bridge.size.x * 0.5 + 0.3 && Math.abs(local.y) < bridge.size.y * 0.5 + 0.3)
          return { bridge: bridge, pos: local };
      }
      return null;
    };

    //collide map
    //pos - Vector
    //return Vector
    this.collideMap = function (pos, factor = MAP_COLLIDE_FACTOR) {
      let dir = new Vector(0, 0);
      let tile = this.getNorm(dir, pos);
      return tile > factor ? dir : null;
    };

    //collide_lava
    //pos - Vector
    this.collideLava = function (pos, factor = LAVA_SPAWN_FACTOR) {
      let tile = this.getCollide(pos, true);
      return tile > factor;
    };

    // Бортик у лавы: не даёт зайти в «чашу» (на мосту — отдельная проверка края).
    this.collideLavaShore = function (pos, factor = LAVA_SHORE_FACTOR) {
      if (this.getCollideBridges(pos) !== null) return null;
      let tile = this.getCollide(pos, true);
      if (tile <= factor) return null;
      let norm = new Vector(0, 0);
      this.getNorm(norm, pos, true);
      if (norm.length2() < 1e-10) return null;
      return norm;
    };

    // Край моста над лавой — нельзя слезть в «чашу».
    this.collideBridgeLavaEdge = function (pos, factor = LAVA_SHORE_FACTOR) {
      const hit = this.getCollideBridges(pos);
      if (!hit) return null;
      return bridgeLavaEdgeInward(pos, hit.bridge, (p) => this.getCollide(p, true), factor);
    };

    this.collideLavaBarrier = function (pos) {
      let norm = this.collideLavaShore(pos);
      if (norm) return { norm, kind: 'shore' };
      norm = this.collideBridgeLavaEdge(pos);
      if (norm) return { norm, kind: 'bridge' };
      return null;
    };

    //pos -- Vector
    this.getSafetyDir = function (pos) {
      function getHeight(buffer) {
        const koef = buffer.getSize() / my_size;
        let x = (pos.x - 0.25) * koef;
        let y = (pos.y - 0.25) * koef;
        let cx = x | 0;
        let cy = y | 0;
        if (cx < 0) return 0;
        if (cy < 0) return 0;
        if (cx > buffer.getSize() - 1) return 0;
        if (cy > buffer.getSize() - 1) return 0;
        return (buffer.getData(cx, cy) * 255) | 0;
      }

      let ground = getHeight(level.getGroundMap());
      if (ground > 30) ground = this.getCollide(pos, false);
      if (ground > 30) {
        let norm = new Vector(0, 0);
        this.getNorm(norm, pos, false);
        return norm.normalize();
      }

      let lava = getHeight(level.getRiverMap());
      if (lava > 30) lava = this.getCollide(pos, true);
      if (lava > 30) {
        //bridges
        let collide_bridge = this.getCollideBridges(pos);
        if (collide_bridge) {
          let bridge = collide_bridge.bridge;
          let bridge_pos = collide_bridge.pos;
          let norm = new Vector(0, 0);
          if (bridge_pos.x > bridge.size.x * 0.5 - 0.3) norm.add2(-1, 0);
          if (bridge_pos.x < -bridge.size.x * 0.5 + 0.3) norm.add2(1, 0);
          if (bridge_pos.y > bridge.size.y * 0.5 - 0.3) norm.add2(0, -1);
          if (bridge_pos.y < -bridge.size.y * 0.5 + 0.3) norm.add2(0, 1);
          let len = norm.length2();
          norm.normalize().rotate(bridge.angle);
          return len < 0.5 ? null : norm;
        }
        let norm = new Vector(0, 0);
        this.getNorm(norm, pos, true);
        return norm.normalize();
      }
      return null;
    };

    function generItemPos(level) {
      let count = level.getMaxBots();
      let item_pos = new Array(count);
      let rand = new Random(my_seed);

      for (let i = 0; i < count; i++) {
        let pos = level.getRandomPos(rand);
        item_pos[i] = new Dynent(pos, [2, 2]);
      }
      return item_pos;
    }

    const my_size_class = size_class; // 0 - 64, 1 - 128, 2 - 256
    const my_board_width = 3;
    const my_seed = seed; //(Date.now() * Math.random()) & 0xffffffff;

    Console.debug('My seed = ', my_seed);
    let level = new LevelGeneration(my_size_class, my_board_width, my_seed);
    let my_size = level.getSize();

    //AI
    let ai = new AI(this);
    let itemPos = generItemPos(this);
  }
}

export { Level, LAVA_SHORE_FACTOR, bridgeLocalPos, bridgeDominantInwardLocal, bridgeLavaEdgeInward };
