import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineLayout, uint } from '../tools/dbc/layout.js';
import { importTable } from '../tools/dbc/importer.js';
import { META_TABLE, createMetaSql, writeMeta } from '../tools/import-dbc.js';
import { writeDbc } from './helpers/dbc.js';

test('the import result carries the source file size and modification time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-meta-'));
  try {
    writeDbc(join(dir, 'First.dbc'), { rows: [[1, 10]] });
    const layout = defineLayout({ table: 'first', file: 'First.dbc', columns: [uint('id'), uint('a')] });
    const result = await importTable({ query: async () => [[]] }, layout, dir);
    assert.ok(result.sourceBytes > 20);
    assert.ok(result.sourceModified instanceof Date);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the meta table is dropped, created and filled in one pass', async () => {
  const statements = [];
  const connection = { query: async (sql, params) => { statements.push({ sql, params }); return [[]]; } };
  const importedAt = new Date('2026-09-10T12:00:00Z');
  await writeMeta(connection, [
    { table: 'first', file: 'First.dbc', records: 2, fieldCount: 2, recordSize: 8, sourceBytes: 40, sourceModified: importedAt }
  ], { clientBuild: 5875, importedAt });

  assert.match(statements[0].sql, new RegExp(`^DROP TABLE IF EXISTS \`${META_TABLE}\``));
  assert.match(statements[1].sql, new RegExp(`^CREATE TABLE \`${META_TABLE}\``));
  assert.match(statements[2].sql, new RegExp(`^INSERT INTO \`${META_TABLE}\``));
  assert.deepEqual(statements[2].params, ['first', 'First.dbc', 2, 2, 8, 40, importedAt, 5875, importedAt]);
});

test('the meta table names every column a page would need', () => {
  const sql = createMetaSql();
  for (const column of ['table_name', 'source_file', 'records', 'field_count', 'record_size', 'source_bytes', 'source_modified', 'client_build', 'imported_at']) {
    assert.match(sql, new RegExp(`\`${column}\``), `${column} missing`);
  }
});

test('writing meta for an empty import still creates the table', async () => {
  const statements = [];
  const connection = { query: async (sql) => { statements.push(sql); return [[]]; } };
  await writeMeta(connection, [], { clientBuild: 5875 });
  assert.equal(statements.length, 2);
});
