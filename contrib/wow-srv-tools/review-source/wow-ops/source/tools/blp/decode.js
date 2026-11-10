// BLP2 as the client ships it: a 148-byte header, a 256-entry BGRA palette,
// and one mip chain that is either 8-bit palette indices or DXT blocks. Only
// mip level 0 is decoded - the browser scales in CSS and has no use for the
// rest of the chain.

export class UnsupportedBlpError extends Error {
  constructor(reason, detail) {
    super(`unsupported BLP: ${reason}${detail === undefined ? '' : ` (${detail})`}`);
    this.name = 'UnsupportedBlpError';
    this.reason = reason;
  }
}

const HEADER_SIZE = 148;
const PALETTE_SIZE = 256 * 4;

export function decodeBlp(buf) {
  if (buf.length < HEADER_SIZE + PALETTE_SIZE || buf.subarray(0, 4).toString('latin1') !== 'BLP2') {
    throw new Error('not a BLP2 image');
  }
  const type = buf.readUInt32LE(4);
  const encoding = buf[8];
  const alphaDepth = buf[9];
  const alphaEncoding = buf[10];
  const width = buf.readUInt32LE(12);
  const height = buf.readUInt32LE(16);
  const mipOffset = buf.readUInt32LE(20);
  const mipSize = buf.readUInt32LE(84);
  if (type !== 1) throw new UnsupportedBlpError('type', type);
  if (width === 0 || height === 0) throw new UnsupportedBlpError('dimensions', `${width}x${height}`);

  const data = buf.subarray(mipOffset, mipOffset + mipSize);
  if (encoding === 1) {
    return { width, height, rgba: decodePalettized(buf, data, width, height, alphaDepth) };
  }
  if (encoding === 2) {
    return { width, height, rgba: decodeDxt(data, width, height, dxtVariant(alphaDepth, alphaEncoding)) };
  }
  throw new UnsupportedBlpError('encoding', encoding);
}

// The file never names its DXT variant; it follows from the alpha fields.
function dxtVariant(alphaDepth, alphaEncoding) {
  if (alphaDepth === 0 || alphaDepth === 1) return 1;
  if (alphaDepth === 4) return 3;
  if (alphaDepth === 8) return alphaEncoding === 7 ? 5 : 3;
  throw new UnsupportedBlpError('alphaDepth', alphaDepth);
}

function decodePalettized(buf, data, width, height, alphaDepth) {
  const palette = buf.subarray(HEADER_SIZE, HEADER_SIZE + PALETTE_SIZE);
  const pixels = width * height;
  const alphaBytes = { 0: 0, 1: Math.ceil(pixels / 8), 4: Math.ceil(pixels / 2), 8: pixels }[alphaDepth];
  if (alphaBytes === undefined) throw new UnsupportedBlpError('alphaDepth', alphaDepth);
  if (data.length < pixels + alphaBytes) {
    throw new UnsupportedBlpError('truncated', `${data.length} of ${pixels + alphaBytes}`);
  }
  const alphaPlane = data.subarray(pixels);
  const rgba = Buffer.allocUnsafe(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const entry = data[i] * 4;
    rgba[i * 4] = palette[entry + 2]; // palette entries are BGRA
    rgba[i * 4 + 1] = palette[entry + 1];
    rgba[i * 4 + 2] = palette[entry];
    rgba[i * 4 + 3] = palettizedAlpha(alphaDepth, alphaPlane, i);
  }
  return rgba;
}

function palettizedAlpha(alphaDepth, plane, index) {
  if (alphaDepth === 0) return 255;
  if (alphaDepth === 8) return plane[index];
  if (alphaDepth === 1) {
    const byte = plane[index >> 3];
    return (byte >> (index & 7)) & 1 ? 255 : 0;
  }
  if (alphaDepth === 4) {
    const byte = plane[index >> 1];
    // 0x0..0xF scaled to 0..255; 17 is 255/15, so 0xF stays fully opaque.
    return ((index & 1) ? byte >> 4 : byte & 0x0F) * 17;
  }
  throw new UnsupportedBlpError('alphaDepth', alphaDepth);
}

// 5-6-5 to 8-8-8, replicating the high bits into the low ones so that a
// saturated channel decodes to 255 rather than 248.
function color565(value) {
  const r = (value >> 11) & 0x1F;
  const g = (value >> 5) & 0x3F;
  const b = value & 0x1F;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function decodeDxt(data, width, height, variant) {
  const blockBytes = variant === 1 ? 8 : 16;
  const blocksAcross = Math.ceil(width / 4);
  const blocksDown = Math.ceil(height / 4);
  const needed = blocksAcross * blocksDown * blockBytes;
  if (data.length < needed) throw new UnsupportedBlpError('truncated', `${data.length} of ${needed}`);

  const rgba = Buffer.alloc(width * height * 4);
  for (let by = 0; by < blocksDown; by++) {
    for (let bx = 0; bx < blocksAcross; bx++) {
      const block = (by * blocksAcross + bx) * blockBytes;
      const colorAt = variant === 1 ? block : block + 8;
      const c0 = data.readUInt16LE(colorAt);
      const c1 = data.readUInt16LE(colorAt + 2);
      const selectors = data.readUInt32LE(colorAt + 4);
      const [r0, g0, b0] = color565(c0);
      const [r1, g1, b1] = color565(c1);
      // In DXT1 only, c0 <= c1 switches the block to three colours plus a
      // fully transparent slot. DXT3 and DXT5 always use four colours.
      const punchThrough = variant === 1 && c0 <= c1;
      const colours = [
        [r0, g0, b0, 255],
        [r1, g1, b1, 255],
        punchThrough
          ? [(r0 + r1) >> 1, (g0 + g1) >> 1, (b0 + b1) >> 1, 255]
          : [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3), 255],
        punchThrough
          ? [0, 0, 0, 0]
          : [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3), 255]
      ];

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue; // a partial block at the edge
          const pixel = py * 4 + px;
          const colour = colours[(selectors >>> (2 * pixel)) & 3];
          const out = (y * width + x) * 4;
          rgba[out] = colour[0];
          rgba[out + 1] = colour[1];
          rgba[out + 2] = colour[2];
          rgba[out + 3] = variant === 1 ? colour[3] : blockAlpha(data, block, pixel, variant);
        }
      }
    }
  }
  return rgba;
}

function blockAlpha(data, block, pixel, variant) {
  if (variant === 3) {
    const byte = data[block + (pixel >> 1)];
    return ((pixel & 1) ? byte >> 4 : byte & 0x0F) * 17;
  }
  // DXT5: two endpoints, then sixteen 3-bit codes packed low bit first across
  // six bytes, so a code can straddle a byte boundary.
  const a0 = data[block];
  const a1 = data[block + 1];
  const bit = 3 * pixel;
  const at = block + 2 + (bit >> 3);
  const shift = bit & 7;
  const code = ((data[at] >> shift) | ((data[at + 1] ?? 0) << (8 - shift))) & 7;
  if (code === 0) return a0;
  if (code === 1) return a1;
  if (a0 > a1) return Math.round(((8 - code) * a0 + (code - 1) * a1) / 7);
  if (code === 6) return 0;
  if (code === 7) return 255;
  return Math.round(((6 - code) * a0 + (code - 1) * a1) / 5);
}
