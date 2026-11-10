import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { readDbc } from '../tools/dbc/reader.js';
import { assertLayout } from '../tools/dbc/layout.js';
import { LAYOUTS } from '../tools/dbc/layouts/index.js';

const here = dirname(fileURLToPath(import.meta.url));

// Needs the real client DBC files, like test/dbc-reader-live.test.js.
function dbcDirOrSkip(t) {
  let cfg;
  try {
    cfg = readConfigFile(join(here, '..', 'config.json'));
  } catch (err) {
    t.skip(`no usable config.json: ${err.message}`);
    return null;
  }
  if (!cfg.client?.dbcDir || !existsSync(cfg.client.dbcDir)) {
    t.skip('no client.dbcDir, or it does not exist');
    return null;
  }
  return cfg.client.dbcDir;
}

// The layouts are the one thing in this cycle that cannot be proven by a
// synthetic file: they are claims about the client's real records.
test('every layout matches the field count of its file', (t) => {
  const dbcDir = dbcDirOrSkip(t);
  if (!dbcDir) return;
  // Guards against a merge that silently drops an entry from layouts/index.js:
  // the loop below would still pass on whatever layouts survived.
  assert.equal(LAYOUTS.length, 26);
  for (const layout of LAYOUTS) {
    const path = join(dbcDir, layout.file);
    assert.ok(existsSync(path), `${layout.file} is not in the configured DBC directory`);
    assertLayout(layout, readDbc(path));
  }
});
