import { Vector } from '@/core/vector.js';

import { Dynent } from './dynent.js';

class Bridges {
  constructor(river_tree, river_buf, size_map, board_width) {
    let bridges = [];

    function create_bridge(prev, cur, next) {
      function get_width_of_river(pos, dir) {
        for (let step = 1; step < 8; step++) {
          let koef = river_buf.getSize() / size_map;
          let p = Vector.add(pos, Vector.mul(dir, step)).mul(koef);
          let river_val = river_buf.getData(p.x | 0, p.y | 0);
          if (river_val < 0.1) return step;
        }
        return 0;
      }

      let ret = null;
      let padding = board_width + 5;
      if (
        cur.x > padding &&
        cur.x < size_map - padding &&
        cur.y > padding &&
        cur.y < size_map - padding
      ) {
        let a = Vector.sub(prev, cur);
        let b = Vector.sub(next, cur);
        let bissectrice = Vector.add(a, b).mul(0.5);
        if (bissectrice.length() < 0.1) bissectrice = Vector.binormalize(a);
        let norm_biss = Vector.normalize(bissectrice);

        let w1 = get_width_of_river(cur, norm_biss);
        norm_biss.mul(-1);
        let w2 = get_width_of_river(cur, norm_biss);
        if (w1 > 0 && w2 > 0) {
          norm_biss.mul(-1);
          let left = Vector.add(cur, Vector.mul(norm_biss, w1));
          let half = Vector.mul(norm_biss, -(w1 + w2) * 0.5);
          let center = Vector.add(left, half);

          ret = new Dynent(center, [w1 + w2, 3], bissectrice.angle());
        }
      }
      return ret;
    }

    // generate bridges
    const MIN_DIST = 64;
    function generateBridges(river, length) {
      for (let i = 1; i < river.length - 1; i++) {
        let len = Vector.sub(river[i + 1].pos, river[i].pos).length();
        length += len;
        if (length > MIN_DIST) {
          let bridge = create_bridge(river[i - 1].pos, river[i].pos, river[i + 1].pos);
          if (bridge) {
            length = 0;
            bridges.push(bridge);
          }
        }
        if (river[i].next) generateBridges(river[i].next, length);
      }
    }

    generateBridges(river_tree, 0);

    this.getBridges = function () {
      return bridges;
    };
  }
}

export { Bridges };
