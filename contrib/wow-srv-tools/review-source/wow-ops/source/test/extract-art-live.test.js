import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readConfigFile } from '../server/config.js';
import { extractArt } from '../tools/extract-art.js';

const here = dirname(fileURLToPath(import.meta.url));

// Needs the real client, like the db-*-live tests need the real realm.
function configOrSkip(t) {
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
  return cfg;
}

test('a limited extraction writes real PNGs and reports its misses', async (t) => {
  const cfg = configOrSkip(t);
  if (!cfg?.client) return;
  const root = mkdtempSync(join(tmpdir(), 'wow-ops-art-'));
  try {
    const report = await extractArt({ client: cfg.client, assets: { root }, limit: 25, log: () => {} });
    assert.ok(report.icons.written > 0, 'some icons were written');
    assert.equal(report.icons.written + report.icons.missing + report.icons.failed, 25);
    // The per-group counts must add up to the headline, or the number a later
    // run regresses against is measuring something other than it claims.
    for (const outcome of ['written', 'missing', 'failed']) {
      const { spell, item } = report.icons.byGroup;
      assert.equal(spell[outcome] + item[outcome], report.icons[outcome], outcome);
    }
    // Spell icons are ordered first, so a 25-target run is all spell icons -
    // the group that is supposed to resolve. All 25 resolving is the point:
    // this is the small signal a broken name list or dead archive
    // precedence would move, where the combined figure would not budge.
    assert.equal(
      report.icons.byGroup.spell.written,
      25,
      'every spell icon in the first 25 resolves - a failure here points at the client install or the DBC name list, not at the extractor'
    );
    const files = readdirSync(join(root, 'icons'));
    assert.equal(files.length, report.icons.written);
    const png = readFileSync(join(root, 'icons', files[0]));
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4E, 0x47], 'output is a PNG');
    assert.ok(files.every((f) => f === f.toLowerCase()), 'names are lowercased so the web layer can look them up predictably');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every failure is reported with a reason rather than thrown', async (t) => {
  const cfg = configOrSkip(t);
  if (!cfg?.client) return;
  const root = mkdtempSync(join(tmpdir(), 'wow-ops-art-'));
  try {
    const report = await extractArt({ client: cfg.client, assets: { root }, limit: 25, log: () => {} });
    for (const failure of report.failures) {
      assert.equal(typeof failure.name, 'string');
      assert.ok(failure.reason.length > 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
