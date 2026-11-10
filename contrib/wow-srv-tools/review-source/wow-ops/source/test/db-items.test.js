import test from 'node:test';
import assert from 'node:assert/strict';
import { listItems } from '../server/queries/db/items.js';
import { parseItemFilters } from '../server/queries/db/itemFilters.js';

function scriptedPool(script) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [script[calls.length - 1] ?? []];
    }
  };
}

const ROW = {
  entry: 19019, name: 'Thunderfury', quality: 5, class: 2, subclass: 7,
  item_level: 80, required_level: 60, inventory_type: 13, set_id: 0,
  inventory_icon: 'INV_Sword_39'
};

test('both the row read and the count carry the patch clause', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listItems(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseItemFilters({}), wowPatch: 10 });
  assert.equal(pool.calls.length, 2);
  for (const call of pool.calls) {
    assert.match(call.sql, /t1\.patch = \(SELECT MAX\(t2\.patch\)/);
    assert.ok(call.params.includes(10), 'the configured patch is bound in both statements');
  }
});

test('the icon join is schema-qualified into the reference schema', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listItems(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseItemFilters({}), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /`dbc`\.`item_display_info`/);
  assert.match(pool.calls[0].sql, /LEFT JOIN/);
});

test('filters are bound, and the same values reach the count', async () => {
  const filters = parseItemFilters({ q: 'sword', quality: '4' });
  const pool = scriptedPool([[ROW], [{ total: 12 }]]);
  const result = await listItems(pool, { schema: 'mangos', dbcSchema: 'dbc', filters, wowPatch: 10 });
  assert.deepEqual(pool.calls[0].params.slice(0, 2), ['%sword%', 4]);
  assert.deepEqual(pool.calls[1].params.slice(0, 2), ['%sword%', 4]);
  assert.equal(result.total, 12);
});

test('the sort key reaches SQL as the expression it maps to, never as typed', async () => {
  const filters = parseItemFilters({ sort: 'ilvl', dir: 'desc' });
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listItems(pool, { schema: 'mangos', dbcSchema: 'dbc', filters, wowPatch: 10 });
  assert.match(pool.calls[0].sql, /ORDER BY t1\.item_level desc/);
  assert.doesNotMatch(pool.calls[0].sql, /ilvl/);
});

test('paging binds limit and offset rather than splicing them in', async () => {
  const filters = parseItemFilters({ page: '3' });
  const pool = scriptedPool([[ROW], [{ total: 500 }]]);
  await listItems(pool, { schema: 'mangos', dbcSchema: 'dbc', filters, wowPatch: 10 });
  assert.match(pool.calls[0].sql, /LIMIT \? OFFSET \?/);
  const params = pool.calls[0].params;
  assert.deepEqual(params.slice(-2), [50, 100]);
});

// The reference schema is optional: cycle 2's importer may never have run.
test('without a reference schema the query still returns rows, without icons', async () => {
  const pool = scriptedPool([[{ ...ROW, inventory_icon: null }], [{ total: 1 }]]);
  const result = await listItems(pool, { schema: 'mangos', dbcSchema: null, filters: parseItemFilters({}), wowPatch: 10 });
  assert.doesNotMatch(pool.calls[0].sql, /item_display_info/);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].inventory_icon, null);
});

// A configured dbcSchema is no proof the importer ever finished:
// tools/import-dbc.js documents that a failed run leaves a partial schema.
// The join sits inside the main SELECT, so an unguarded ER_NO_SUCH_TABLE here
// would take the whole item list down, not just the icons - this is the
// defect the review on Task 8 found and asked to be fixed at its source.
test('a missing or half-imported reference schema retries without the icon join, instead of failing the whole list', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('item_display_info')) {
        const err = new Error("ER_NO_SUCH_TABLE: Table 'dbc.item_display_info' doesn't exist");
        err.code = 'ER_NO_SUCH_TABLE';
        throw err;
      }
      if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
      return [[{ ...ROW, inventory_icon: null }]];
    }
  };
  const result = await listItems(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseItemFilters({}), wowPatch: 10 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].inventory_icon, null);
  const retry = calls.find((c) => c.sql.includes('FROM') && !c.sql.includes('item_display_info') && !c.sql.includes('COUNT'));
  assert.ok(retry, 'the row query was retried after the join failed');
  assert.doesNotMatch(retry.sql, /item_display_info/);
});
