import { Console } from '../../polyfill.js';
import { Buffer } from '../libs/buffer.js';
import { Vector } from '../libs/vector.js';

class Waypoint {
  constructor(pos, dist) {
    this.pos = pos;
    this.dist = dist;
    this.next = [];
    this.deleting_edges = [];
  }

  del_next(next) {
    for (let i = 0; i < this.next.length; i++) {
      if (this.next[i] === next) {
        this.next.splice(i, 1);
        break;
      }
    }
  }

  normalize() {
    for (let i = 0; i < this.next.length - 1; i++) {
      for (let j = i + 1; j < this.next.length; ) {
        if (this.next[i] === this.next[j]) this.next.splice(j, 1);
        else j++;
      }
    }
  }

  isBridge() {
    return this.isbridge !== undefined && this.isbridge === true;
  }
}

function AI(generated_level) {
  let time = Date.now();

  let obstruction_map = generated_level.getLevelGener().getObstructionMap();
  let raw_level = generated_level.getLevelGener().getRawLevel();
  let bridges = generated_level.getLevelGener().getBridges().getBridges();

  let distance_field = new Buffer(obstruction_map.getSize() * 2);
  let level = new Buffer(obstruction_map.getSize() * 2);
  level.draw(obstruction_map);
  distance_field.copy(level);

  const MAX_VALUE = 256;
  distance_field.normalize(0, MAX_VALUE).for_each(function (val, x, y) {
    if (
      x === 0 ||
      x === distance_field.getSize() - 1 ||
      y === 0 ||
      y === distance_field.getSize() - 1
    )
      return MAX_VALUE;
    else return val;
  });

  function distance_step_forward() {
    let size = level.getSize();
    const SQRT_2 = Math.sqrt(2);
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        if (distance_field.getData(i, j) < MAX_VALUE - 0.5) {
          let val00 = distance_field.getData(i - 1, j - 1) - SQRT_2;
          let val10 = distance_field.getData(i, j - 1) - 1;
          let val20 = distance_field.getData(i + 1, j - 1) - SQRT_2;
          let val01 = distance_field.getData(i - 1, j) - 1;
          let val = Math.max(val00, val10, val20, val01);
          distance_field.setData(i + j * size, val);
        }
      }
    }
  }
  function distance_step_backward() {
    let size = level.getSize();
    const SQRT_2 = Math.sqrt(2);
    for (let j = size - 1; j > 0; j--) {
      for (let i = size - 1; i > 0; i--) {
        let val = distance_field.getData(i, j);
        if (val < MAX_VALUE - 0.5) {
          let val00 = distance_field.getData(i - 1, j + 1) - SQRT_2;
          let val10 = distance_field.getData(i, j + 1) - 1;
          let val20 = distance_field.getData(i + 1, j + 1) - SQRT_2;
          let val01 = distance_field.getData(i + 1, j) - 1;
          val = Math.max(val00, val10, val20, val01, val);
          distance_field.setData(i + j * size, val);
        }
      }
    }
  }

  distance_step_forward();
  distance_step_backward();

  let gradient_x = new Buffer(level.getSize());
  let gradient_y = new Buffer(level.getSize());

  function calc_gradient() {
    let size = level.getSize();
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        let val00 = distance_field.getData(i - 1, j - 1);
        let val10 = distance_field.getData(i, j - 1);
        let val20 = distance_field.getData(i + 1, j - 1);
        let val01 = distance_field.getData(i - 1, j);
        let val11 = distance_field.getData(i, j);
        let val21 = distance_field.getData(i + 1, j);
        let val02 = distance_field.getData(i - 1, j + 1);
        let val12 = distance_field.getData(i, j + 1);
        let val22 = distance_field.getData(i + 1, j + 1);

        let dx =
          val00 -
          val11 +
          (val01 - val11) +
          (val02 - val11) +
          (val11 - val20) +
          (val11 - val21) +
          (val11 - val22);

        let dy =
          val00 -
          val11 +
          (val10 - val11) +
          (val20 - val11) +
          (val11 - val02) +
          (val11 - val12) +
          (val11 - val22);

        gradient_x.setData((i + j * size) | 0, dx);
        gradient_y.setData((i + j * size) | 0, dy);
      }
    }
  }

  calc_gradient();

  gradient_x.normalize(-1, 1);
  gradient_y.normalize(-1, 1);
  const POROG = 0.4;

  let waypoints = [];

  function insert_bridges() {
    bridges.forEach(function (bridge) {
      let center = Vector.mul(bridge.pos, 2);
      let length = bridge.size.x;
      let dir = new Vector(-Math.cos(bridge.angle) * length, Math.sin(bridge.angle) * length);
      let p1 = Vector.add(center, dir);
      let p2 = Vector.sub(center, dir);
      let way1 = new Waypoint(p1, MAX_VALUE);
      let way2 = new Waypoint(p2, MAX_VALUE);
      let way3 = new Waypoint(center, MAX_VALUE);
      way1.isbridge = true;
      way2.isbridge = true;
      way3.isbridge = true;
      way1.next.push(way3);
      way2.next.push(way3);
      way3.next.push(way1);
      way3.next.push(way2);
      waypoints.push(way1);
      waypoints.push(way2);
      waypoints.push(way3);
    });
  }
  function find_waypoints() {
    let size = level.getSize();
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        let val = level.getData(i, j);
        if (val > 0.5) continue;

        let valx00 = gradient_x.getData(i, j);
        let valy00 = gradient_y.getData(i, j);
        if (valx00 > -POROG && valx00 < POROG && valy00 > -POROG && valy00 < POROG) {
          waypoints.push(new Waypoint(new Vector(i, j), MAX_VALUE - distance_field.getData(i, j)));
        }

        let valx10 = gradient_x.getData(i + 1, j);
        let valx01 = gradient_x.getData(i, j + 1);
        let valx11 = gradient_x.getData(i + 1, j + 1);

        let valy10 = gradient_y.getData(i + 1, j);
        let valy01 = gradient_y.getData(i, j + 1);
        let valy11 = gradient_y.getData(i + 1, j + 1);

        let valx = valx00 + valx10 + valx01 + valx11;
        let valy = valy00 + valy10 + valy01 + valy11;
        if (valx > -POROG && valx < POROG && valy > -POROG && valy < POROG) {
          waypoints.push(
            new Waypoint(new Vector(i + 0.5, j + 0.5), MAX_VALUE - distance_field.getData(i, j)),
          );
        }
      }
    }
    waypoints.sort(function (a, b) {
      return b.dist - a.dist;
    });
  }
  function calc_hash(size_ceil) {
    let hash = [];
    for (let i = 0; i < waypoints.length; i++) {
      let x = (waypoints[i].pos.x / size_ceil) | 0;
      let y = (waypoints[i].pos.y / size_ceil) | 0;
      let ind = x + level.getSize() * y;
      if (hash[ind] === undefined) hash[ind] = [];
      hash[ind].push(waypoints[i]);
    }
    return hash;
  }
  function hash_forEach(hash, waypoint, size_ceil, callback) {
    let x = (waypoint.pos.x / size_ceil) | 0;
    let y = (waypoint.pos.y / size_ceil) | 0;

    for (let xx = x - 1; xx <= x + 1; xx++) {
      for (let yy = y - 1; yy <= y + 1; yy++) {
        let ind = xx + yy * level.getSize();
        if (hash[ind]) {
          hash[ind].forEach(function (next) {
            if (next === waypoint) return;

            callback(next);
          });
        }
      }
    }
  }
  function delete_waypoints() {
    for (let i = 0; i < waypoints.length; ) {
      if (waypoints[i].del && waypoints[i].del === true) {
        waypoints[i].next.forEach(function (next) {
          next.del_next(waypoints[i]);
        });
        waypoints.splice(i, 1);
      } else i++;
    }
  }
  function filter_nearest() {
    const MIN_DIST = 4;
    let hash = calc_hash(MIN_DIST);
    for (let i = 0; i < waypoints.length; i++) {
      let cur = waypoints[i];
      if (cur.del && cur.del === true) continue;
      if (cur.isBridge()) continue;

      hash_forEach(hash, cur, MIN_DIST, function (next) {
        if (next.isBridge()) return;

        let dir = Vector.sub(cur.pos, next.pos);
        if (dir.length2() < MIN_DIST * MIN_DIST) {
          next.del = true;
        }
      });
    }
    delete_waypoints();
  }
  const MAX_DIST = 10 * 2;
  function visible(a, b, buffer, max_val, max_dist) {
    let norm = Vector.sub(b, a);
    let len = norm.length();
    if (len > max_dist) return false;

    //tracing there
    norm.normalize();
    for (let step = 1; step < len; step++) {
      let vec = Vector.mul(norm, step);
      let pos = Vector.add(a, vec);
      let x = (pos.x + 0.5) | 0;
      let y = (pos.y + 0.5) | 0;
      if (buffer.getData(x, y) > max_val) return false;
    }
    return true;
  }
  function build_graph() {
    let hash = calc_hash(MAX_DIST);
    for (let i = 0; i < waypoints.length; i++) {
      let cur = waypoints[i];
      hash_forEach(hash, cur, MAX_DIST, function (next) {
        if (visible(cur.pos, next.pos, level, 0.5, MAX_DIST)) {
          cur.next.push(next);
          next.next.push(cur);
        }
      });
    }

    for (let i = 0; i < waypoints.length; i++) waypoints[i].normalize();
  }
  function filter_triangle_pattern() {
    function equals(next1, next2) {
      let ret = [];
      for (let i = 0; i < next1.length; i++) {
        let n1 = next1[i];
        for (let j = 0; j < next2.length; j++) {
          let n2 = next2[j];
          if (n1 === n2) ret.push(n1);
        }
      }
      return ret;
    }

    for (let i = 0; i < waypoints.length; i++) {
      let cur = waypoints[i];
      for (let ii = 0; ii < cur.next.length; ii++) {
        let next = cur.next[ii];
        let commons = equals(cur.next, next.next);
        for (let jj = 0; jj < commons.length; jj++) {
          let common = commons[jj];
          // triangle A - cur; B - next; C - common
          let ABx = next.pos.x - cur.pos.x;
          let ABy = next.pos.y - cur.pos.y;
          let ACx = common.pos.x - cur.pos.x;
          let ACy = common.pos.y - cur.pos.y;
          let BCx = common.pos.x - next.pos.x;
          let BCy = common.pos.y - next.pos.y;
          let ab = ABx * ABx + ABy * ABy;
          let ac = ACx * ACx + ACy * ACy;
          let bc = BCx * BCx + BCy * BCy;

          if (ab > ac && ab > bc) {
            cur.deleting_edges.push(next);
          } else if (ac > ab && ac > bc) {
            cur.deleting_edges.push(common);
          }
        }
      }
    }
    for (let i = 0; i < waypoints.length; i++) {
      let cur = waypoints[i];
      cur.deleting_edges.forEach(function (del) {
        cur.del_next(del);
        del.del_next(cur);
      });
    }
  }
  function filter_pipirks() {
    for (let i = 0; i < waypoints.length; i++) {
      let cur = waypoints[i];
      if (cur.isBridge()) continue;

      if (cur.next.length <= 1) {
        cur.del = true;
      }
    }
    delete_waypoints();
  }
  function div_coord() {
    for (let i = 0; i < waypoints.length; i++) {
      waypoints[i].pos.mul(0.5);
      waypoints[i].dist *= 0.5;
    }
  }

  insert_bridges();
  find_waypoints();
  Console.debug('Count waypoints = ', waypoints.length);
  filter_nearest();
  Console.debug('Count waypoints after filter nearest = ', waypoints.length);
  build_graph();
  filter_triangle_pattern();
  filter_pipirks();
  Console.debug('Count waypoints after filter pipirks = ', waypoints.length);
  div_coord();

  const WAYPOINT_VISIBLE_DIST = MAX_DIST / 2;
  AI.OBJECT_VISIBLE_DIST = WAYPOINT_VISIBLE_DIST * Math.sqrt(2);
  let hash_max_dist = calc_hash(WAYPOINT_VISIBLE_DIST);

  this.isVisible = function (my_pos, pos, val = 2.5, max_dist = WAYPOINT_VISIBLE_DIST) {
    let a = Vector.mul(my_pos, 2);
    let b = Vector.mul(pos, 2);
    return visible(a, b, distance_field, MAX_VALUE - val, max_dist * 2);
  };
  this.botVisible = function (my_pos, bot_pos) {
    return visible(my_pos, bot_pos, raw_level, 0.5, AI.OBJECT_VISIBLE_DIST);
  };
  this.getVisibleWaypoint = function (dynent) {
    let ret = [];
    let self = this;
    hash_forEach(hash_max_dist, dynent, WAYPOINT_VISIBLE_DIST, function (next) {
      if (self.isVisible(dynent.pos, next.pos, 0.5)) {
        ret.push(next);
      }
    });
    return ret;
  };
  this.getGradient = function (my_pos) {
    let x = (my_pos.x * 2) | 0;
    let y = (my_pos.y * 2) | 0;
    let size = level.getSize();
    x = Math.max(0, Math.min(size - 1, x));
    y = Math.max(0, Math.min(size - 1, y));
    let grad_x = gradient_x.getData(x, y);
    let grad_y = gradient_y.getData(x, y);
    if (level.getData(x, y) > 0.5) //obstacle or lava
    {
      let bridge = generated_level.getCollideBridges(my_pos);
      if (bridge) {
        return new Vector(-Math.cos(bridge.bridge.angle), Math.sin(bridge.bridge.angle));
      }
    }
    let vec = new Vector(grad_x, grad_y);
    return vec.normalize();
  };

  Console.info('AI = ', Date.now() - time);
}

export { AI };
