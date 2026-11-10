import test from 'node:test';
import assert from 'node:assert/strict';
import { listGameEvents } from '../server/queries/events.js';

function fakePools(capture, rows = []) {
  return {
    world: {
      query: async (sql, params) => {
        capture.sql = sql;
        capture.params = params;
        return [rows];
      }
    }
  };
}

const CONFIG = { mysql: { world: { database: 'mangos' } } };

const ROW = {
  entry: '13', description: 'Elemental Invasion',
  start_time: new Date('2026-09-02T02:33:49Z'), end_time: null,
  occurence: '1', length: '999999999', holiday: '0',
  hardcoded: '1', disabled: '0', patch_min: '2', patch_max: '10'
};

test('the query names the configured world schema', async () => {
  const capture = {};
  await listGameEvents(fakePools(capture), CONFIG);
  assert.match(capture.sql, /`mangos`\.game_event/);
});

test('rows come back ordered by id so the page order is stable', async () => {
  const capture = {};
  await listGameEvents(fakePools(capture), CONFIG);
  assert.match(capture.sql, /ORDER BY entry/);
});

test('every numeric column is mapped to a number', async () => {
  const [row] = await listGameEvents(fakePools({}, [ROW]), CONFIG);
  assert.equal(row.id, 13);
  assert.equal(row.occurrenceMinutes, 1);
  assert.equal(row.lengthMinutes, 999999999);
  assert.equal(row.hardcoded, true);
  assert.equal(row.disabled, false);
  assert.equal(row.patchMin, 2);
  assert.equal(row.patchMax, 10);
});

test('a zero timestamp arrives as null and stays null', async () => {
  // start_time and end_time are TIMESTAMP columns and many rows hold
  // '0000-00-00 00:00:00', which mysql2 hands back as null.
  const [row] = await listGameEvents(fakePools({}, [ROW]), CONFIG);
  assert.equal(row.endTime, null);
  assert.ok(row.startTime instanceof Date);
});

test('a null description becomes an empty string, not the word null', async () => {
  const [row] = await listGameEvents(fakePools({}, [{ ...ROW, description: null }]), CONFIG);
  assert.equal(row.description, '');
});

test('a missing world pool answers null instead of throwing', async () => {
  assert.equal(await listGameEvents({}, CONFIG), null);
});

test('a missing world schema name answers null instead of building broken SQL', async () => {
  assert.equal(await listGameEvents(fakePools({}), { mysql: {} }), null);
});
