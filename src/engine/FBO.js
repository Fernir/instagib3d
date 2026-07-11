import { assert } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

import { bindMainFramebuffer } from './framebuffer.js';

class Framebuffer {
  constructor(width, height) {
    let gl = state.gl;
    let id = gl.createFramebuffer();
    let tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, id);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let ret = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (ret !== gl.FRAMEBUFFER_COMPLETE) {
      assert(false, 'ERROR: checkFramebufferStatus ' + ret);
      return null;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.bind = function () {
      assert(id);
      let g = state.gl;
      g.viewport(0, 0, width, height);
      g.bindFramebuffer(g.FRAMEBUFFER, id);
    };
    this.unbind = function () {
      assert(id);
      bindMainFramebuffer();
    };
    this.getTexture = function () {
      return tex;
    };
  }
}

export { Framebuffer };
