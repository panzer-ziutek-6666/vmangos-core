import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDbc } from '../tools/dbc/reader.js';
import { defineLayout, uint, int, float, locstring, skip, rowIndex } from '../tools/dbc/layout.js';
import { readRows, importTable } from '../tools/dbc/importer.js';
import { writeDbc, withDbc } from './helpers/dbc.js';

// Records every statement in order, so a test can assert that the geometry
// check ran before any DDL did.
function recordingConnection() {
  const statements = [];
  return { statements, query: async (sql, params) => { statements.push({ sql, params }); return [[]]; } };
}

const layout = defineLayout({
  table: 'sample', file: 'Sample.dbc',
  columns: [uint('id'), int('delta'), float('scale'), skip(), locstring('name')]
});

// id, delta, scale, one skipped field, then nine locale fields.
const row = (id, delta, scale, name) => [id, delta, { float: scale }, 0, { str: name }, 0, 0, 0, 0, 0, 0, 0, 0];

test('rows carry one value per real column, in column order', () => {
  withDbc({ rows: [row(1, -5, 2.5, 'first')], name: 'Sample.dbc' }, (path) => {
    assert.deepEqual(readRows(layout, readDbc(path)), [[1, -5, 2.5, 'first']]);
  });
});

test('a negative field read as int keeps its sign', () => {
  withDbc({ rows: [row(1, -12345, 1, 'x')], name: 'Sample.dbc' }, (path) => {
    assert.equal(readRows(layout, readDbc(path))[0][1], -12345);
  });
});

test('a high byte in the string block arrives as one code point, not two', () => {
  withDbc({ rows: [row(1, 1, 1, '\xE9')], name: 'Sample.dbc' }, (path) => {
    const [record] = readRows(layout, readDbc(path));
    assert.equal(record[3].length, 1);
    assert.equal(record[3].charCodeAt(0), 0xE9);
  });
});

test('the layout is checked before any statement runs', async () => {
  const short = defineLayout({ table: 'sample', file: 'Sample.dbc', columns: [uint('id')] });
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-imp-'));
  try {
    writeDbc(join(dir, 'Sample.dbc'), { rows: [row(1, 1, 1, 'x')] });
    const connection = recordingConnection();
    await assert.rejects(() => importTable(connection, short, dir), /declares 1 fields but the file has 13/);
    assert.equal(connection.statements.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('drop, create, then one insert per batch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-imp-'));
  try {
    writeDbc(join(dir, 'Sample.dbc'), { rows: [row(1, 1, 1, 'a'), row(2, 2, 2, 'b'), row(3, 3, 3, 'c')] });
    const connection = recordingConnection();
    const result = await importTable(connection, layout, dir, { batchRows: 2 });

    assert.match(connection.statements[0].sql, /^DROP TABLE IF EXISTS/);
    assert.match(connection.statements[1].sql, /^CREATE TABLE/);
    assert.equal(connection.statements.length, 4);
    assert.equal(connection.statements[2].params.length, 8);
    assert.equal(connection.statements[3].params.length, 4);
    const stats = statSync(join(dir, 'Sample.dbc'));
    assert.deepEqual(result, {
      table: 'sample', file: 'Sample.dbc', records: 3, fieldCount: 13, recordSize: 52, batches: 2,
      sourceBytes: stats.size, sourceModified: stats.mtime
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a rowIndex column carries each record\'s position in the file', () => {
  const layout = defineLayout({ table: 't', file: 'T.dbc', columns: [uint('id'), rowIndex('dbc_row')] });
  withDbc({ rows: [[81], [41], [61]] }, (path) => {
    const rows = readRows(layout, readDbc(path));
    assert.deepEqual(rows, [[81, 0], [41, 1], [61, 2]]);
  });
});

test('a file with no records still creates its table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-imp-'));
  try {
    writeDbc(join(dir, 'Sample.dbc'), { rows: [], fieldCount: 13, recordSize: 52 });
    const connection = recordingConnection();
    const result = await importTable(connection, layout, dir);
    assert.equal(connection.statements.length, 2);
    assert.equal(result.records, 0);
    assert.equal(result.batches, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
