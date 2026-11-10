import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineLayout, uint } from '../tools/dbc/layout.js';
import { importAll, grantHelp, isMissingSchema, isRealmSchema } from '../tools/import-dbc.js';
import { writeDbc } from './helpers/dbc.js';

const first = defineLayout({ table: 'first', file: 'First.dbc', columns: [uint('id'), uint('a')] });
const second = defineLayout({ table: 'second', file: 'Second.dbc', columns: [uint('id'), uint('b')] });

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-cli-'));
  writeDbc(join(dir, 'First.dbc'), { rows: [[1, 10], [2, 20]] });
  writeDbc(join(dir, 'Second.dbc'), { rows: [[1, 30]] });
  return dir;
}

const connection = () => ({ query: async () => [[]] });

test('imports every layout and reports each', async () => {
  const dir = fixtureDir();
  try {
    const result = await importAll(connection(), { dbcDir: dir, layouts: [first, second] });
    assert.equal(result.failed, null);
    assert.deepEqual(result.tables.map((t) => [t.table, t.records]), [['first', 2], ['second', 1]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing file stops the run and names itself, keeping what came before', async () => {
  const dir = fixtureDir();
  try {
    const wrong = defineLayout({ table: 'second', file: 'Second.dbc', columns: [uint('id')] });
    const result = await importAll(connection(), { dbcDir: dir, layouts: [first, wrong] });
    assert.equal(result.tables.length, 1);
    assert.equal(result.failed.table, 'second');
    assert.match(result.failed.message, /declares 1 fields but the file has 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing source file is reported as a failure, not a crash', async () => {
  const dir = fixtureDir();
  try {
    const absent = defineLayout({ table: 'absent', file: 'Absent.dbc', columns: [uint('id')] });
    const result = await importAll(connection(), { dbcDir: dir, layouts: [absent] });
    assert.equal(result.tables.length, 0);
    assert.equal(result.failed.table, 'absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the grant help names the schema and the user', () => {
  const help = grantHelp('dbc', 'panel');
  assert.match(help, /CREATE DATABASE `dbc`/);
  assert.match(help, /GRANT ALL PRIVILEGES ON `dbc`\.\* TO 'panel'@'localhost'/);
});

test('the two schema errors are recognised and others are not', () => {
  assert.equal(isMissingSchema({ code: 'ER_BAD_DB_ERROR' }), true);
  assert.equal(isMissingSchema({ code: 'ER_DBACCESS_DENIED_ERROR' }), true);
  assert.equal(isMissingSchema({ code: 'ECONNREFUSED' }), false);
});

const realmMysqlCfg = {
  logon: { database: 'logon' },
  characters: { database: 'characters' },
  world: { database: 'world' },
  logs: { database: 'logs' }
};

test('a dbcSchema naming a realm database is refused', () => {
  assert.equal(isRealmSchema('world', realmMysqlCfg), true);
  assert.equal(isRealmSchema('logon', realmMysqlCfg), true);
});

test('the refusal ignores case and surrounding whitespace', () => {
  assert.equal(isRealmSchema('World', realmMysqlCfg), true);
  assert.equal(isRealmSchema(' world ', realmMysqlCfg), true);
});

test('a schema of its own is accepted', () => {
  assert.equal(isRealmSchema('dbc', realmMysqlCfg), false);
});

test('an optional realm database left out of config is not falsely matched', () => {
  assert.equal(isRealmSchema('characters', { logon: { database: 'logon' } }), false);
});
