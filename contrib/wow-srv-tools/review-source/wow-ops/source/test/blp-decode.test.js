import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBlp, UnsupportedBlpError } from '../tools/blp/decode.js';

const HEADER_SIZE = 148;
const PALETTE_SIZE = 256 * 4;
const DATA_AT = HEADER_SIZE + PALETTE_SIZE;

// Builds a BLP2 whose single mip level is `body`. Palette entries are BGRA, so
// the test writes them in that order and expects RGBA back.
function blp({ encoding, alphaDepth = 0, alphaEncoding = 0, width, height, body, palette = [] }) {
  const header = Buffer.alloc(HEADER_SIZE + PALETTE_SIZE);
  header.write('BLP2', 0, 'latin1');
  header.writeUInt32LE(1, 4);
  header[8] = encoding;
  header[9] = alphaDepth;
  header[10] = alphaEncoding;
  header[11] = 0;
  header.writeUInt32LE(width, 12);
  header.writeUInt32LE(height, 16);
  header.writeUInt32LE(DATA_AT, 20);
  header.writeUInt32LE(body.length, 84);
  palette.forEach(([b, g, r], index) => {
    header[HEADER_SIZE + index * 4] = b;
    header[HEADER_SIZE + index * 4 + 1] = g;
    header[HEADER_SIZE + index * 4 + 2] = r;
  });
  return Buffer.concat([header, body]);
}

// One DXT block: two 5-6-5 endpoints and sixteen 2-bit selectors.
function dxtColorBlock(c0, c1, selectors) {
  const block = Buffer.alloc(8);
  block.writeUInt16LE(c0, 0);
  block.writeUInt16LE(c1, 2);
  block.writeUInt32LE(selectors, 4);
  return block;
}

const RED_565 = 0xF800;
const BLUE_565 = 0x001F;
const GREEN_565 = 0x07E0;

// Packs up to 16 DXT5 alpha codes the same low-bit-first way the decoder
// reads them, so a fixture can pin an arbitrary code - including one that
// straddles a byte boundary - without hand-computing the raw bytes.
function packDxt5AlphaCodes(codes) {
  const bytes = Buffer.alloc(6);
  for (let pixel = 0; pixel < 16; pixel++) {
    const code = codes[pixel] ?? 0;
    const bit = 3 * pixel;
    const byteIndex = bit >> 3;
    const shift = bit & 7;
    bytes[byteIndex] |= (code << shift) & 0xFF;
    if (shift > 5) bytes[byteIndex + 1] |= (code >> (8 - shift)) & 0xFF;
  }
  return bytes;
}

test('a palettized image decodes to RGBA in palette order', () => {
  const image = blp({
    encoding: 1,
    width: 2,
    height: 2,
    body: Buffer.from([0, 1, 2, 3]),
    palette: [[0, 0, 255], [0, 255, 0], [255, 0, 0], [255, 255, 255]]
  });
  const { width, height, rgba } = decodeBlp(image);
  assert.equal(width, 2);
  assert.equal(height, 2);
  assert.deepEqual([...rgba.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...rgba.subarray(4, 8)], [0, 255, 0, 255]);
  assert.deepEqual([...rgba.subarray(8, 12)], [0, 0, 255, 255]);
  assert.deepEqual([...rgba.subarray(12, 16)], [255, 255, 255, 255]);
});

test('palettized eight-bit alpha follows the index plane', () => {
  const image = blp({
    encoding: 1,
    alphaDepth: 8,
    width: 2,
    height: 2,
    body: Buffer.from([0, 0, 0, 0, 0, 64, 128, 255]),
    palette: [[255, 255, 255]]
  });
  const { rgba } = decodeBlp(image);
  assert.deepEqual([rgba[3], rgba[7], rgba[11], rgba[15]], [0, 64, 128, 255]);
});

