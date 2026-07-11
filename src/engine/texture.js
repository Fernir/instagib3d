import { Console, assert } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function uploadPlaceholder(gl, id, rgba) {
  gl.bindTexture(gl.TEXTURE_2D, id);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    rgba || new Uint8Array([200, 200, 200, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function readImagePixels(source, flipY) {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  if (flipY) {
    ctx.translate(0, h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: new Uint8Array(img.data) };
}

function uploadImageSource(gl, id, source, flipY, filter, wrap, useMipmaps) {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return false;

  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  let tw = w;
  let th = h;
  if (tw > maxSize || th > maxSize) {
    const scale = maxSize / Math.max(tw, th);
    tw = Math.max(1, Math.floor(tw * scale));
    th = Math.max(1, Math.floor(th * scale));
  }

  gl.bindTexture(gl.TEXTURE_2D, id);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  let pixels = null;
  if (tw === w && th === h) {
    pixels = readImagePixels(source, flipY);
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (flipY) {
      ctx.translate(0, th);
      ctx.scale(1, -1);
    }
    ctx.drawImage(source, 0, 0, tw, th);
    const img = ctx.getImageData(0, 0, tw, th);
    pixels = { width: tw, height: th, data: new Uint8Array(img.data) };
  }

  if (!pixels) return false;

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    pixels.width,
    pixels.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels.data,
  );

  const pot = isPowerOfTwo(pixels.width) && isPowerOfTwo(pixels.height);
  let wrapS = wrap;
  let wrapT = wrap;
  if (!pot && (wrap === gl.REPEAT || wrap === gl.MIRRORED_REPEAT)) {
    wrapS = gl.CLAMP_TO_EDGE;
    wrapT = gl.CLAMP_TO_EDGE;
  }

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);

  if (useMipmaps && pot && filter === gl.LINEAR) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  return gl.getError() === gl.NO_ERROR;
}

async function decodeImage(image) {
  if (typeof image.decode === 'function') {
    try {
      await image.decode();
    } catch (_e) {
      /* progressive JPEG may fail decode(); pixel read still works */
    }
  }
}

async function loadImageSource(url) {
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (res.ok) {
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob, {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        });
        return bitmap;
      }
    } catch (_e) {
      /* fall through to Image() */
    }
  }

  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = async function () {
      await decodeImage(image);
      resolve(image);
    };
    image.onerror = function () {
      reject(new Error("while loading image '" + url + "'."));
    };
    image.src = url;
  });
}

class Texture {
  constructor(img, param, callback) {
    let gl = state.gl;
    let id = gl.createTexture();
    uploadPlaceholder(gl, id);

    let filter = gl.LINEAR;
    let wrap = gl.REPEAT;
    let flipY = true;
    let useMipmaps = false;
    if (param) {
      if (param.filter) filter = param.filter;
      if (param.wrap) wrap = param.wrap;
      if (param.flipY === false) flipY = false;
      if (param.mipmap === true) useMipmaps = true;
    }

    let loaded = false;
    let failed = false;

    const finish = function (ok, label, w, h) {
      loaded = true;
      failed = !ok;
      if (ok) {
        Console.info('Loaded texture: ' + label + ' [' + w + ', ' + h + ']');
      } else {
        Console.info('Texture fallback (load failed): ' + label);
      }
      if (callback) callback();
    };

    const uploadLoaded = function (source, label) {
      const gl2 = state.gl;
      const ok = uploadImageSource(gl2, id, source, flipY, filter, wrap, useMipmaps);
      finish(ok, label, source.width, source.height);
      if (source.close) source.close();
    };

    if (typeof img === 'string') {
      loadImageSource(img)
        .then(function (source) {
          uploadLoaded(source, img);
        })
        .catch(function () {
          finish(false, img, 1, 1);
        });
    } else {
      assert(img instanceof Uint8Array);
      assert(param.size !== undefined);
      const size = param.size;
      gl.bindTexture(gl.TEXTURE_2D, id);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        size,
        size,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        img,
        0,
      );
      const pot = isPowerOfTwo(size);
      let wrapS = wrap;
      let wrapT = wrap;
      if (!pot && (wrap === gl.REPEAT || wrap === gl.MIRRORED_REPEAT)) {
        wrapS = gl.CLAMP_TO_EDGE;
        wrapT = gl.CLAMP_TO_EDGE;
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
      if (useMipmaps && pot && filter === gl.LINEAR) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
      loaded = true;
    }

    this.ready = function () {
      return loaded;
    };
    this.failed = function () {
      return failed;
    };
    this.getId = function () {
      return id;
    };
  }
}

export { Texture };
