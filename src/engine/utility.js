import { Buffer } from '@/core/buffer.js';
import { Console, assert } from '@/core/polyfill.js';

import { Texture } from './texture.js';

Buffer.loadImage = function (img, callback) {
  let image = new Image();
  image.onload = function () {
    assert(image.width === image.height);
    let size = image.width;

    let R = new Buffer(size);
    let G = new Buffer(size);
    let B = new Buffer(size);

    let cnv = document.createElement('canvas');
    cnv.width = size;
    cnv.height = size;
    let disp = cnv.getContext('2d');

    disp.drawImage(image, 0, 0);
    let data = disp.getImageData(0, 0, size, size).data;

    for (let i = 0; i < size * size; i++) {
      let r = data[4 * i + 0] / 255;
      let g = data[4 * i + 1] / 255;
      let b = data[4 * i + 2] / 255;
      R.setData(i, r);
      G.setData(i, g);
      B.setData(i, b);
    }

    callback(R, G, B);

    Console.info('Loaded image: ' + img + ' [' + image.width + ', ' + image.height + ']');
  };
  image.onerror = function () {
    assert(false, "while loading image '" + img + "'.");
  };
  image.src = img;
};

Buffer.create_texture = function (R, G, B, A, param) {
  assert(R.getSize() === G.getSize());
  assert(R.getSize() === B.getSize());
  assert(R.getSize() === A.getSize());

  let size = R.getSize();
  let data = new Uint8Array(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    let r = R.getData(i);
    let g = G.getData(i);
    let b = B.getData(i);
    let a = A.getData(i);
    data[4 * i + 0] = r * 255;
    data[4 * i + 1] = g * 255;
    data[4 * i + 2] = b * 255;
    data[4 * i + 3] = a * 255;
  }

  let parameters = param || {};
  parameters.size = size;
  return new Texture(data, parameters);
};
