import test from 'node:test';
import assert from 'node:assert/strict';
import { listTickets, getTicket } from '../server/queries/tickets.js';

function fakePools(capture, rows = []) {
  return {
    characters: {
      query: async (sql, params) => {
        capture.sql = sql;
        capture.params = params;
        return [rows];
      }
    }
  };
}

const CONFIG = { mysql: { characters: { database: 'characters' }, world: { database: 'mangos' } } };

const ROW = {
  ticket_id: '3', guid: '5', name: 'Thrall', message: 'stuck in a rock',
  create_time: '1756800000', last_modified_time: '1756800100',
  map: '1', map_name: 'Kalimdor', position_x: '1.5', position_y: '2.5', position_z: '3.5',
  closed_by: '0', assigned_to: '0', assigned_to_name: null, closer_name: null,
  comment: '', response: '', completed: '0', escalated: '0', viewed: '0',
  ticket_type: '1', security_needed: '0'
};

test('open tickets only, unless closed ones are asked for', async () => {
  // closed_by is the open/closed flag (GMTicketMgr.h:167), not a `closed`
  // column: 0 means open and anything else means closed.
  const capture = {};
  await listTickets(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /closed_by = 0/);

  const all = {};
  await listTickets(fakePools(all), CONFIG, { includeClosed: true });
  assert.doesNotMatch(all.sql, /closed_by = 0/);
});

test('the assignee and the closer are resolved to character names', async () => {
  const capture = {};
  await listTickets(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /assigned_to_name/);
  assert.match(capture.sql, /closer_name/);
});

test('the map name collapses map_template to its highest patch row', async () => {
  const capture = {};
  await listTickets(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /MAX\(m2\.patch\)/);
});

test('newest tickets come first', async () => {
  const capture = {};
  await listTickets(fakePools(capture), CONFIG, {});
  assert.match(capture.sql, /ORDER BY t\.ticket_id DESC/);
});

test('a row maps every column, with numbers as numbers', async () => {
  const [row] = await listTickets(fakePools({}, [ROW]), CONFIG, {});
  assert.equal(row.id, 3);
  assert.equal(row.guid, 5);
  assert.equal(row.name, 'Thrall');
  assert.equal(row.message, 'stuck in a rock');
  assert.equal(row.createTime, 1756800000);
  assert.equal(row.mapName, 'Kalimdor');
  assert.equal(row.completed, false);
  assert.equal(row.viewed, false);
  assert.equal(row.ticketType, 1);
  assert.equal(row.assignedToName, null);
});

test('a negative closed_by survives as -1 rather than being clamped', async () => {
  // -1 is the console sentinel; turning it into 0 would read as "open".
  const [row] = await listTickets(fakePools({}, [{ ...ROW, closed_by: '-1' }]), CONFIG, { includeClosed: true });
  assert.equal(row.closedBy, -1);
});

test('getTicket looks one up by id and answers null when absent', async () => {
  const capture = {};
  assert.equal(await getTicket(fakePools(capture, []), CONFIG, 3), null);
  assert.match(capture.sql, /t\.ticket_id = \?/);
  assert.ok(capture.params.includes(3));

  const found = await getTicket(fakePools({}, [ROW]), CONFIG, 3);
  assert.equal(found.id, 3);
});

test('a missing pool or schema answers null instead of throwing', async () => {
  assert.equal(await listTickets({}, CONFIG, {}), null);
  assert.equal(await listTickets(fakePools({}), { mysql: {} }, {}), null);
  assert.equal(await getTicket({}, CONFIG, 3), null);
});