test('palettized one-bit alpha unpacks least-significant bit first', () => {
  const image = blp({
    encoding: 1,
    alphaDepth: 1,
    width: 2,
    height: 2,
    body: Buffer.from([0, 0, 0, 0, 0b1010]),
    palette: [[255, 255, 255]]
  });
  const { rgba } = decodeBlp(image);
  assert.deepEqual([rgba[3], rgba[7], rgba[11], rgba[15]], [0, 255, 0, 255]);
});

test('a DXT1 block interpolates between its two endpoints', () => {
  // c0 > c1, so the block is opaque and indices 2 and 3 are the two thirds.
  const image = blp({
    encoding: 2,
    alphaDepth: 0,
    width: 4,
    height: 4,
    body: dxtColorBlock(RED_565, BLUE_565, 0b11100100)
  });
  const { width, height, rgba } = decodeBlp(image);
  assert.equal(width, 4);
  assert.equal(height, 4);
  // Pixels 0..3 of the first row select indices 0, 1, 2, 3. Indices 2 and 3
  // are the two-thirds/one-third interpolations, pinned exactly so a wrong
  // weighting or a truncated-instead-of-rounded division cannot pass by
  // merely landing "between" the two endpoints.
  assert.deepEqual([...rgba.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...rgba.subarray(4, 8)], [0, 0, 255, 255]);
  assert.deepEqual([...rgba.subarray(8, 12)], [170, 0, 85, 255]);
  assert.deepEqual([...rgba.subarray(12, 16)], [85, 0, 170, 255]);
});

test('a DXT1 block expands the green channel to full 6-bit precision', () => {
  // Red and blue's 5-bit fields are covered elsewhere; green is the 6-bit
  // field and the one most likely to be expanded with the wrong shift.
  const image = blp({
    encoding: 2,
    alphaDepth: 0,
    width: 4,
    height: 4,
    body: dxtColorBlock(GREEN_565, RED_565, 0)
  });
  const { rgba } = decodeBlp(image);
  assert.deepEqual([...rgba.subarray(0, 4)], [0, 255, 0, 255]);
});

test('a DXT1 block with c0 <= c1 makes index 3 transparent', () => {
  const image = blp({
    encoding: 2,
    alphaDepth: 1,
    width: 4,
    height: 4,
    body: dxtColorBlock(BLUE_565, RED_565, 0b11100100)
  });
  const { rgba } = decodeBlp(image);
  assert.equal(rgba[3], 255, 'index 0 is opaque');
  assert.equal(rgba[15], 0, 'index 3 is the punch-through colour');
});

test('DXT3 reads four-bit alpha from the block prefix', () => {
  const alpha = Buffer.alloc(8);
  alpha[0] = 0xF0; // pixel 0 -> 0x0, pixel 1 -> 0xF
  const image = blp({
    encoding: 2,
    alphaDepth: 8,
    alphaEncoding: 1,
    width: 4,
    height: 4,
    body: Buffer.concat([alpha, dxtColorBlock(RED_565, BLUE_565, 0)])
  });
  const { rgba } = decodeBlp(image);
  assert.equal(rgba[3], 0);
  assert.equal(rgba[7], 255);
});

test('DXT3 does not apply DXT1 punch-through when c0 <= c1', () => {
  // Same endpoint order and selectors as the DXT1 punch-through test, but
  // this is a DXT3 block: index 3 must still be the interpolated colour,
  // with its alpha coming from the alpha block, not the [0, 0, 0, 0] that
  // DXT1 gives index 3 when c0 <= c1.
  const alpha = Buffer.alloc(8);
  alpha[1] = 0xA0; // pixel 3's nibble (high nibble, pixel 3 is odd) -> 10 * 17 = 170
  const image = blp({
    encoding: 2,
    alphaDepth: 8,
    alphaEncoding: 1,
    width: 4,
    height: 4,
    body: Buffer.concat([alpha, dxtColorBlock(BLUE_565, RED_565, 0b11100100)])
  });
  const { rgba } = decodeBlp(image);
  // c0 = blue (0,0,255), c1 = red (255,0,0); index 3 is (r0+2r1)/3, (g0+2g1)/3, (b0+2b1)/3.
  assert.deepEqual([...rgba.subarray(12, 16)], [170, 0, 85, 170]);
});

