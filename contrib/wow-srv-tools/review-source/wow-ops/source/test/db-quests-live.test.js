import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { worldSchema } from '../server/queries/db/sql.js';
import { listQuests, listQuestCategories } from '../server/queries/db/quests.js';
import { parseQuestFilters } from '../server/queries/db/questFilters.js';

// Read-only against the real world database: listQuests and
// listQuestCategories issue nothing but SELECTs. The realm is running while
// these execute, so they assert shapes and invariants, never values.
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
  t.after(() => pools.closeAll());
  return {
    pools,
    args: { schema: worldSchema(config), dbcSchema: config.mysql?.dbcSchema ?? null, wowPatch: config.realm?.wowPatch }
  };
}

test('the first page of quests is non-empty and within the page size', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const filters = parseQuestFilters({});
  const { rows, total } = await listQuests(ctx.pools.world, { ...ctx.args, filters });
  assert.ok(total > 0);
  assert.ok(rows.length > 0 && rows.length <= filters.pageSize);
});

test('no quest repeats on a page, which is what the patch clause is for', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const { rows } = await listQuests(ctx.pools.world, { ...ctx.args, filters: parseQuestFilters({}) });
  const entries = rows.map((r) => Number(r.entry));
  assert.equal(new Set(entries).size, entries.length);
});

test('a filter never raises the count', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const all = await listQuests(ctx.pools.world, { ...ctx.args, filters: parseQuestFilters({}) });
  for (const q of [{ side: 'horde' }, { type: '81' }, { category: '-61' }, { minlevel: '30' }]) {
    const narrowed = await listQuests(ctx.pools.world, { ...ctx.args, filters: parseQuestFilters(q) });
    assert.ok(narrowed.total <= all.total, JSON.stringify(q));
  }
});

test('every category in use resolves to a label, not an id', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const cats = await listQuestCategories(ctx.pools.world, { schema: ctx.args.schema, wowPatch: ctx.args.wowPatch });
  assert.ok(cats.length > 0);
  for (const c of cats) assert.doesNotMatch(c.label, /^(zone|sort) #/, `category ${c.id}`);
});
