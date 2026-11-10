import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { createSoapClient } from '../server/soap.js';
import { listGameEvents } from '../server/queries/events.js';
import { parseEventList } from '../server/eventList.js';

// Read-only against the real realm: it reads game_event and runs `.event list
// all`, neither of which changes anything. The state-changing event commands
// are never sent from a test.
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

test('the game event query runs against the live world database', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listGameEvents(ctx.pools, ctx.config);
  if (rows === null) {
    t.skip('the world database is not configured in config.json');
    return;
  }
  assert.ok(rows.length > 0, 'this realm has game events');
  for (const row of rows) {
    assert.ok(Number.isInteger(row.id) && row.id > 0);
    assert.ok(Number.isFinite(row.lengthMinutes));
    assert.equal(typeof row.hardcoded, 'boolean');
    assert.ok(row.patchMin <= row.patchMax, `event ${row.id} has an inverted patch range`);
  }
});

test('every id the live event list reports also exists in game_event', async (t) => {
  // The two sources are read a moment apart from the same table, so the live
  // list naming an id the DB does not have would mean they have diverged.
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const soap = createSoapClient(ctx.config.soap);
  const listed = await soap.execute('.event list all');
  if (!listed.ok) {
    t.skip(`mangosd is not reachable: ${listed.output}`);
    return;
  }
  const liveRows = parseEventList(listed.output);
  assert.ok(liveRows.length > 0, '.event list all returned no parseable rows');

  const rows = await listGameEvents(ctx.pools, ctx.config);
  const ids = new Set(rows.map((r) => r.id));
  for (const live of liveRows) {
    assert.ok(ids.has(live.id), `event ${live.id} is running but is not in game_event`);
  }
});

test('the parser reads every line the live server prints', async (t) => {
  // A silently dropped line becomes an event with no state on the page, so the
  // parser is held to the real output, not only to fixtures.
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const soap = createSoapClient(ctx.config.soap);
  const listed = await soap.execute('.event list all');
  if (!listed.ok) {
    t.skip(`mangosd is not reachable: ${listed.output}`);
    return;
  }
  const lines = listed.output.split('\n').filter((l) => l.trim().length > 0);
  const parsed = parseEventList(listed.output);
  assert.equal(parsed.length, lines.length, 'some lines of .event list all did not parse');
});
