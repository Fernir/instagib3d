import { Console } from '../../polyfill.js';
import { Buffer } from '../libs/buffer.js';
import { Vector } from '../libs/vector.js';

import { Bridges } from './bridges.js';

class RiverGeneration
{
constructor(size_class, seed)
{
    Console.assert(size_class === 0 || size_class === 1 || size_class === 2);
    const size = 64 << size_class;

    let now = Date.now();
    let river = new Buffer(size, seed);
    this.river_tree = river.generate_river(0.75, size_class);
    this.river_blured = river.getGaussian(4);
    this.river_blured.normalize(0, 1);

    this.raw_river = new Buffer(size);
    this.raw_river.for_buf(this.river_blured, function(a, b)
    {
        return b > 0.1 ? 1 : 0;
    }).filter(1);

    let level_river = new Buffer(size * 2);
    level_river.draw(this.raw_river);
    this.blured_level_river = level_river.getGaussian(4);

    // generating velocity map
    let river_mask = new Buffer(size * 2);
    river_mask.for_buf(this.blured_level_river, function(a, b)
    {
        return b > 0 ? 1 : 0;
    });

    let velocity_x = new Buffer(size * 2);
    let velocity_y = new Buffer(size * 2);

    function generateVelocity(river, koef)
    {
        for (let i = 0; i < river.length - 1; i++)
        {
            let a = Vector.mul(river[i].pos, 2);
            let b = Vector.mul(river[i + 1].pos, 2);
            let norm = Vector.sub(b, a).normalize().mul(koef);
            
            velocity_x.bresenham(a.x | 0, a.y | 0, b.x | 0, b.y | 0, norm.x);
            velocity_y.bresenham(a.x | 0, a.y | 0, b.x | 0, b.y | 0, -norm.y);

            if (river[i].next)
                generateVelocity(river[i].next, koef);
        }
    }

    const power = 8;
    generateVelocity(this.river_tree, power);
    let blured_velocity_x = velocity_x.getGaussian(6, river_mask);
    let blured_velocity_y = velocity_y.getGaussian(6, river_mask);
    blured_velocity_x.clamp(-1, 1);
    blured_velocity_y.clamp(-1, 1);

    blured_velocity_x.for_each(function(val)
    {
        return val * 0.5 + 0.5;
    });
    blured_velocity_y.for_each(function(val)
    {
        return val * 0.5 + 0.5;
    });

    this.blured_velocity_x = blured_velocity_x;
    this.blured_velocity_y = blured_velocity_y;

    Console.info("All river generating = ", Date.now() -  now);
}
}

class LevelGeneration
{
constructor(size_class, board_size, seed)
{
    Console.assert(size_class === 0 || size_class === 1 || size_class === 2);
    const my_size = 64 << size_class;

    let now = Date.now();
    let raw_level = new Buffer(my_size, seed);
    // generate full map
    raw_level.perlin(5 << size_class, 0.3).normalize(0, 1).for_each(function(val)
    {
        return Math.abs(val - 0.5) * 2;
    }).normalize(-0.5, 2).clamp(0, 1).for_each(function(val)
    {
        return val < 0.2 ? 0 : 1;
    });
    let border = new Buffer(my_size);
    //generate border
    border.for_each(function(val, x, y)
    {
        return x < board_size ||
               y < board_size ||
               x > border.getSize() - board_size ||
               y > border.getSize() - board_size ? 1 : 0;
    });

    let river = new RiverGeneration(size_class, seed);

    raw_level.for_buf(river.river_blured, function(a, b)
    {
        return b > 0 ? 0 : a;
    });
    // final raw map
    border.for_buf(river.raw_river, function(my, riv)
    {
        return my * (1 - riv);
    });
    raw_level.for_buf(border, function(a, b)
    {
        return Math.max(a, b);
    });
    
    //Post-processing
    let blured = raw_level.getGaussian(3);
    raw_level.for_buf(blured, function(a, b)
    {
        if (a > 0.5 && b < 0.5) return 0;
        if (a < 0.5 && b > 0.5) return 1;
        return a;
    }).filter(0);

    // Snap walls to a slightly coarser grid to remove small jagged corners
    // while keeping enough bends for natural corridors.
    const grid = 2 << size_class;
    const snap_size = my_size / grid;
    const snap = new Buffer(snap_size);
    for (let gy = 0; gy < snap_size; gy++)
    {
        for (let gx = 0; gx < snap_size; gx++)
        {
            let sum = 0;
            for (let dy = 0; dy < grid; dy++)
                for (let dx = 0; dx < grid; dx++)
                    sum += raw_level.getData(gx * grid + dx, gy * grid + dy);
            snap.setData(gx + gy * snap_size, sum / (grid * grid) > 0.55 ? 1 : 0);
        }
    }
    raw_level.draw(snap);
    raw_level.filter(0);
    raw_level.for_buf(river.river_blured, function(a, b)
    {
        return b > 0 ? 0 : a;
    });
    raw_level.fill_isolated_area();
    raw_level.for_buf(river.river_blured, function(a, b)
    {
        return b > 0 ? 0 : a;
    });
    // Solid frame around the whole map so bots/players can't escape,
    // applied last so neither snap nor river carve holes through it.
    raw_level.for_each(function(val, x, y)
    {
        const s = raw_level.getSize();
        return x < board_size || y < board_size ||
               x >= s - board_size || y >= s - board_size ? 1 : val;
    });

    //create level
    let level = new Buffer(my_size * 2);
    level.draw(raw_level);
    let blured_level = level.getGaussian(4);

    let bridges = new Bridges(river.river_tree, river.blured_level_river, my_size, board_size);

    //obstruction map
    let obstruction_map = new Buffer(raw_level.getSize());
    obstruction_map.for_buf(raw_level, function(a, b)
    {
        return b;
    }).for_buf(river.raw_river, function(a, b)
    {
        return Math.max(a, b);
    });

    this.getSize = function()
    {
        return my_size;
    }
    this.getTextureSize = function()
    {
        return my_size * 2;
    }
    this.getRiverMap = function()
    {
        return river.blured_level_river;
    }
    this.getGroundMap = function()
    {
        return blured_level;
    }
    this.getWallMap = function()
    {
        return level;
    }
    this.getBridges = function()
    {
        return bridges;
    }
    this.getObstructionMap = function()
    {
        return obstruction_map;
    }
    this.getRawLevel = function()
    {
        return raw_level;
    }
    this.getVelocityX = function()
    {
        return river.blured_velocity_x;
    }
    this.getVelocityY = function()
    {
        return river.blured_velocity_y;
    }

    Console.info("Working with level = ", Date.now() -  now);
}
}

export { LevelGeneration };