test('DXT5 reads its alpha endpoints', () => {
  const alpha = Buffer.alloc(8);
  alpha[0] = 200; // a0
  alpha[1] = 10;  // a1
  alpha[2] = 0b00001000; // pixel 0 -> code 0, pixel 1 -> code 1
  const image = blp({
    encoding: 2,
    alphaDepth: 8,
    alphaEncoding: 7,
    width: 4,
    height: 4,
    body: Buffer.concat([alpha, dxtColorBlock(RED_565, BLUE_565, 0)])
  });
  const { rgba } = decodeBlp(image);
  assert.equal(rgba[3], 200);
  assert.equal(rgba[7], 10);
});

test('DXT5 eight-code table interpolates a mid code and a byte-straddling code', () => {
  // a0 > a1 selects the eight-code table. Pixel 0 pins a plain interior code;
  // pixel 5 sits at bit 15 (shift 7), so its 3-bit code spans two bytes -
  // deleting the decoder's cross-byte OR term would silently zero it out.
  const alpha = Buffer.concat([
    Buffer.from([200, 10]), // a0, a1
    packDxt5AlphaCodes({ 0: 2, 5: 6 })
  ]);
  const image = blp({
    encoding: 2,
    alphaDepth: 8,
    alphaEncoding: 7,
    width: 4,
    height: 4,
    body: Buffer.concat([alpha, dxtColorBlock(RED_565, BLUE_565, 0)])
  });
  const { rgba } = decodeBlp(image);
  assert.equal(rgba[3], 173, 'pixel 0, code 2: (6*200 + 1*10) / 7');
  assert.equal(rgba[23], 64, 'pixel 5, code 6, straddling bytes 3 and 4: (2*200 + 5*10) / 7');
});

test('DXT5 six-code table treats codes 6 and 7 as the fixed 0 and 255', () => {
  // a0 <= a1 selects the six-code table, where codes 6 and 7 are not
  // interpolated at all - they are the fixed transparent/opaque endpoints.
  const alpha = Buffer.concat([
    Buffer.from([10, 200]), // a0, a1
    packDxt5AlphaCodes({ 0: 6, 1: 7, 2: 2 })
  ]);
  const image = blp({
    encoding: 2,
    alphaDepth: 8,
    alphaEncoding: 7,
    width: 4,
    height: 4,
    body: Buffer.concat([alpha, dxtColorBlock(RED_565, BLUE_565, 0)])
  });
  const { rgba } = decodeBlp(image);
  assert.equal(rgba[3], 0, 'code 6 is the fixed transparent value in the six-code table');
  assert.equal(rgba[7], 255, 'code 7 is the fixed opaque value in the six-code table');
  assert.equal(rgba[11], 48, 'code 2: (4*10 + 1*200) / 5');
});

test('an unknown encoding is refused with a reason, not a crash', () => {
  const image = blp({ encoding: 9, width: 4, height: 4, body: Buffer.alloc(8) });
  assert.throws(() => decodeBlp(image), (err) => err instanceof UnsupportedBlpError && err.reason === 'encoding');
});

test('a file that is not a BLP2 is refused', () => {
  assert.throws(() => decodeBlp(Buffer.alloc(200)), /not a BLP2/);
});

test('a truncated DXT payload is refused rather than read past its end', () => {
  const image = blp({ encoding: 2, width: 8, height: 8, body: Buffer.alloc(8) });
  assert.throws(() => decodeBlp(image), (err) => err instanceof UnsupportedBlpError && err.reason === 'truncated');
});
