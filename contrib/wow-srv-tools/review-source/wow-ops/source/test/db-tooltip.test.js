import test from 'node:test';
import assert from 'node:assert/strict';
import { renderItemTooltip } from '../server/views/db/tooltip.js';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const ROW = {
  entry: 19019, name: 'Thunderfury', quality: 5, class: 2, subclass: 7,
  item_level: 80, required_level: 60, inventory_type: 13, bonding: 1,
  armor: 0, block: 0, delay: 1900, max_durability: 125,
  dmg_min1: 44, dmg_max1: 115, dmg_type1: 0,
  stat_type1: 3, stat_value1: 5, stat_type2: 7, stat_value2: 8,
  holy_res: 0, fire_res: 8, nature_res: 0, frost_res: 0, shadow_res: 0, arcane_res: 0,
  sell_price: 143276, set_id: 0
};

test('the name carries the quality colour class', () => {
  assert.match(renderItemTooltip(ROW), /class="q5"/);
});

test('every quality from poor to artifact has its own class', () => {
  for (let q = 0; q <= 6; q++) {
    assert.match(renderItemTooltip({ ...ROW, quality: q }), new RegExp(`class="q${q}"`));
  }
});

test('damage, speed, stats and resistances are stated', () => {
  const html = renderItemTooltip(ROW);
  assert.match(html, /44\s*-\s*115/);
  assert.match(html, /1\.90/);
  assert.match(html, /\+5/);
  assert.match(html, /Fire Resistance \+8/i);
});

test('a stat slot with a zero value is not rendered as a stat', () => {
  // ROW's fire_res is 8, the same value as the stat_value2 slot being
  // zeroed here - without also zeroing it, the resistance line's own
  // "Fire Resistance +8" (required by the test above) would leave a
  // "+8" in the output regardless of the stat change, and this
  // assertion could never pass. Zeroing it isolates what this test
  // actually checks: the stat pair, not an unrelated resistance.
  const html = renderItemTooltip({ ...ROW, stat_type2: 7, stat_value2: 0, fire_res: 0 });
  const plusEights = html.match(/\+8/g) ?? [];
  assert.equal(plusEights.length, 0);
});

test('binding and the required level are stated', () => {
  const html = renderItemTooltip(ROW);
  assert.match(html, /Binds when picked up/i);
  assert.match(html, /Requires Level 60/i);
});

// The spell columns are read in cycle 5. Until then the tooltip must not
// invent the sentence the client shows.
test('the tooltip claims no Use: or Equip: text it cannot build yet', () => {
  const html = renderItemTooltip({ ...ROW, spellid_1: 21179, spelltrigger_1: 1 });
  assert.doesNotMatch(html, /Equip:/);
  assert.doesNotMatch(html, /Use:/);
});

// Route harness: see test/helpers/dbApp.js.
function harness(tables) {
  return { app: dbApp({ world: dbStubPool(tables).pool }).app };
}

test('the tooltip route answers with a bare fragment', async (t) => {
  const { app } = harness({ item_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/item/19019', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /class="tooltip"/);
});

test('an unknown id is a 404 fragment, not chrome and not an empty 200', async (t) => {
  const { app } = harness({ item_template: [] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/item/999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
});

test('a non-numeric id is refused before any query runs', async (t) => {
  const { app } = harness({ item_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/item/1e3', headers: HEADERS });
  assert.equal(res.statusCode, 400);
});

// The finding that started this pass: loadItem() (server/queries/db/item.js)
// issues ~23 queries per call - two template reads, ten parallel reverse-
// source reads across loot/vendor/quest tables, then owner lookups and name
// batches - because it builds the whole item page. renderItemTooltip reads
// nothing but data.row, so the tooltip route has no reason to pay for any of
// that. This pins the cost, not just the rendered output, so a future change
// that reintroduces the full page load fails here even if the fragment still
// looks right.
test('the tooltip route costs at most two queries and none of them touch a loot, vendor or quest table', async (t) => {
  const stub = dbStubPool({ item_template: [ROW] });
  const { app } = dbApp({ world: stub.pool });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/db/tooltip/item/19019', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.ok(stub.calls.length <= 2, `expected at most 2 queries, got ${stub.calls.length}`);
  for (const call of stub.calls) {
    assert.doesNotMatch(call.sql, /loot_template/i);
    assert.doesNotMatch(call.sql, /npc_vendor/i);
    assert.doesNotMatch(call.sql, /quest_template/i);
  }
});
