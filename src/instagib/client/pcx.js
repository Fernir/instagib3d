const PCX_HEADER_SIZE = 128;
const PCX_PALETTE_SIZE = 769;

function decodePcx(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < PCX_HEADER_SIZE + PCX_PALETTE_SIZE) {
    throw new Error('PCX file is too small');
  }

  const view = new DataView(buffer);
  const manufacturer = bytes[0];
  if (manufacturer !== 0x0a) {
    throw new Error('Not a PCX file');
  }

  const bitsPerPixel = bytes[3];
  const xMin = view.getUint16(4, true);
  const yMin = view.getUint16(6, true);
  const xMax = view.getUint16(8, true);
  const yMax = view.getUint16(10, true);
  const nPlanes = bytes[65];
  const bytesPerLine = view.getUint16(66, true);

  if (bitsPerPixel !== 8 || nPlanes !== 1) {
    throw new Error(`Unsupported PCX layout (${bitsPerPixel}bpp x ${nPlanes} planes)`);
  }

  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;

  const paletteOffset = bytes.length - PCX_PALETTE_SIZE;
  if (bytes[paletteOffset] !== 0x0c) {
    throw new Error('PCX 256-color palette marker missing');
  }
  const palette = bytes.subarray(paletteOffset + 1, paletteOffset + PCX_PALETTE_SIZE);

  const dataEnd = paletteOffset;
  const indices = new Uint8Array(bytesPerLine * height);
  let outPos = 0;
  let inPos = PCX_HEADER_SIZE;

  while (outPos < indices.length && inPos < dataEnd) {
    const byte = bytes[inPos++];
    if ((byte & 0xc0) === 0xc0) {
      const count = byte & 0x3f;
      const value = bytes[inPos++];
      const end = Math.min(outPos + count, indices.length);
      indices.fill(value, outPos, end);
      outPos = end;
    } else {
      indices[outPos++] = byte;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * bytesPerLine;
    const dstOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const idx = indices[rowOffset + x] * 3;
      const out = dstOffset + x * 4;
      rgba[out] = palette[idx];
      rgba[out + 1] = palette[idx + 1];
      rgba[out + 2] = palette[idx + 2];
      rgba[out + 3] = 255;
    }
  }

  return { width, height, rgba };
}

export { decodePcx };
