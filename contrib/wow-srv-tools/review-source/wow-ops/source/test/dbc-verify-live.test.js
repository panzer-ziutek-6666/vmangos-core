import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { readConfigFile } from '../server/config.js';
import { checkRowCounts } from '../tools/dbc/verify.js';
import { LAYOUTS } from '../tools/dbc/layouts/index.js';
import { readDbc } from '../tools/dbc/reader.js';

const here = dirname(fileURLToPath(import.meta.url));

async function importedSchemaOrSkip(t) {
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
  try {
    const connection = await mysql.createConnection({ ...cfg.mysql.world, database: cfg.mysql.dbcSchema });
    const [rows] = await connection.query('SHOW TABLES');
    if (rows.length === 0) {
      await connection.end();
      t.skip('the reference schema is empty; run npm run import-dbc');
      return null;
    }
    return { cfg, connection };
  } catch (err) {
    t.skip(`reference schema not reachable: ${err.code ?? err.message}`);
    return null;
  }
}

test('every imported table holds exactly as many rows as its file has records', async (t) => {
  const context = await importedSchemaOrSkip(t);
  if (!context) return;
  const { cfg, connection } = context;
  try {
    const tables = LAYOUTS.map((layout) => ({
      table: layout.table,
      records: readDbc(join(cfg.client.dbcDir, layout.file)).recordCount
    }));
    for (const check of await checkRowCounts(connection, tables)) {
      assert.equal(check.ok, true, `${check.table}: ${check.actual} rows for ${check.expected} records`);
    }
  } finally {
    await connection.end();
  }
});
