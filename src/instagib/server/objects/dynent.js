import { Vector } from '../libs/vector.js';

class Dynent
{
    constructor(pos, size, angle)
    {
        this.pos = new Vector(pos);
        this.size = size === undefined ? new Vector(1, 1) : new Vector(size);
        this.vel = new Vector(0, 0);
        this.angle = angle === undefined ? 0.0 : angle;
    }

    update(dt)
    {
        this.pos.add(Vector.mul(this.vel, dt));
    }

    collide(dyn, size)
    {
        let min_dist = (this.size.x + size) * 0.5;

        let dx = dyn.pos.x - this.pos.x;
        let dy = dyn.pos.y - this.pos.y;
        let len2 = dx * dx + dy * dy;
        return len2 < min_dist * min_dist ? new Vector(dx, dy) : null;
    }

    render(camera, texture, shader, states)
    {
        Dynent.render(camera, texture, shader, this.pos, this.size.toVec(), this.angle, states);
    }

    interpolate(from, to, koef)
    {
        this.pos.interpolate(from.pos, to.pos, koef);

        let delta_angle = to.angle - from.angle;
        if (delta_angle > Math.PI) delta_angle = -Math.PI * 2 + delta_angle;
        else if (delta_angle < -Math.PI) delta_angle = delta_angle + Math.PI * 2;
        this.angle = from.angle + delta_angle * koef;
    }
}

function cameraCulling(camera, pos, size, offset_x = 12, offset_top = 11, offset_bottom = -2)
{
    let object_radius = size.length() * 0.5;
    let vec = Vector.sub(pos, camera.pos).rotate(camera.angle);

    return Math.abs(vec.x) - object_radius > offset_x || (vec.y - object_radius > offset_top || vec.y + object_radius < offset_bottom);
}

export { Dynent, cameraCulling };
