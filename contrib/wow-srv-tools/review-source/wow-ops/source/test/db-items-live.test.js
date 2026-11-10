import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { worldSchema } from '../server/queries/db/sql.js';
import { listItems } from '../server/queries/db/items.js';
import { parseItemFilters } from '../server/queries/db/itemFilters.js';
import { listItemSets, loadItemSet } from '../server/queries/db/itemSets.js';
import { highestPatchClause } from '../server/queries/db/progressive.js';

// Read-only against the real world database: listItems, listItemSets and
// loadItemSet issue nothing but SELECTs.
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

test('the first page of items comes back non-empty and within the page size', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = worldSchema(config);
  const dbcSchema = config.mysql?.dbcSchema ?? null;
  const wowPatch = config.realm?.wowPatch;

  const filters = parseItemFilters({});
  const { rows, total } = await listItems(pools.world, { schema, dbcSchema, filters, wowPatch });

  assert.ok(total > 0, 'expected item_template to hold at least one row for this patch');
  assert.ok(rows.length > 0, 'expected the first page to be non-empty');
  assert.ok(rows.length <= filters.pageSize, 'expected the page to be no larger than the page size');
  for (const row of rows) {
    assert.equal(typeof row.name, 'string');
    assert.ok(Number.isInteger(Number(row.entry)), `expected entry ${row.entry} to be an integer`);
  }
});

test('no entry appears twice on one page, which is what the patch clause is for', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = worldSchema(config);
  const dbcSchema = config.mysql?.dbcSchema ?? null;
  const wowPatch = config.realm?.wowPatch;

  const { rows } = await listItems(pools.world, { schema, dbcSchema, filters: parseItemFilters({}), wowPatch });
  const entries = rows.map((r) => Number(r.entry));
  assert.equal(new Set(entries).size, entries.length, 'expected every entry on the page to be distinct');
});

test('a filtered count is never larger than the unfiltered one', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = worldSchema(config);
  const dbcSchema = config.mysql?.dbcSchema ?? null;
  const wowPatch = config.realm?.wowPatch;

  const all = await listItems(pools.world, { schema, dbcSchema, filters: parseItemFilters({}), wowPatch });
  const epics = await listItems(pools.world, {
    schema, dbcSchema, filters: parseItemFilters({ quality: '4' }), wowPatch
  });
  assert.ok(epics.total <= all.total, 'expected filtering by quality to never add rows');
});

test('a set with members resolves both directions', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = worldSchema(config);
  const dbcSchema = config.mysql?.dbcSchema ?? null;
  const wowPatch = config.realm?.wowPatch;
  if (!dbcSchema) return t.skip('no dbcSchema configured: item sets live only in the reference schema');

  const { rows: sets } = await listItemSets(pools.world, { dbcSchema });
  if (sets.length === 0) return t.skip('the reference schema has no item sets imported');

  // Find the first set that actually has members, rather than assuming
  // sets[0] does - item_set.dbc can list sets whose only members belong to
  // a patch this realm does not carry.
  let loaded = null;
  for (const candidate of sets) {
    const attempt = await loadItemSet(pools.world, { schema, dbcSchema, id: candidate.id, wowPatch });
    if (attempt && attempt.members.length > 0) {
      loaded = { set: candidate, data: attempt };
      break;
    }
  }
  if (!loaded) return t.skip('no imported item set has members on this patch');

  assert.ok(loaded.data.set, 'expected the loaded set row itself');
  assert.equal(Number(loaded.data.set.id), Number(loaded.set.id));

  // loadItemSet's members carry entry/name/quality/icon, not set_id itself
  // (server/queries/db/itemSets.js fetchMembers), so membership is confirmed
  // from the other direction: item_template.set_id, keyed the same way every
  // other progressive read in this section is, for each member's entry.
  const items = `\`${schema}\`.item_template`;
  const patchClause = highestPatchClause(schema, 'item_template', 't1');
  for (const member of loaded.data.members) {
    const [[row]] = await pools.world.query(
      `SELECT set_id FROM ${items} t1 WHERE t1.entry = ? AND ${patchClause}`,
      [member.entry, wowPatch]
    );
    assert.ok(row, `expected item_template to still carry entry ${member.entry} at patch ${wowPatch}`);
    assert.equal(Number(row.set_id), Number(loaded.set.id),
      `expected member ${member.entry}'s set_id to match set ${loaded.set.id}`);
  }
});
