import { Console, assert } from '@/core/polyfill.js';
import { state } from '@/core/runtime-state.js';

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function candidateUrls(url) {
  const urls = [url];
  if (/\.jpe?g$/i.test(url)) urls.unshift(url.replace(/\.jpe?g$/i, '.png'));
  else if (/\.png$/i.test(url)) urls.push(url.replace(/\.png$/i, '.jpg'));
  return [...new Set(urls)];
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

function applyTexParams(gl, w, h, filter, wrap, useMipmaps) {
  const pot = isPowerOfTwo(w) && isPowerOfTwo(h);
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
    if (gl.getError() === gl.NO_ERROR) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
  }
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

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  if (flipY) {
    ctx.translate(0, th);
    ctx.scale(1, -1);
  }
  ctx.drawImage(source, 0, 0, tw, th);

  gl.bindTexture(gl.TEXTURE_2D, id);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  if (gl.getError() !== gl.NO_ERROR) return false;

  applyTexParams(gl, tw, th, filter, wrap, useMipmaps);
  return true;
}

async function decodeImage(image) {
  if (typeof image.decode === 'function') {
    try {
      await image.decode();
    } catch (_e) {
      /* ignore */
    }
  }
}

async function loadImageSourceOnce(url) {
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    const res = await fetch(url, { cache: 'force-cache' });
    if (res.ok) {
      const blob = await res.blob();
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(blob);
      } catch (_e1) {
        try {
          bitmap = await createImageBitmap(blob, {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          });
        } catch (_e2) {
          bitmap = null;
        }
      }
      if (bitmap && bitmap.width > 0 && bitmap.height > 0) return bitmap;
    }
  }

  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = async function () {
      await decodeImage(image);
      if (image.width > 0 && image.height > 0) resolve(image);
      else reject(new Error("empty image '" + url + "'"));
    };
    image.onerror = function () {
      reject(new Error("while loading image '" + url + "'."));
    };
    image.src = url;
  });
}

async function loadImageSource(url) {
  const urls = candidateUrls(url);
  let lastErr = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      return await loadImageSourceOnce(urls[i]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("while loading image '" + url + "'.");
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
      if (param.mipmap === true || param.tile === true) useMipmaps = true;
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
    } else if (img && typeof img === 'object' && typeof img.getContext === 'function') {
      const gl2 = state.gl;
      const ok = uploadImageSource(gl2, id, img, flipY, filter, wrap, useMipmaps);
      finish(ok, 'canvas', img.width, img.height);
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
      applyTexParams(gl, size, size, filter, wrap, useMipmaps);
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

export { Texture, candidateUrls, loadImageSource };
