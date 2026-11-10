import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRowCounts, foldedSpellTemplateSql, compareSpells } from '../tools/dbc/verify.js';

test('a row count that matches the file passes, one that does not fails', async () => {
  const connection = {
    query: async (sql) => [[{ n: sql.includes('`first`') ? 2 : 99 }]]
  };
  const result = await checkRowCounts(connection, [
    { table: 'first', records: 2 },
    { table: 'second', records: 1 }
  ]);
  assert.deepEqual(result, [
    { table: 'first', expected: 2, actual: 2, ok: true },
    { table: 'second', expected: 1, actual: 99, ok: false }
  ]);
});

test('the fold takes the highest build not above the configured one', () => {
  const sql = foldedSpellTemplateSql(5875);
  assert.match(sql, /build <= 5875/);
  assert.match(sql, /MAX\(build\)/);
  assert.match(sql, /GROUP BY entry/);
});

test('a differing column is reported with a row count, not just a flag', async () => {
  const dbcRows = [{ id: 1, manaCost: 10 }, { id: 2, manaCost: 20 }];
  const worldRows = [{ entry: 1, manaCost: 10 }, { entry: 2, manaCost: 999 }];
  const result = await compareSpells(
    { query: async () => [dbcRows] },
    { query: async () => [worldRows] },
    { build: 5875, columns: ['manaCost'] }
  );
  assert.equal(result.compared, 2);
  assert.deepEqual(result.differing, [{ column: 'manaCost', rows: 1 }]);
  assert.deepEqual(result.onlyInDbc, []);
  assert.deepEqual(result.onlyInWorld, []);
});

test('ids present on one side only are listed rather than compared', async () => {
  const result = await compareSpells(
    { query: async () => [[{ id: 1, manaCost: 1 }, { id: 3, manaCost: 1 }]] },
    { query: async () => [[{ entry: 1, manaCost: 1 }, { entry: 4, manaCost: 1 }]] },
    { build: 5875, columns: ['manaCost'] }
  );
  assert.equal(result.compared, 1);
  assert.deepEqual(result.onlyInDbc, [3]);
  assert.deepEqual(result.onlyInWorld, [4]);
});
