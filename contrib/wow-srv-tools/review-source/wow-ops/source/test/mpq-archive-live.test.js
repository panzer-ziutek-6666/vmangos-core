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

test('the interface archive opens and reports a sane sector size', (t) => {
  const mpq = archiveOrSkip(t, 'interface.MPQ');
  if (!mpq) return;
  try {
    assert.ok(mpq.sectorSize >= 512 && mpq.sectorSize <= 0x10000, `sector size ${mpq.sectorSize}`);
    assert.ok(mpq.hashTableSize > 0);
    assert.ok(mpq.blockTableSize > 0);
  } finally {
    mpq.close();
  }
});

test('a known icon is present and a nonsense name is not', (t) => {
  const mpq = archiveOrSkip(t, 'interface.MPQ');
  if (!mpq) return;
  try {
    const found = mpq.findFile('Interface\\Icons\\INV_Misc_QuestionMark.blp');
    assert.ok(found, 'the question-mark icon should exist in interface.MPQ');
    assert.ok(found.fileSize > 0);
    assert.equal(mpq.findFile('Interface\\Icons\\NoSuchIconAtAll_zzz.blp'), null);
  } finally {
    mpq.close();
  }
});

test('lookup is case-insensitive', (t) => {
  const mpq = archiveOrSkip(t, 'interface.MPQ');
  if (!mpq) return;
  try {
    const a = mpq.findFile('Interface\\Icons\\INV_Misc_QuestionMark.blp');
    const b = mpq.findFile('interface/icons/inv_misc_questionmark.blp');
    assert.deepEqual(a, b);
  } finally {
    mpq.close();
  }
});
