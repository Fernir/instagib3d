import { Console, assert } from '../polyfill.js';
import { state } from '../runtime-state.js';

class Texture {
  constructor(img, param, callback) {
    let gl = state.gl;
    let id = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, id);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    let filter = gl.LINEAR;
    let wrap = gl.REPEAT;
    if (param) {
      if (param.filter) filter = param.filter;
      if (param.wrap) wrap = param.wrap;
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);

    let loaded = false;
    if (typeof img === 'string') {
      let image = new Image();
      image.onload = function () {
        let gl2 = state.gl;
        gl2.bindTexture(gl2.TEXTURE_2D, id);
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, image);
        loaded = true;
        if (callback) callback();
        Console.info('Loaded texture: ' + img + ' [' + image.width + ', ' + image.height + ']');
      };
      image.onerror = function () {
        assert(false, "while loading image '" + img + "'.");
      };
      image.src = img;
    } else {
      assert(img instanceof Uint8Array);
      assert(param.size !== undefined);
      gl.bindTexture(gl.TEXTURE_2D, id);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        param.size,
        param.size,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        img,
        0,
      );
      loaded = true;
    }

    this.ready = function () {
      return loaded;
    };
    this.getId = function () {
      return loaded ? id : null;
    };
  }
}

export { Texture };
