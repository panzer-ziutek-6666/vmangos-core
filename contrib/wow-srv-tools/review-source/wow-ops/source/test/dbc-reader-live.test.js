import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { readDbc } from '../tools/dbc/reader.js';
import { spellIconPaths, itemIconCandidates, worldMapDirectories } from '../tools/dbc/artNames.js';

const here = dirname(fileURLToPath(import.meta.url));

// Needs the real client DBC files, like the db-*-live tests need the real realm.
function dbcDirOrSkip(t) {
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
  const path = cfg.client.dbcDir;
  if (!path) {
    t.skip('config.json has no client.dbcDir');
    return null;
  }
  if (!existsSync(path)) {
    t.skip(`DBC directory not found at configured location`);
    return null;
  }
  return path;
}

test('SpellIcon.dbc yields icon paths under Interface\\Icons', (t) => {
  const dbcDir = dbcDirOrSkip(t);
  if (!dbcDir) return;
  const paths = spellIconPaths(dbcDir);
  assert.ok(paths.length > 900, `only ${paths.length} spell icons`);
  assert.ok(paths.every((p) => p.toLowerCase().startsWith('interface\\icons\\')), 'every path is an icon path');
  assert.ok(paths.every((p) => p.toLowerCase().endsWith('.blp')));
  assert.equal(new Set(paths).size, paths.length, 'paths are deduplicated');
  // The count alone cannot distinguish normalization from filtering: one DBC record points
  // to a nonexistent directory, but its basename was already produced by another record.
  assert.ok(paths.includes('Interface\\Icons\\Spell_Fire_Fire.blp'), 'the stale Spells\\Icon path was normalized, not filtered');
  assert.ok(paths.every((p) => {
    const suffix = p.slice('Interface\\Icons\\'.length);
    return !suffix.includes('\\') && !suffix.includes('/');
  }), 'each path has exactly one directory level after the icon directory');
});

test('ItemDisplayInfo.dbc yields plausible icon candidates', (t) => {
  const dbcDir = dbcDirOrSkip(t);
  if (!dbcDir) return;
  const names = itemIconCandidates(dbcDir);
  assert.ok(names.length > 500, `only ${names.length} candidates`);
  assert.ok(names.some((n) => /^INV_/i.test(n)), 'inventory icons are among the candidates');
});

test('the icon candidate filter excludes model and texture paths', (t) => {
  const dbcDir = dbcDirOrSkip(t);
  if (!dbcDir) return;
  const names = itemIconCandidates(dbcDir);
  assert.ok(names.includes('INV_Robe_02'), 'a known inventory icon is included');
  assert.ok(!names.some((n) => n.includes('.')), 'no candidate contains a dot (rules out .mdx, .blp filenames)');
  assert.ok(!names.some((n) => n.includes(' ')), 'no candidate contains a space (rules out paths with spaces)');
});

test('WorldMapArea.dbc yields map directory names', (t) => {
  const dbcDir = dbcDirOrSkip(t);
  if (!dbcDir) return;
  const dirs = worldMapDirectories(dbcDir);
  assert.ok(dirs.length > 20, `only ${dirs.length} map directories`);
  assert.ok(dirs.includes('Durotar') || dirs.includes('Elwynn'), `unexpected names: ${dirs.slice(0, 5)}`);
});

test('the reader rejects a file that is not a DBC', (t) => {
  const dbcDir = dbcDirOrSkip(t);
  if (!dbcDir) return;
  assert.throws(() => readDbc(join(dbcDir, '..', 'nonexistent.dbc')), /ENOENT|not a DBC/);
});
