import { assert } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

let activeProgram = null;
const boundTextures = [];

export class Shader {
  static upgradeToGLSL300(source, stage) {
    if (Shader._hasGLSLVersion(source)) return source;
    let s = Shader._stripLegacyPrecision(source);
    s = s.replace(/\battribute\s+/g, 'in ');
    if (stage === 'vert') {
      s = s.replace(/\bvarying\s+/g, 'out ');
    } else {
      s = s.replace(/\bvarying\s+/g, 'in ');
      if (!/\bout vec4 fragColor\b/.test(s)) {
        s = 'out vec4 fragColor;\n' + s;
      }
      s = s.replace(/\bgl_FragColor\b/g, 'fragColor');
      s = s.replace(/\btexture2D\s*\(/g, 'texture(');
      s = s.replace(/\btextureCube\s*\(/g, 'texture(');
    }
    return '#version 300 es\nprecision highp float;\n' + s;
  }

  static bindProgram(prog) {
    const gl = state.gl;
    if (activeProgram !== prog) {
      gl.useProgram(prog);
      activeProgram = prog;
    }
  }

  static _stripLegacyPrecision(src) {
    return src.replace(/#ifdef GL_ES[\s\S]*?#endif\s*\n?/g, '');
  }

  static _hasGLSLVersion(src) {
    return /^\s*#version\s+/m.test(src);
  }

  constructor(vp, fp, names) {
    function compileShader(prog, type) {
      const gl = state.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, prog);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        assert(false, gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    }

    const gl = state.gl;
    const vertSrc = state.isWebGL2 ? Shader.upgradeToGLSL300(vp, 'vert') : vp;
    const fragSrc = state.isWebGL2 ? Shader.upgradeToGLSL300(fp, 'frag') : fp;
    const frag = compileShader(fragSrc, gl.FRAGMENT_SHADER);
    const vert = compileShader(vertSrc, gl.VERTEX_SHADER);
    if (!frag || !vert) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.bindAttribLocation(prog, 0, 'position');
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      assert(false, 'could not initialise shaders: ' + gl.getProgramInfoLog(prog));
      return null;
    }

    this._prog = prog;
    if (names) {
      const self = this;
      names.forEach(function (name) {
        self[name] = gl.getUniformLocation(prog, name);
      });
    }

    this.use = function () {
      Shader.bindProgram(prog);
    };
    this.matrix = function (name, mat) {
      const loc = typeof name === 'string' ? gl.getUniformLocation(prog, name) : name;
      gl.uniformMatrix4fv(loc, false, mat);
    };
    this.texture = function (name, id, lev) {
      const loc = typeof name === 'string' ? gl.getUniformLocation(prog, name) : name;
      gl.uniform1i(loc, lev);
      if (boundTextures[lev] !== id) {
        gl.activeTexture(gl.TEXTURE0 + lev);
        gl.bindTexture(gl.TEXTURE_2D, id);
        boundTextures[lev] = id;
      }
    };
    this.vector = function (name, vec) {
      const loc = typeof name === 'string' ? gl.getUniformLocation(prog, name) : name;
      gl.uniform4f(loc, vec[0], vec[1], vec[2], vec[3] != null ? vec[3] : 0);
    };
    this.getLocation = function (name) {
      return gl.getUniformLocation(prog, name);
    };
    this.attrib = function (name) {
      return gl.getAttribLocation(prog, name);
    };
    this.program = function () {
      return prog;
    };
  }
}

Shader.vertexShader = function (mat_pos, mat_tex, position) {
  let vert = 'attribute vec4 position;\n';
  if (mat_pos) vert += 'uniform mat4 mat_pos;\n';
  if (mat_tex) vert += 'uniform mat4 mat_tex;\n';
  vert += 'varying vec4 texcoord;\nvoid main()\n{\n';
  if (mat_pos) vert += 'gl_Position = mat_pos * position;\n';
  else vert += 'gl_Position = position;\n';
  if (mat_tex) vert += 'texcoord = mat_tex * position;\n';
  else vert += 'texcoord = position * 0.5 + 0.5;\n';
  if (position !== undefined) vert += 'texcoord.zw = ' + position + '.xy * 0.5 + 0.5;\n';
  vert += '}\n';
  return vert;
};
