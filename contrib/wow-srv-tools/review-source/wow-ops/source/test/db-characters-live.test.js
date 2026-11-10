import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { listCharacters, getCharacter, listDeletedCharacters } from '../server/queries/characters.js';

// Strictly read-only against the real realm databases, like
// test/db-bots-live.test.js: it creates no tables and writes nothing, so it
// cannot collide with the fixture tables db-accounts.test.js borrows in the
// `logs` database while node --test runs files concurrently.
//
// It asserts shapes and invariants, never values: characters log in and out
// while this runs.
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

test('listCharacters runs against the live schema and every column parses', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listCharacters(ctx.pools, ctx.config, {});
  if (rows === null) {
    t.skip('the characters or world database is not configured in config.json');
    return;
  }
  assert.ok(Array.isArray(rows));
  for (const row of rows) {
    assert.ok(typeof row.name === 'string' && row.name.length > 0, 'a listed character must have a name');
    assert.ok(Number.isFinite(row.level), `${row.name} has a non-numeric level`);
    assert.ok(Number.isFinite(row.mapId), `${row.name} has a non-numeric map`);
    assert.equal(typeof row.online, 'boolean');
  }
});

test('a listed character can be fetched by name, with its account state', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listCharacters(ctx.pools, ctx.config, {});
  if (rows === null || rows.length === 0) {
    t.skip('no non-bot characters on this realm to fetch');
    return;
  }
  const detail = await getCharacter(ctx.pools, ctx.config, rows[0].name);
  assert.ok(detail, 'a character the list returned must also be fetchable by name');
  assert.equal(detail.name, rows[0].name);
  assert.ok(Number.isFinite(detail.money));
  assert.ok(Number.isInteger(detail.accountGmLevel) && detail.accountGmLevel >= 0);
  assert.equal(typeof detail.banActive, 'boolean');
  assert.equal(typeof detail.renameFlagged, 'boolean');
});

test('including bots cannot return fewer rows than excluding them', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const withoutBots = await listCharacters(ctx.pools, ctx.config, { limit: 500 });
  const withBots = await listCharacters(ctx.pools, ctx.config, { includeBots: true, limit: 500 });
  if (withoutBots === null || withBots === null) {
    t.skip('the characters or world database is not configured in config.json');
    return;
  }
  assert.ok(withBots.length >= withoutBots.length);
});

test('the row cap is honoured against real data', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listCharacters(ctx.pools, ctx.config, { includeBots: true, limit: 5 });
  if (rows === null) {
    t.skip('the characters or world database is not configured in config.json');
    return;
  }
  assert.ok(rows.length <= 5, `expected at most 5 rows, got ${rows.length}`);
});

test('a character name is unique enough that the detail query returns one row', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listCharacters(ctx.pools, ctx.config, { includeBots: true, limit: 1 });
  if (rows === null || rows.length === 0) {
    t.skip('no characters on this realm');
    return;
  }
  const detail = await getCharacter(ctx.pools, ctx.config, rows[0].name);
  assert.ok(detail);
  assert.equal(detail.guid, rows[0].guid);
});

test('listDeletedCharacters runs, and says nothing more than the schema knows', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listDeletedCharacters(ctx.pools, ctx.config, {});
  if (rows === null) {
    t.skip('the characters database is not configured in config.json');
    return;
  }
  assert.ok(Array.isArray(rows));
  // Under CharDelete.Method = 0, which this realm runs, deleted_name is never
  // written and this is always empty - but the query must still run.
  for (const row of rows) {
    assert.ok(Number.isInteger(row.guid));
    assert.ok(Number.isFinite(row.deletedTime));
  }
});
