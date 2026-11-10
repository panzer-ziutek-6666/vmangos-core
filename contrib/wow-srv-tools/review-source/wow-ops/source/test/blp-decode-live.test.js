import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { openArchive } from '../tools/mpq/archive.js';
import { decodeBlp } from '../tools/blp/decode.js';

const here = dirname(fileURLToPath(import.meta.url));

// Needs the real client, like the db-*-live tests need the real realm.
function archiveOrSkip(t, name) {
  let cfg;
  try {
    cfg = readConfigFile(join(here, '..', 'config.json'));
  } catch (err) {
    t.skip(`no usable config.json: ${err.message}`);
    return null;
  }
  if (!cfg.client) {
    t.skip('config.json has no client section');
    return null;
  }
  const path = join(cfg.client.dataDir, name);
  if (!existsSync(path)) {
    t.skip(`${name} not found under the configured client data directory`);
    return null;
  }
  return openArchive(path);
}

test('a real client icon decodes to a square image', (t) => {
  const mpq = archiveOrSkip(t, 'interface.MPQ');
  if (!mpq) return;
  try {
    const { width, height, rgba } = decodeBlp(mpq.readFile('Interface\\Icons\\INV_Misc_QuestionMark.blp'));
    assert.equal(width, height, 'icons are square');
    assert.equal(width, 64);
    assert.equal(rgba.length, width * height * 4);
    assert.ok(rgba.some((byte) => byte !== 0), 'the image is not blank');
    // A question mark on a dark background: both light and dark pixels exist.
    const luma = [];
    for (let i = 0; i < rgba.length; i += 4) luma.push(rgba[i] + rgba[i + 1] + rgba[i + 2]);
    assert.ok(Math.max(...luma) - Math.min(...luma) > 150, 'the icon has real contrast');
    // Pinned from the current known-good decode (alphaDepth 1, so this file's
    // alpha is binary): a DXT arithmetic regression that shifts the alpha
    // codes would change this count even though width/height/blank/contrast
    // above could all still pass.
    let transparent = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) transparent++;
    assert.equal(transparent, 40, 'count of fully transparent pixels in the icon');
  } finally {
    mpq.close();
  }
});

test('a real zone map tile decodes at its full size', (t) => {
  const mpq = archiveOrSkip(t, 'interface.MPQ');
  if (!mpq) return;
  try {
    const { width, height, rgba } = decodeBlp(mpq.readFile('Interface\\WorldMap\\Durotar\\Durotar1.blp'));
    assert.equal(width, 256);
    assert.equal(height, 256);
    assert.equal(rgba.length, 256 * 256 * 4);
    assert.ok(rgba.some((byte) => byte !== 0), 'the image is not blank');
    const luma = [];
    for (let i = 0; i < rgba.length; i += 4) luma.push(rgba[i] + rgba[i + 1] + rgba[i + 2]);
    assert.ok(Math.max(...luma) - Math.min(...luma) > 150, 'the map tile has real contrast');
  } finally {
    mpq.close();
  }
});
