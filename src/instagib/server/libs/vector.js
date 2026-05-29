import { Console } from '../../polyfill.js';

class Vector {
  constructor(arg1, arg2) {
    if (arg1 instanceof Vector) {
      Console.assert(arg2 === undefined);
      this.x = arg1.x;
      this.y = arg1.y;
    } else if (typeof arg1 === 'object') {
      Console.assert(arg2 === undefined);
      this.x = arg1[0];
      this.y = arg1[1];
    } else {
      Console.assert(typeof arg1 === 'number');
      Console.assert(typeof arg2 === 'number');
      this.x = arg1;
      this.y = arg2;
    }
  }

  toVec() {
    return [this.x, this.y];
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(vec) {
    this.x = vec.x;
    this.y = vec.y;
    return this;
  }

  add(vec) {
    this.x += vec.x;
    this.y += vec.y;
    return this;
  }

  add2(x, y) {
    this.x += x;
    this.y += y;
    return this;
  }

  sub(vec) {
    this.x -= vec.x;
    this.y -= vec.y;
    return this;
  }

  sub2(x, y) {
    this.x -= x;
    this.y -= y;
    return this;
  }

  mul(val) {
    this.x *= val;
    this.y *= val;
    return this;
  }

  mul2(x, y) {
    this.x *= x;
    this.y *= y;
    return this;
  }

  static add(a, b) {
    let ret = new Vector(a);
    return ret.add(b);
  }

  static add2(a, x, y) {
    let ret = new Vector(a);
    return ret.add2(x, y);
  }

  static sub(a, b) {
    let ret = new Vector(a);
    return ret.sub(b);
  }

  static sub2(a, x, y) {
    let ret = new Vector(a);
    return ret.sub2(x, y);
  }

  static mul(a, val) {
    let ret = new Vector(a);
    return ret.mul(val);
  }

  dot(vec) {
    return this.x * vec.x + this.y * vec.y;
  }

  length2() {
    return this.dot(this);
  }

  length() {
    return Math.sqrt(this.length2());
  }

  rotate(angle) {
    let cosa = Math.cos(angle);
    let sina = Math.sin(angle);

    let x = this.x * cosa - this.y * sina;
    let y = -this.x * sina - this.y * cosa;
    return this.set(x, y);
  }

  static rotate(vec, angle) {
    let ret = new Vector(vec);
    return ret.rotate(angle);
  }

  normalize() {
    let len = this.length();
    if (len !== 0.0) {
      this.mul(1 / len);
    }
    return this;
  }

  static normalize(vec) {
    let ret = new Vector(vec);
    return ret.normalize();
  }

  binormalize() {
    return this.set(this.y, -this.x);
  }

  static binormalize(vec) {
    let ret = new Vector(vec);
    return ret.binormalize();
  }

  angle() {
    return Math.atan2(-this.y, this.x);
  }

  interpolate(from, to, koef) {
    return this.copy(to).sub(from).mul(koef).add(from);
  }

  static interpolate(from, to, koef) {
    let ret = new Vector(0, 0);
    return ret.interpolate(from, to, koef);
  }
}

export { Vector };
