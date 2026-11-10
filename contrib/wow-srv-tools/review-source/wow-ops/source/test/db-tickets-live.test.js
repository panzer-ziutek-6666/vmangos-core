import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { listTickets, getTicket } from '../server/queries/tickets.js';

// Read-only. The scratch ticket used for the one-off walkthrough was created by
// hand and removed with .ticket delete, not from a test: a test that inserted
// into the live gm_tickets would leave a row behind every time it failed.
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
  return { config, pools };
}

test('the ticket queries run against the live schema', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listTickets(ctx.pools, ctx.config, { includeClosed: true });
  if (rows === null) {
    t.skip('the characters or world database is not configured in config.json');
    return;
  }
  assert.ok(Array.isArray(rows));
  for (const row of rows) {
    assert.ok(Number.isInteger(row.id) && row.id > 0);
    assert.equal(typeof row.name, 'string');
    assert.ok(Number.isFinite(row.createTime));
    assert.ok(Number.isInteger(row.ticketType));
  }
});

test('the open list is a subset of the full list', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const open = await listTickets(ctx.pools, ctx.config, {});
  const all = await listTickets(ctx.pools, ctx.config, { includeClosed: true });
  if (open === null) {
    t.skip('the characters or world database is not configured in config.json');
    return;
  }
  assert.ok(open.length <= all.length);
  for (const row of open) {
    assert.equal(row.closedBy, 0, `ticket ${row.id} is in the open list but has closed_by ${row.closedBy}`);
  }
});

test('a ticket in the list can be fetched by id', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listTickets(ctx.pools, ctx.config, { includeClosed: true });
  if (rows === null || rows.length === 0) {
    t.skip('no tickets on this realm');
    return;
  }
  const one = await getTicket(ctx.pools, ctx.config, rows[0].id);
  assert.ok(one);
  assert.equal(one.id, rows[0].id);
});
