import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, crc32 } from 'node:zlib';
import { encodePng } from '../tools/png/encode.js';

const IMAGE = { width: 2, height: 2, rgba: Buffer.from([
  255, 0, 0, 255,   0, 255, 0, 255,
  0, 0, 255, 128,   255, 255, 255, 0
]) };

test('the signature and IHDR describe an 8-bit RGBA image', () => {
  const png = encodePng(IMAGE);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 2);
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 6, 'colour type RGBA');
});

test('the pixel data survives a round trip', () => {
  const png = encodePng(IMAGE);
  const start = png.indexOf(Buffer.from('IDAT', 'latin1'));
  const length = png.readUInt32BE(start - 4);
  const raw = inflateSync(png.subarray(start + 4, start + 4 + length));
  // Two scanlines, each a zero filter byte followed by eight bytes of pixels.
  assert.equal(raw.length, 2 * (1 + 2 * 4));
  assert.equal(raw[0], 0);
  assert.deepEqual([...raw.subarray(1, 9)], [255, 0, 0, 255, 0, 255, 0, 255]);
  assert.equal(raw[9], 0);
  assert.deepEqual([...raw.subarray(10, 18)], [0, 0, 255, 128, 255, 255, 255, 0]);
});

test('the file ends with IEND', () => {
  const png = encodePng(IMAGE);
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('latin1'), 'IEND');
});

test('a mismatched buffer length is refused', () => {
  assert.throws(() => encodePng({ width: 2, height: 2, rgba: Buffer.alloc(4) }), /expected 16 bytes/);
});

test('a chunk carries a CRC over its type and data', () => {
  const png = encodePng(IMAGE);
  const type = png.subarray(12, 16);
  const data = png.subarray(16, 29);
  assert.equal(png.readUInt32BE(29), crc32(Buffer.concat([type, data])));
});
