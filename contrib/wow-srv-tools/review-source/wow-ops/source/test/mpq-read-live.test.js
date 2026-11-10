import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { openArchive } from '../tools/mpq/archive.js';

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

test('a known icon reads back as a BLP2 image', (t) => {
  const mpq = archiveOrSkip(t, 'interface.MPQ');
  if (!mpq) return;
  try {
    const data = mpq.readFile('Interface\\Icons\\INV_Misc_QuestionMark.blp');
    assert.equal(data.subarray(0, 4).toString('latin1'), 'BLP2');
    assert.equal(data.length, mpq.findFile('Interface\\Icons\\INV_Misc_QuestionMark.blp').fileSize);
  } finally {
    mpq.close();
  }
});

test('reading a missing file throws rather than returning empty', (t) => {
  const mpq = archiveOrSkip(t, 'interface.MPQ');
  if (!mpq) return;
  try {
    assert.throws(() => mpq.readFile('Interface\\Icons\\NoSuchIconAtAll_zzz.blp'), /not found/);
  } finally {
    mpq.close();
  }
});
