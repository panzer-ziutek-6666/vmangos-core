import test from 'node:test';
import assert from 'node:assert/strict';
import { renderQuestTooltip } from '../server/views/db/questTooltip.js';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const ROW = { entry: 176, Title: 'Wanted: Hogger', QuestLevel: 11, MinLevel: 5, RequiredRaces: 77, ZoneOrSort: 12, Type: 1, Objectives: 'Bring <Hogger>\'s claw to the Marshal.' };

test('the card names the quest, its levels, races, type and category', () => {
  const html = renderQuestTooltip(ROW, 'Elwynn Forest');
  for (const text of ['Wanted: Hogger', 'Level 11', 'requires 5', 'Races: Alliance', 'Elite', 'Elwynn Forest']) assert.ok(html.includes(text), text);
});

test('level 0 reads as the player\'s own level, not 0', () => {
  const html = renderQuestTooltip({ ...ROW, QuestLevel: 0 }, null);
  assert.match(html, /Level player&#39;s level/);
});

test('the objectives text is escaped and cut at 300 characters', () => {
  assert.match(renderQuestTooltip(ROW, null), /Bring &lt;Hogger&gt;/);
  const long = renderQuestTooltip({ ...ROW, Objectives: 'x'.repeat(400) }, null);
  assert.match(long, /x{300}…/);
  assert.doesNotMatch(long, /x{301}/);
});

test('a quest sort names its category without a zone lookup', () => {
  assert.match(renderQuestTooltip({ ...ROW, ZoneOrSort: -61 }, null), /Warlock/);
});

test('the route answers a bare fragment in at most two queries, touching no relation or item table', async (t) => {
  const stub = dbStubPool({ quest_template: [{ ...ROW, patch: 0 }], area_template: [{ entry: 12, name: 'Elwynn Forest' }] });
  const { app } = dbApp({ world: stub.pool });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/quest/176', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /class="tooltip"/);
  assert.match(res.body, /Elwynn Forest/);
  assert.ok(stub.calls.length <= 2, `expected at most 2 queries, got ${stub.calls.length}`);
  for (const c of stub.calls) assert.doesNotMatch(c.sql, /questrelation|involvedrelation|item_template|loot/);
});

test('a quest sort costs one query, with no read of area_template', async (t) => {
  const stub = dbStubPool({ quest_template: [{ ...ROW, ZoneOrSort: -61, patch: 0 }] });
  const { app } = dbApp({ world: stub.pool });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/quest/176', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Warlock/);
  assert.equal(stub.calls.length, 1, `expected exactly 1 query, got ${stub.calls.length}`);
  for (const c of stub.calls) assert.doesNotMatch(c.sql, /area_template/);
});

test('an unknown id is a 404 fragment and a malformed one a 400', async (t) => {
  const { app } = dbApp({ world: dbStubPool({}).pool });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/db/tooltip/quest/999999', headers: HEADERS })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/db/tooltip/quest/1e3', headers: HEADERS })).statusCode, 400);
});
