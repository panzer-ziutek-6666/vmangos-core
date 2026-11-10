import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { searchTemplates } from '../server/queries/db/search.js';

// Read-only against the real world database: every query searchTemplates
// issues is a SELECT or a COUNT(*).
const here = dirname(fileURLToPath(import.meta.url));

async function connectOrSkip(t) {
  let config;
  try {
    config = readConfigFile(join(here, '..', 'config.json'));
  } catch (err) {
    t.skip(`no usable config.json: ${err.message}`);
    return null;
  }
  const pools = createPools(config.mysql);
  try {
    await pools.logon.query('SELECT 1');
  } catch (err) {
    await pools.closeAll().catch(() => {});
    t.skip(`MySQL is not reachable: ${err.message}. Start it with ""Start MySQL.bat"" in the server directory`);
    return null;
  }
  // Registered first, and node --test runs t.after hooks in registration
  // order, so nothing below can query a closed pool.
  t.after(() => pools.closeAll());
  return { config, pools };
}

test('a name search against the live database finds a real creature', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;

  // Read a real name out of creature_template rather than hardcoding one:
  // the world DB comes from a released dump and its contents can change.
  const [[sample]] = await pools.world.query(
    `SELECT name FROM \`${schema}\`.creature_template WHERE name IS NOT NULL AND name <> '' LIMIT 1`
  );
  assert.ok(sample, 'expected at least one creature_template row with a name');

  // Search on a short substring of the name (rather than the full name) so
  // the LIKE actually exercises substring matching, not just an exact match.
  const term = sample.name.slice(0, Math.max(3, Math.min(sample.name.length, 6)));

  const result = await searchTemplates(pools.world, {
    schema, query: term, wowPatch: config.realm.wowPatch, limit: 50
  });

  const creatureGroup = result.groups.find((g) => g.kind === 'creature');
  assert.ok(creatureGroup, 'expected a creature group in the results');
  assert.ok(creatureGroup.total > 0, 'expected the creature group to have a positive total');
});

test('an entry with patch variants appears exactly once in the results', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;

  // Pick a real quest entry with more than one patch row rather than
  // hardcoding one, mirroring test/db-progressive-live.test.js.
  const [[variant]] = await pools.world.query(
    `SELECT entry, Title AS title FROM \`${schema}\`.quest_template
     WHERE entry IN (
       SELECT entry FROM \`${schema}\`.quest_template GROUP BY entry HAVING COUNT(*) > 1
     )
     LIMIT 1`
  );
  assert.ok(variant, 'expected at least one quest entry with patch variants');

  // The id path: searching the entry number directly should surface exactly
  // one row for it in the quest group, not one row per patch variant.
  const idResult = await searchTemplates(pools.world, {
    schema, query: String(variant.entry), wowPatch: config.realm.wowPatch, limit: 50
  });
  assert.equal(idResult.numeric, true);
  const questGroupById = idResult.groups.find((g) => g.kind === 'quest');
  assert.ok(questGroupById, 'expected a quest group in the id-search results');
  const matchesById = questGroupById.rows.filter((r) => r.id === variant.entry);
  assert.equal(matchesById.length, 1, 'a patch-variant entry must appear exactly once when searched by id');

  // The text path: searching its title should also collapse the variants
  // into a single row, via highestPatchClause rather than one row per patch.
  if (variant.title && variant.title.trim() !== '') {
    const textResult = await searchTemplates(pools.world, {
      schema, query: variant.title, wowPatch: config.realm.wowPatch, limit: 50
    });
    const questGroupByTitle = textResult.groups.find((g) => g.kind === 'quest');
    assert.ok(questGroupByTitle, 'expected a quest group in the title-search results');
    const matchesByTitle = questGroupByTitle.rows.filter((r) => r.id === variant.entry);
    assert.equal(matchesByTitle.length, 1, 'a patch-variant entry must appear exactly once when searched by title');
  }
});
